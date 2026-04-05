import { useCallback, useEffect, useRef, useState } from 'react'
import { OpenVidu, Publisher, Session, Subscriber } from 'openvidu-browser'
import { getApiOrigin } from '../utils/network'

export type OpenViduCallMode = 'voice' | 'video'

export interface OpenViduParticipant {
	connectionId: string
	userId: string
	userName: string
	userColor: string
	isLocal: boolean
	audioActive: boolean
	videoActive: boolean
	screenShare: boolean
}

interface TokenResponse {
	token?: string
	sessionId?: string
	error?: string
}

function getErrorMessage(error: unknown, fallback: string) {
	if (error instanceof Error && error.message) {
		return error.message
	}

	return fallback
}

function isStaleSubscriptionError(error: unknown) {
	const message = getErrorMessage(error, '')
	return (
		message.includes('Code: 102') &&
		message.includes('not found in session')
	)
}

function shouldAttemptRejoin(reason?: string) {
	if (!reason) {
		return true
	}

	return ![
		'disconnect',
		'sessionClosedByServer',
		'forceDisconnectByUser',
		'forceDisconnectByServer',
	].includes(reason)
}

interface UseOpenViduCallReturn {
	localStream: MediaStream | null
	subscribers: Subscriber[]
	participants: OpenViduParticipant[]
	callMode: OpenViduCallMode | null
	isInCall: boolean
	isJoining: boolean
	isMuted: boolean
	isCameraOff: boolean
	isScreenSharing: boolean
	error: string | null
	joinCall: (mode: OpenViduCallMode, options?: { startMuted?: boolean }) => Promise<void>
	leaveCall: () => void
	toggleMute: () => Promise<void>
	toggleCamera: () => Promise<void>
	toggleScreenShare: () => Promise<void>
}

function parseConnectionData(data: string | undefined, fallbackName: string, fallbackColor: string) {
	if (!data) {
		return {
			userId: fallbackName,
			userName: fallbackName,
			userColor: fallbackColor,
		}
	}

	const chunks = data.split('%/%').reverse()
	for (const chunk of chunks) {
		try {
			const parsed = JSON.parse(chunk) as {
				userId?: string
				userName?: string
				userColor?: string
			}
			return {
				userId: parsed.userId || fallbackName,
				userName: parsed.userName || fallbackName,
				userColor: parsed.userColor || fallbackColor,
			}
		} catch {
			// Ignore non-JSON segments such as clientData prefixes.
		}
	}

	return {
		userId: fallbackName,
		userName: fallbackName,
		userColor: fallbackColor,
	}
}

