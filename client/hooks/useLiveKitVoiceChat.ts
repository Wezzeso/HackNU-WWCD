import {
	ConnectionState,
	Room,
	RoomEvent,
	Track,
	type Participant,
	type RemoteAudioTrack,
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

export interface VoiceChatParticipant {
	participantId: string
	userId: string
	userName: string
	userColor: string
	isLocal: boolean
	isMuted: boolean
	isSpeaking: boolean
	joinedAtMs: number
}

export interface RemoteAudioTrackEntry {
	id: string
	participantId: string
	track: RemoteAudioTrack
}

interface UseLiveKitVoiceChatReturn {
	participants: VoiceChatParticipant[]
	remoteAudioTracks: RemoteAudioTrackEntry[]
	isInVoiceChat: boolean
	isJoining: boolean
	isMuted: boolean
	status: string | null
	error: string | null
	joinVoiceChat: (options?: { startMuted?: boolean }) => Promise<void>
	leaveVoiceChat: () => Promise<void>
	toggleMute: () => Promise<void>
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
		}
	} catch {
		return {}
	}
}

function sortParticipants(left: VoiceChatParticipant, right: VoiceChatParticipant) {
	if (left.joinedAtMs !== right.joinedAtMs) {
		return left.joinedAtMs - right.joinedAtMs
	}

	return left.userName.localeCompare(right.userName)
}

