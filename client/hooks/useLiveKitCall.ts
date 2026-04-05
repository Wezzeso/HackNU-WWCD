import {
	ConnectionState,
	Room,
	RoomEvent,
	Track,
	VideoPresets,
	type LocalVideoTrack,
	type Participant,
	type RemoteAudioTrack,
	type RemoteVideoTrack,
} from 'livekit-client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getApiOrigin } from '../utils/network'

const DEFAULT_USER_COLOR = '#64748b'
const PARTICIPANT_POLL_INTERVAL_MS = 2500

interface PreviewParticipantPayload {
	participantId: string
	userId: string
	userName: string
	userColor: string
	isMuted: boolean
	joinedAtMs: number
}

interface ParticipantsResponse {
	participants?: PreviewParticipantPayload[]
	error?: string
}

interface TokenResponse {
	serverUrl?: string
	participantToken?: string
	error?: string
}

export interface CallParticipant {
	participantId: string
	userId: string
	userName: string
	userColor: string
	userAvatar?: string | null
	isLocal: boolean
	isMuted: boolean
	isSpeaking: boolean
	joinedAtMs: number
}

export interface RemoteTrackEntry {
	id: string
	participantId: string
	track: RemoteAudioTrack | RemoteVideoTrack
	source: Track.Source
}

interface UseLiveKitCallReturn {
	participants: CallParticipant[]
	remoteTracks: RemoteTrackEntry[]
	localVideoTrack: LocalVideoTrack | null
	localScreenTrack: LocalVideoTrack | null
	callMode: 'voice' | 'video' | null
	isInCall: boolean
	isJoining: boolean
	isMuted: boolean
	isCameraOff: boolean
	isScreenSharing: boolean
	status: string | null
	error: string | null
	joinCall: (mode: 'voice' | 'video', options?: { startMuted?: boolean }) => Promise<void>
	leaveCall: () => Promise<void>
	toggleMute: () => Promise<void>
	toggleCamera: () => Promise<void>
	toggleScreenShare: () => Promise<void>
}

function createSessionIdentity(userId: string) {
	const randomPart =
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID().slice(0, 8)
			: Math.random().toString(36).slice(2, 10)

	return `${userId}-${randomPart}`
}

function getErrorMessage(error: unknown, fallback: string) {
	if (error instanceof Error && error.message) {
		return error.message
	}
	return fallback
}

function parseParticipantMetadata(metadata?: string) {
	if (!metadata) {
		return {}
	}
	try {
		return JSON.parse(metadata) as {
			userId?: string
			userName?: string
			userColor?: string
			userAvatar?: string
		}
	} catch {
		return {}
	}
}

function sortParticipants(left: CallParticipant, right: CallParticipant) {
	if (left.joinedAtMs !== right.joinedAtMs) {
		return left.joinedAtMs - right.joinedAtMs
	}
	return left.userName.localeCompare(right.userName)
}

function buildParticipantSnapshot(
	participant: Participant,
	localIdentity: string,
	fallbackUserName: string,
	fallbackUserColor: string,
	fallbackUserAvatar?: string | null
): CallParticipant {
	const metadata = parseParticipantMetadata(participant.metadata)

	return {
		participantId: participant.identity,
		userId: metadata.userId || participant.identity,
		userName: participant.name || metadata.userName || fallbackUserName,
		userColor: metadata.userColor || fallbackUserColor || DEFAULT_USER_COLOR,
		userAvatar: metadata.userAvatar || fallbackUserAvatar || null,
		isLocal: participant.identity === localIdentity,
		isMuted: !participant.isMicrophoneEnabled,
		isSpeaking: participant.isSpeaking,
		joinedAtMs: participant.joinedAt?.getTime() ?? 0,
	}
}

function buildRoomParticipants(
	room: Room,
	localIdentity: string,
	fallbackUserName: string,
	fallbackUserColor: string,
	fallbackUserAvatar?: string | null
) {
	const participants = [
		buildParticipantSnapshot(
			room.localParticipant,
			localIdentity,
			fallbackUserName,
			fallbackUserColor,
			fallbackUserAvatar
		),
		...Array.from(room.remoteParticipants.values()).map((participant) =>
			buildParticipantSnapshot(
				participant,
				localIdentity,
				participant.name || participant.identity,
				fallbackUserColor
			)
		),
	]

	return participants.sort(sortParticipants)
}

function buildRemoteTracks(room: Room) {
	const tracks: RemoteTrackEntry[] = []

	for (const participant of room.remoteParticipants.values()) {
		for (const publication of participant.trackPublications.values()) {
			const track = publication.track as RemoteAudioTrack | RemoteVideoTrack | undefined
			if (!track) continue

			tracks.push({
				id: `${participant.identity}-${publication.trackSid}`,
				participantId: participant.identity,
				track,
				source: publication.source,
			})
		}
	}
	return tracks
}