export function useOpenViduCall(
	roomId: string,
	userId: string,
	userName: string,
	userColor = '#64748b'
): UseOpenViduCallReturn {
	const [localStream, setLocalStream] = useState<MediaStream | null>(null)
	const [subscribers, setSubscribers] = useState<Subscriber[]>([])
	const [participants, setParticipants] = useState<OpenViduParticipant[]>([])
	const [callMode, setCallMode] = useState<OpenViduCallMode | null>(null)
	const [isJoining, setIsJoining] = useState(false)
	const [isMuted, setIsMuted] = useState(false)
	const [isCameraOff, setIsCameraOff] = useState(false)
	const [isScreenSharing, setIsScreenSharing] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const sessionRef = useRef<Session | null>(null)
	const publisherRef = useRef<Publisher | null>(null)
	const subscribersRef = useRef<Subscriber[]>([])
	const cameraTrackRef = useRef<MediaStreamTrack | null>(null)
	const screenTrackRef = useRef<MediaStreamTrack | null>(null)
	const joinAttemptRef = useRef(0)
	const activeSessionAttemptRef = useRef(0)
	const rejoinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const intentionalLeaveRef = useRef(false)
	const rejoinCountRef = useRef(0)
	const latestJoinOptionsRef = useRef<{ mode: OpenViduCallMode; startMuted: boolean } | null>(null)

	const clearRejoinTimer = useCallback(() => {
		if (rejoinTimerRef.current) {
			clearTimeout(rejoinTimerRef.current)
			rejoinTimerRef.current = null
		}
	}, [])

	const refreshParticipants = useCallback(() => {
		const nextParticipants: OpenViduParticipant[] = []

		if (sessionRef.current?.connection && publisherRef.current) {
			const localMeta = parseConnectionData(sessionRef.current.connection.data, userName, userColor)
			nextParticipants.push({
				connectionId: sessionRef.current.connection.connectionId,
				userId: localMeta.userId,
				userName: localMeta.userName,
				userColor: localMeta.userColor,
				isLocal: true,
				audioActive: publisherRef.current.stream.audioActive ?? !isMuted,
				videoActive: publisherRef.current.stream.videoActive ?? !isCameraOff,
				screenShare: publisherRef.current.stream.typeOfVideo === 'SCREEN',
			})
		}

		for (const subscriber of subscribersRef.current) {
			const meta = parseConnectionData(subscriber.stream.connection.data, subscriber.stream.connection.connectionId, '#64748b')
			nextParticipants.push({
				connectionId: subscriber.stream.connection.connectionId,
				userId: meta.userId,
				userName: meta.userName,
				userColor: meta.userColor,
				isLocal: false,
				audioActive: subscriber.stream.audioActive ?? false,
				videoActive: subscriber.stream.videoActive ?? false,
				screenShare: subscriber.stream.typeOfVideo === 'SCREEN',
			})
		}

		setParticipants(nextParticipants)
	}, [isCameraOff, isMuted, userColor, userName])

	const cleanupSession = useCallback((options?: { disconnect?: boolean }) => {
		const disconnect = options?.disconnect ?? true
		screenTrackRef.current?.stop()
		screenTrackRef.current = null
		cameraTrackRef.current = null

		if (disconnect && sessionRef.current) {
			sessionRef.current.disconnect()
		}

		sessionRef.current = null
		publisherRef.current = null
		subscribersRef.current = []
		setSubscribers([])
		setParticipants([])
		setLocalStream(null)
		setCallMode(null)
		setIsMuted(false)
		setIsCameraOff(false)
		setIsScreenSharing(false)
	}, [])

	const joinCallRef = useRef<UseOpenViduCallReturn['joinCall'] | null>(null)

	const scheduleRejoin = useCallback(() => {
		if (intentionalLeaveRef.current || !latestJoinOptionsRef.current || rejoinTimerRef.current) {
			return
		}

		const nextDelay = Math.min(1000 * 2 ** rejoinCountRef.current, 5000)
		rejoinTimerRef.current = setTimeout(() => {
			rejoinTimerRef.current = null
			rejoinCountRef.current += 1
			const nextJoin = latestJoinOptionsRef.current
			if (!nextJoin || !joinCallRef.current || intentionalLeaveRef.current) {
				return
			}

			void joinCallRef.current(nextJoin.mode, { startMuted: nextJoin.startMuted })
		}, nextDelay)
	}, [])

	const joinCall = useCallback(async (mode: OpenViduCallMode, options?: { startMuted?: boolean }) => {
		if (!roomId || isJoining) return

		const joinAttempt = ++joinAttemptRef.current
		activeSessionAttemptRef.current = joinAttempt
		intentionalLeaveRef.current = false
		rejoinCountRef.current = 0
		clearRejoinTimer()

		const startMuted = !!options?.startMuted
		latestJoinOptionsRef.current = { mode, startMuted }
		setIsJoining(true)
		setError(null)

		try {
			cleanupSession()

			const response = await fetch(`${getApiOrigin()}/api/openvidu/token`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					roomId,
					userId,
					userName,
					userColor,
				}),
			})
			const payload = (await response.json().catch(() => null)) as TokenResponse | null
			if (!response.ok || !payload?.token) {
				throw new Error(payload?.error || 'Failed to create OpenVidu token.')
			}

			const openVidu = new OpenVidu()
			const session = openVidu.initSession()
			sessionRef.current = session

			session.on('streamCreated', (event) => {
				if (sessionRef.current !== session || activeSessionAttemptRef.current !== joinAttempt) {
					return
				}

				if (event.stream.connection.connectionId === session.connection?.connectionId) {
					return
				}

				if (subscribersRef.current.some((subscriber) => subscriber.stream.streamId === event.stream.streamId)) {
					return
				}

				try {
					const subscriber = session.subscribe(event.stream, undefined)
					subscribersRef.current = [...subscribersRef.current, subscriber]
					setSubscribers(subscribersRef.current)
					refreshParticipants()
				} catch (subscribeError) {
					if (isStaleSubscriptionError(subscribeError)) {
						refreshParticipants()
						return
					}

					console.error('[openvidu] Failed to subscribe to stream:', subscribeError)
					setError(getErrorMessage(subscribeError, 'Failed to subscribe to a participant stream.'))
				}
			})

			session.on('streamDestroyed', (event) => {
				if (sessionRef.current !== session || activeSessionAttemptRef.current !== joinAttempt) {
					return
				}

				subscribersRef.current = subscribersRef.current.filter(
					(subscriber) => subscriber.stream.streamId !== event.stream.streamId
				)
				setSubscribers(subscribersRef.current)
				refreshParticipants()
			})

			session.on('streamPropertyChanged', () => {
				if (sessionRef.current !== session || activeSessionAttemptRef.current !== joinAttempt) {
					return
				}
				refreshParticipants()
			})

			session.on('connectionCreated', () => {
				if (sessionRef.current !== session || activeSessionAttemptRef.current !== joinAttempt) {
					return
				}
				refreshParticipants()
			})

			session.on('connectionDestroyed', () => {
				if (sessionRef.current !== session || activeSessionAttemptRef.current !== joinAttempt) {
					return
				}
				refreshParticipants()
			})

			session.on('reconnecting', () => {
				if (sessionRef.current !== session || activeSessionAttemptRef.current !== joinAttempt) {
					return
				}
				refreshParticipants()
			})

			session.on('reconnected', () => {
				if (sessionRef.current !== session || activeSessionAttemptRef.current !== joinAttempt) {
					return
				}
				refreshParticipants()
			})

			session.on('sessionDisconnected', (event: { reason?: string }) => {
				if (sessionRef.current !== session || activeSessionAttemptRef.current !== joinAttempt) {
					return
				}

				refreshParticipants()

				if (!intentionalLeaveRef.current && shouldAttemptRejoin(event?.reason)) {
					cleanupSession({ disconnect: false })
					scheduleRejoin()
				}
			})

			session.on('exception', (exception) => {
				if (sessionRef.current !== session || activeSessionAttemptRef.current !== joinAttempt) {
					return
				}

				if (isStaleSubscriptionError(exception)) {
					refreshParticipants()
					return
				}

				console.warn('[openvidu] Session exception:', exception)
			})

			await session.connect(payload.token, JSON.stringify({ userId, userName, userColor }))

			if (sessionRef.current !== session || activeSessionAttemptRef.current !== joinAttempt) {
				session.disconnect()
				return
			}

			const publisher = await openVidu.initPublisherAsync(undefined, {
				audioSource: undefined,
				videoSource: mode === 'video' ? undefined : false,
				publishAudio: !startMuted,
				publishVideo: mode === 'video',
				mirror: false,
			})

			await session.publish(publisher)
			if (sessionRef.current !== session || activeSessionAttemptRef.current !== joinAttempt) {
				publisher.stream.getMediaStream().getTracks().forEach((track) => track.stop())
				session.disconnect()
				return
			}

			publisherRef.current = publisher
			setLocalStream(publisher.stream.getMediaStream())
			cameraTrackRef.current = publisher.stream.getMediaStream().getVideoTracks()[0] ?? null
			setCallMode(mode)
			setIsMuted(startMuted)
			setIsCameraOff(mode !== 'video')
			setIsScreenSharing(false)
			refreshParticipants()
		} catch (err) {
			cleanupSession()
			const message = err instanceof Error ? err.message : 'Failed to join OpenVidu call.'
			setError(message)
			scheduleRejoin()
		} finally {
			setIsJoining(false)
		}
	}, [clearRejoinTimer, cleanupSession, isJoining, refreshParticipants, roomId, scheduleRejoin, userColor, userId, userName])

	useEffect(() => {
		joinCallRef.current = joinCall
	}, [joinCall])

	const leaveCall = useCallback(() => {
		intentionalLeaveRef.current = true
		latestJoinOptionsRef.current = null
		clearRejoinTimer()
		cleanupSession()
		setError(null)
	}, [clearRejoinTimer, cleanupSession])

	const toggleMute = useCallback(async () => {
		if (!publisherRef.current) return
		const nextMuted = !isMuted
		publisherRef.current.publishAudio(!nextMuted)
		setIsMuted(nextMuted)
		refreshParticipants()
	}, [isMuted, refreshParticipants])

	const toggleCamera = useCallback(async () => {
		if (!publisherRef.current) return

		if (!publisherRef.current.stream.hasVideo) {
			await joinCall('video', { startMuted: isMuted })
			return
		}

		const nextCameraOff = !isCameraOff
		await publisherRef.current.publishVideo(!nextCameraOff)
		setIsCameraOff(nextCameraOff)
		refreshParticipants()
	}, [isCameraOff, isMuted, joinCall, refreshParticipants])

	const toggleScreenShare = useCallback(async () => {
		if (!publisherRef.current) return

		if (isScreenSharing) {
			const cameraTrack = cameraTrackRef.current
			if (cameraTrack) {
				await publisherRef.current.replaceTrack(cameraTrack)
				setLocalStream(publisherRef.current.stream.getMediaStream())
			}
			screenTrackRef.current?.stop()
			screenTrackRef.current = null
			setIsScreenSharing(false)
			refreshParticipants()
			return
		}

		if (!publisherRef.current.stream.hasVideo) {
			await joinCall('video', { startMuted: isMuted })
			return
		}

		const screenStream = await navigator.mediaDevices.getDisplayMedia({
			video: true,
			audio: false,
		})
		const nextScreenTrack = screenStream.getVideoTracks()[0]
		if (!nextScreenTrack) {
			throw new Error('No screen track was returned.')
		}

		cameraTrackRef.current = publisherRef.current.stream.getMediaStream().getVideoTracks()[0] ?? cameraTrackRef.current
		screenTrackRef.current = nextScreenTrack
		nextScreenTrack.onended = () => {
			void toggleScreenShare()
		}
		await publisherRef.current.replaceTrack(nextScreenTrack)
		setLocalStream(publisherRef.current.stream.getMediaStream())
		setIsCameraOff(false)
		setIsScreenSharing(true)
		refreshParticipants()
	}, [isMuted, isScreenSharing, joinCall, refreshParticipants])

	const isInCall = Boolean(callMode && publisherRef.current)

	useEffect(() => () => {
		intentionalLeaveRef.current = true
		latestJoinOptionsRef.current = null
		clearRejoinTimer()
		cleanupSession()
	}, [clearRejoinTimer, cleanupSession])

	return {
		localStream,
		subscribers,
		participants,
		callMode,
		isInCall,
		isJoining,
		isMuted,
		isCameraOff,
		isScreenSharing,
		error,
		joinCall,
		leaveCall,
		toggleMute,
		toggleCamera,
		toggleScreenShare,
	}
}