function buildParticipantSnapshot(
	participant: Participant,
	localIdentity: string,
	fallbackUserName: string,
	fallbackUserColor: string
): VoiceChatParticipant {
	const metadata = parseParticipantMetadata(participant.metadata)

	return {
		participantId: participant.identity,
		userId: metadata.userId || participant.identity,
		userName: participant.name || metadata.userName || fallbackUserName,
		userColor: metadata.userColor || fallbackUserColor || DEFAULT_USER_COLOR,
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
	fallbackUserColor: string
) {
	const participants = [
		buildParticipantSnapshot(
			room.localParticipant,
			localIdentity,
			fallbackUserName,
			fallbackUserColor
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

function buildRemoteAudioTracks(room: Room) {
	const tracks: RemoteAudioTrackEntry[] = []

	for (const participant of room.remoteParticipants.values()) {
		for (const publication of participant.audioTrackPublications.values()) {
			if (publication.source !== Track.Source.Microphone) {
				continue
			}

			const track = publication.audioTrack as RemoteAudioTrack | undefined
			if (!track) {
				continue
			}

			tracks.push({
				id: `${participant.identity}-${publication.trackSid}`,
				participantId: participant.identity,
				track,
			})
		}
	}

	return tracks
}

export function useLiveKitVoiceChat(
	roomId: string,
	userId: string,
	userName: string,
	userColor = DEFAULT_USER_COLOR
): UseLiveKitVoiceChatReturn {
	const [participants, setParticipants] = useState<VoiceChatParticipant[]>([])
	const [remoteAudioTracks, setRemoteAudioTracks] = useState<RemoteAudioTrackEntry[]>([])
	const [isJoining, setIsJoining] = useState(false)
	const [isInVoiceChat, setIsInVoiceChat] = useState(false)
	const [isMuted, setIsMuted] = useState(true)
	const [status, setStatus] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const sessionIdentity = useMemo(() => createSessionIdentity(userId), [userId])
	const roomRef = useRef<Room | null>(null)
	const isMountedRef = useRef(true)
	const isIntentionalDisconnectRef = useRef(false)

	const syncRoomState = useCallback(
		(room: Room) => {
			if (!isMountedRef.current || roomRef.current !== room) {
				return
			}

			setParticipants(
				buildRoomParticipants(room, sessionIdentity, userName, userColor)
			)
			setRemoteAudioTracks(buildRemoteAudioTracks(room))
			setIsMuted(!room.localParticipant.isMicrophoneEnabled)
			setIsInVoiceChat(room.state !== ConnectionState.Disconnected)

			if (
				room.state === ConnectionState.Reconnecting ||
				room.state === ConnectionState.SignalReconnecting
			) {
				setStatus('Reconnecting to LiveKit voice...')
			} else if (room.state === ConnectionState.Connecting) {
				setStatus('Joining LiveKit voice...')
			} else {
				setStatus(null)
				setError(null)
			}
		},
		[sessionIdentity, userColor, userName]
	)

	const refreshPreviewParticipants = useCallback(
		async (signal?: AbortSignal) => {
			if (!roomId || roomRef.current) {
				return
			}

			const response = await fetch(
				`${getApiOrigin()}/api/livekit/participants/${encodeURIComponent(roomId)}`,
				{ signal }
			)
			const payload = (await response.json().catch(() => null)) as ParticipantsResponse | null

			if (!response.ok) {
				throw new Error(payload?.error || 'Failed to load LiveKit participants.')
			}

			if (!isMountedRef.current || roomRef.current) {
				return
			}

			setParticipants(
				(payload?.participants ?? [])
					.map((participant) => ({
						...participant,
						isLocal: participant.participantId === sessionIdentity,
						isSpeaking: false,
					}))
					.sort(sortParticipants)
			)
			setError(null)
		},
		[roomId, sessionIdentity]
	)

	const disconnectCurrentRoom = useCallback(
		async (intentional: boolean) => {
			const room = roomRef.current
			roomRef.current = null
			isIntentionalDisconnectRef.current = intentional

			setRemoteAudioTracks([])
			setIsInVoiceChat(false)
			setIsMuted(true)
			setStatus(null)

			if (room) {
				await room.disconnect(true).catch(() => undefined)
			}

			if (intentional) {
				setError(null)
			}
		},
		[]
	)

	const joinVoiceChat = useCallback(
		async (options?: { startMuted?: boolean }) => {
			if (!roomId || isJoining || roomRef.current) {
				return
			}

			setIsJoining(true)
			setError(null)
			setStatus('Joining LiveKit voice...')

			try {
				const participantMetadata = {
					userId,
					userName,
					userColor,
				}

				const tokenResponse = await fetch(`${getApiOrigin()}/api/livekit/token`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						roomId,
						participantIdentity: sessionIdentity,
						participantName: userName,
						participantMetadata,
					}),
				})

				const tokenPayload = (await tokenResponse.json().catch(() => null)) as TokenResponse | null

				if (!tokenResponse.ok || !tokenPayload?.serverUrl || !tokenPayload?.participantToken) {
					throw new Error(tokenPayload?.error || 'Failed to create a LiveKit join token.')
				}

				const room = new Room()
				roomRef.current = room
				isIntentionalDisconnectRef.current = false

				const sync = () => syncRoomState(room)
				const handleDisconnected = () => {
					if (!isMountedRef.current || roomRef.current !== room) {
						return
					}

					roomRef.current = null
					setRemoteAudioTracks([])
					setIsInVoiceChat(false)
					setIsMuted(true)
					setStatus(null)

					if (isIntentionalDisconnectRef.current) {
						isIntentionalDisconnectRef.current = false
						void refreshPreviewParticipants()
						return
					}

					setError('Disconnected from LiveKit voice chat.')
					void refreshPreviewParticipants()
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
				room.on(RoomEvent.LocalTrackPublished, sync)
				room.on(RoomEvent.LocalTrackUnpublished, sync)
				room.on(RoomEvent.ActiveSpeakersChanged, sync)
				room.on(RoomEvent.Disconnected, handleDisconnected)

				await room.connect(tokenPayload.serverUrl, tokenPayload.participantToken)
				await room.startAudio().catch(() => undefined)

				if (!options?.startMuted) {
					await room.localParticipant.setMicrophoneEnabled(true)
				}

				syncRoomState(room)
			} catch (joinError) {
				await disconnectCurrentRoom(false)
				setError(getErrorMessage(joinError, 'Failed to join LiveKit voice chat.'))
			} finally {
				if (isMountedRef.current) {
					setIsJoining(false)
					setStatus((currentStatus) =>
						currentStatus === 'Joining LiveKit voice...' && !roomRef.current
							? null
							: currentStatus
					)
				}
			}
		},
		[
			disconnectCurrentRoom,
			isJoining,
			refreshPreviewParticipants,
			roomId,
			sessionIdentity,
			syncRoomState,
			userColor,
			userId,
			userName,
		]
	)

	const leaveVoiceChat = useCallback(async () => {
		await disconnectCurrentRoom(true)
		await refreshPreviewParticipants()
	}, [disconnectCurrentRoom, refreshPreviewParticipants])

	const toggleMute = useCallback(async () => {
		const room = roomRef.current
		if (!room) {
			return
		}

		const nextMicEnabled = !room.localParticipant.isMicrophoneEnabled

		try {
			await room.localParticipant.setMicrophoneEnabled(nextMicEnabled)
			syncRoomState(room)
		} catch (toggleError) {
			setError(getErrorMessage(toggleError, 'Microphone access was blocked.'))
		}
	}, [syncRoomState])

	useEffect(() => {
		isMountedRef.current = true

		return () => {
			isMountedRef.current = false
		}
	}, [])

	useEffect(() => {
		if (!roomId || isInVoiceChat) {
			return
		}

		const abortController = new AbortController()
		let intervalId: ReturnType<typeof setInterval> | null = null
		let stopped = false

		const poll = async () => {
			if (stopped || roomRef.current) {
				return
			}

			try {
				await refreshPreviewParticipants(abortController.signal)
			} catch (pollError) {
				if (abortController.signal.aborted || stopped) {
					return
				}

				const message = getErrorMessage(
					pollError,
					'Failed to load LiveKit participants.'
				)
				setError(message)

				if (/LiveKit is not configured/i.test(message) && intervalId) {
					clearInterval(intervalId)
					intervalId = null
				}
			}
		}

		void poll()
		intervalId = setInterval(() => {
			void poll()
		}, PARTICIPANT_POLL_INTERVAL_MS)

		return () => {
			stopped = true
			abortController.abort()
			if (intervalId) {
				clearInterval(intervalId)
			}
		}
	}, [isInVoiceChat, refreshPreviewParticipants, roomId])

	useEffect(() => {
		if (!roomId) {
			return
		}

		return () => {
			void disconnectCurrentRoom(true)
		}
	}, [disconnectCurrentRoom, roomId])

	return {
		participants,
		remoteAudioTracks,
		isInVoiceChat,
		isJoining,
		isMuted,
		status,
		error,
		joinVoiceChat,
		leaveVoiceChat,
		toggleMute,
	}
}