export function useLiveKitCall(
	roomId: string,
	userId: string,
	userName: string,
	userColor = DEFAULT_USER_COLOR,
	userAvatar: string | null = null
): UseLiveKitCallReturn {
	const [participants, setParticipants] = useState<CallParticipant[]>([])
	const [remoteTracks, setRemoteTracks] = useState<RemoteTrackEntry[]>([])
	const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null)
	const [localScreenTrack, setLocalScreenTrack] = useState<LocalVideoTrack | null>(null)

	const [isJoining, setIsJoining] = useState(false)
	const [isInCall, setIsInCall] = useState(false)
	const [isMuted, setIsMuted] = useState(true)
	const [isCameraOff, setIsCameraOff] = useState(true)
	const [isScreenSharing, setIsScreenSharing] = useState(false)
	const [callMode, setCallMode] = useState<'voice' | 'video' | null>(null)
	
	const [status, setStatus] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const sessionIdentity = useMemo(() => createSessionIdentity(userId), [userId])
	const roomRef = useRef<Room | null>(null)
	const isMountedRef = useRef(true)
	const isIntentionalDisconnectRef = useRef(false)

	const syncRoomState = useCallback(
		(room: Room) => {
			if (!isMountedRef.current || roomRef.current !== room) return

			setParticipants(buildRoomParticipants(room, sessionIdentity, userName, userColor, userAvatar))
			setRemoteTracks(buildRemoteTracks(room))
			
			setIsMuted(!room.localParticipant.isMicrophoneEnabled)
			setIsCameraOff(!room.localParticipant.isCameraEnabled)
			setIsScreenSharing(!room.localParticipant.isScreenShareEnabled)
			setIsInCall(room.state !== ConnectionState.Disconnected)

			if (room.state === ConnectionState.Reconnecting || room.state === ConnectionState.SignalReconnecting) {
				setStatus('Reconnecting...')
			} else if (room.state === ConnectionState.Connecting) {
				setStatus('Joining...')
			} else {
				setStatus(null)
				setError(null)
			}
		},
		[sessionIdentity, userColor, userName]
	)

	const refreshPreviewParticipants = useCallback(
		async (signal?: AbortSignal) => {
			if (!roomId || roomRef.current) return

			const response = await fetch(
				`${getApiOrigin()}/api/livekit/participants/${encodeURIComponent(roomId)}`,
				{ signal }
			)
			const payload = (await response.json().catch(() => null)) as ParticipantsResponse | null

			if (!response.ok) {
				throw new Error(payload?.error || 'Failed to load participants.')
			}

			if (!isMountedRef.current || roomRef.current) return

			setParticipants(
				(payload?.participants ?? [])
					.map((participant: any) => ({
						...participant,
						isLocal: participant.participantId === sessionIdentity,
						isSpeaking: false,
						userAvatar: participant.userAvatar || null,
					}))
					.sort(sortParticipants)
			)
			setError(null)
		},
		[roomId, sessionIdentity]
	)

	const disconnectCurrentRoom = useCallback(async (intentional: boolean) => {
		const room = roomRef.current
		roomRef.current = null
		isIntentionalDisconnectRef.current = intentional

		setRemoteTracks([])
		setLocalVideoTrack(null)
		setLocalScreenTrack(null)
		setIsInCall(false)
		setIsMuted(true)
		setIsCameraOff(true)
		setIsScreenSharing(false)
		setCallMode(null)
		setStatus(null)

		if (room) {
			await room.disconnect(true).catch(() => undefined)
		}
		if (intentional) setError(null)
	}, [])

	const joinCall = useCallback(
		async (mode: 'voice' | 'video', options?: { startMuted?: boolean }) => {
			if (!roomId || isJoining || roomRef.current) return

			setIsJoining(true)
			setError(null)
			setStatus('Joining...')
			setCallMode(mode)

			try {
				const participantMetadata = { userId, userName, userColor, userAvatar }

				const tokenResponse = await fetch(`${getApiOrigin()}/api/livekit/token`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						roomId,
						participantIdentity: sessionIdentity,
						participantName: userName,
						participantMetadata,
					}),
				})

				const tokenPayload = (await tokenResponse.json().catch(() => null)) as TokenResponse | null

				if (!tokenResponse.ok || !tokenPayload?.serverUrl || !tokenPayload?.participantToken) {
					throw new Error(tokenPayload?.error || 'Failed to create a join token.')
				}

				const room = new Room({
					videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
				})
				roomRef.current = room
				isIntentionalDisconnectRef.current = false

				const sync = () => syncRoomState(room)
				const handleLocalTrack = (publication: any) => {
					if (publication.source === Track.Source.Camera) {
						setLocalVideoTrack((publication.track as LocalVideoTrack) || null)
					} else if (publication.source === Track.Source.ScreenShare) {
						setLocalScreenTrack((publication.track as LocalVideoTrack) || null)
					}
					sync()
				}

				room.on(RoomEvent.ConnectionStateChanged, sync)
				room.on(RoomEvent.Connected, sync)
				room.on(RoomEvent.Reconnecting, sync)
				room.on(RoomEvent.SignalReconnecting, sync)
				room.on(RoomEvent.Reconnected, sync)
				room.on(RoomEvent.ParticipantConnected, sync)
				room.on(RoomEvent.ParticipantDisconnected, sync)
				room.on(RoomEvent.ParticipantMetadataChanged, sync)
				room.on(RoomEvent.ParticipantNameChanged, sync)
				room.on(RoomEvent.TrackMuted, sync)
				room.on(RoomEvent.TrackUnmuted, sync)
				room.on(RoomEvent.TrackSubscribed, sync)
				room.on(RoomEvent.TrackUnsubscribed, sync)
				room.on(RoomEvent.LocalTrackPublished, handleLocalTrack)
				room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrack)
				room.on(RoomEvent.ActiveSpeakersChanged, sync)
				room.on(RoomEvent.Disconnected, () => {
					if (!isMountedRef.current || roomRef.current !== room) return
					roomRef.current = null
					setRemoteTracks([])
					setLocalVideoTrack(null)
					setLocalScreenTrack(null)
					setIsInCall(false)
					setIsMuted(true)
					setIsCameraOff(true)
					setIsScreenSharing(false)
					setCallMode(null)
					setStatus(null)

					if (isIntentionalDisconnectRef.current) {
						isIntentionalDisconnectRef.current = false
					} else {
						setError('Disconnected from call.')
					}
					void refreshPreviewParticipants()
				})

				await room.connect(tokenPayload.serverUrl, tokenPayload.participantToken)
				
				// Configure media
				if (!options?.startMuted) await room.localParticipant.setMicrophoneEnabled(true)
				if (mode === 'video') await room.localParticipant.setCameraEnabled(true)

				syncRoomState(room)
			} catch (joinError) {
				await disconnectCurrentRoom(false)
				setError(getErrorMessage(joinError, 'Failed to join call.'))
			} finally {
				if (isMountedRef.current) {
					setIsJoining(false)
					setStatus((currentStatus) => currentStatus === 'Joining...' && !roomRef.current ? null : currentStatus)
				}
			}
		},
		[roomId, isJoining, userId, userName, userColor, sessionIdentity, syncRoomState, disconnectCurrentRoom, refreshPreviewParticipants]
	)

	const leaveCall = useCallback(async () => {
		await disconnectCurrentRoom(true)
		await refreshPreviewParticipants()
	}, [disconnectCurrentRoom, refreshPreviewParticipants])

	const toggleMute = useCallback(async () => {
		const room = roomRef.current
		if (!room) return
		try {
			await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled)
			syncRoomState(room)
		} catch (e) {
			setError(getErrorMessage(e, 'Microphone toggle failed.'))
		}
	}, [syncRoomState])

	const toggleCamera = useCallback(async () => {
		const room = roomRef.current
		if (!room) return
		try {
			await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled)
			syncRoomState(room)
			if (!room.localParticipant.isCameraEnabled && !room.localParticipant.isScreenShareEnabled && callMode === 'video') {
				// We can optionally set call mode to voice if both are off
			}
		} catch (e) {
			setError(getErrorMessage(e, 'Camera toggle failed.'))
		}
	}, [syncRoomState, callMode])

	const toggleScreenShare = useCallback(async () => {
		const room = roomRef.current
		if (!room) return
		try {
			await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled)
			syncRoomState(room)
		} catch (e) {
			setError(getErrorMessage(e, 'Screen share failed.'))
		}
	}, [syncRoomState])

	useEffect(() => {
		isMountedRef.current = true
		return () => { isMountedRef.current = false }
	}, [])

	useEffect(() => {
		if (!roomId || isInCall) return

		const abortController = new AbortController()
		let intervalId: ReturnType<typeof setInterval> | null = null
		let stopped = false

		const poll = async () => {
			if (stopped || roomRef.current) return
			try {
				await refreshPreviewParticipants(abortController.signal)
			} catch (pollError) {
				if (abortController.signal.aborted || stopped) return
				const message = getErrorMessage(pollError, 'Failed to load participants.')
				setError(message)
				if (/not configured/i.test(message) && intervalId) {
					clearInterval(intervalId)
					intervalId = null
				}
			}
		}

		void poll()
		intervalId = setInterval(() => void poll(), PARTICIPANT_POLL_INTERVAL_MS)

		return () => {
			stopped = true
			abortController.abort()
			if (intervalId) clearInterval(intervalId)
		}
	}, [isInCall, refreshPreviewParticipants, roomId])

	useEffect(() => {
		if (!roomId) return
		return () => { void disconnectCurrentRoom(true) }
	}, [disconnectCurrentRoom, roomId])

	return {
		participants,
		remoteTracks,
		localVideoTrack,
		localScreenTrack,
		callMode,
		isInCall,
		isJoining,
		isMuted,
		isCameraOff,
		isScreenSharing,
		status,
		error,
		joinCall,
		leaveCall,
		toggleMute,
		toggleCamera,
		toggleScreenShare,
	}
}
