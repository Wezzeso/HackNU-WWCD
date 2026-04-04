import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveWsUrl } from '../utils/network'

export type ChannelKind = 'voice' | 'video'

export interface MediaChannel {
	id: string
	name: string
	kind: ChannelKind
	description: string
}

export interface ChannelParticipant {
	peerId: string
	userId: string
	userName: string
	userColor: string
	channelId: string | null
	channelKind: ChannelKind | null
	audio: boolean
	video: boolean
	screenShare: boolean
}

export interface PeerConnection {
	peerId: string
	userName?: string
	userColor?: string
	connection: RTCPeerConnection
	stream?: MediaStream
	audio: boolean
	video: boolean
	screenShare: boolean
}

type WindowWithTurnConfig = Window & {
	__TURN_SERVER_URL__?: string
	__TURN_SERVER_USERNAME__?: string
	__TURN_SERVER_PASSWORD__?: string
}

interface UseWebRTCReturn {
	localStream: MediaStream | null
	displayStream: MediaStream | null
	peers: Map<string, PeerConnection>
	participants: ChannelParticipant[]
	activeChannelId: string | null
	activeChannelKind: ChannelKind | null
	isInCall: boolean
	isConnected: boolean
	isJoiningChannel: boolean
	isMuted: boolean
	isCameraOff: boolean
	isScreenSharing: boolean
	error: string | null
	joinCall: () => Promise<void>
	joinChannel: (channel: MediaChannel, options?: { startMuted?: boolean }) => Promise<void>
	leaveCall: () => void
	leaveChannel: () => void
	toggleMute: () => void
	toggleCamera: () => void
	toggleScreenShare: () => Promise<void>
}

const DEFAULT_VIDEO_CHANNEL: MediaChannel = {
	id: 'video-lounge',
	name: 'Video Lounge',
	kind: 'video',
	description: 'Fallback channel for legacy call panels.',
}

function createSessionPeerId(userId: string) {
	const randomPart =
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID().slice(0, 8)
			: Math.random().toString(36).slice(2, 10)

	return `${userId}-${randomPart}`
}

function getVisibleVideoState(
	channelKind: ChannelKind | null,
	cameraEnabled: boolean,
	screenSharing: boolean
) {
	if (channelKind !== 'video') return false
	return screenSharing || cameraEnabled
}

export function useWebRTC(
	roomId: string,
	userId: string,
	userName: string,
	userColor = '#64748b'
): UseWebRTCReturn {
	const [localStream, setLocalStream] = useState<MediaStream | null>(null)
	const [displayStream, setDisplayStream] = useState<MediaStream | null>(null)
	const [participants, setParticipants] = useState<ChannelParticipant[]>([])
	const [peers, setPeers] = useState<Map<string, PeerConnection>>(new Map())
	const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
	const [activeChannelKind, setActiveChannelKind] = useState<ChannelKind | null>(null)
	const [isConnected, setIsConnected] = useState(false)
	const [isJoiningChannel, setIsJoiningChannel] = useState(false)
	const [isMuted, setIsMuted] = useState(false)
	const [isCameraOff, setIsCameraOff] = useState(false)
	const [isScreenSharing, setIsScreenSharing] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const sessionPeerId = useMemo(() => createSessionPeerId(userId), [userId])
	const wsRef = useRef<WebSocket | null>(null)
	const peersRef = useRef<Map<string, PeerConnection>>(new Map())
	const localStreamRef = useRef<MediaStream | null>(null)
	const screenStreamRef = useRef<MediaStream | null>(null)
	const participantsRef = useRef<ChannelParticipant[]>([])
	const activeChannelIdRef = useRef<string | null>(null)
	const activeChannelKindRef = useRef<ChannelKind | null>(null)
	const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const reconnectAttemptRef = useRef(0)
	const shouldReconnectRef = useRef(true)

	const ICE_SERVERS = useMemo(() => {
		const servers: RTCIceServer[] = [
			{ urls: 'stun:stun.l.google.com:19302' },
			{ urls: 'stun:stun1.l.google.com:19302' },
		]

		if (typeof window !== 'undefined') {
			const configuredWindow = window as WindowWithTurnConfig
			const turnUrl = configuredWindow.__TURN_SERVER_URL__
			if (turnUrl) {
				servers.push({
					urls: turnUrl,
					username: configuredWindow.__TURN_SERVER_USERNAME__,
					credential: configuredWindow.__TURN_SERVER_PASSWORD__,
				})
			}
		}

		return servers
	}, [])

	useEffect(() => {
		activeChannelIdRef.current = activeChannelId
	}, [activeChannelId])

	useEffect(() => {
		activeChannelKindRef.current = activeChannelKind
	}, [activeChannelKind])

	useEffect(() => {
		participantsRef.current = participants
	}, [participants])

	const updatePeerRecord = useCallback(
		(peerId: string, updater: (existing: PeerConnection) => PeerConnection) => {
			const existing = peersRef.current.get(peerId)
			if (!existing) return
			peersRef.current.set(peerId, updater(existing))
			setPeers(new Map(peersRef.current))
		},
		[]
	)

	const removePeer = useCallback((targetPeerId: string) => {
		const existing = peersRef.current.get(targetPeerId)
		if (!existing) return

		existing.connection.ontrack = null
		existing.connection.onicecandidate = null
		existing.connection.onconnectionstatechange = null
		existing.connection.close()
		peersRef.current.delete(targetPeerId)
		pendingIceCandidatesRef.current.delete(targetPeerId)
		setPeers(new Map(peersRef.current))
	}, [])

	const clearPeerConnections = useCallback(() => {
		for (const peerId of Array.from(peersRef.current.keys())) {
			removePeer(peerId)
		}
	}, [removePeer])

	const stopScreenShare = useCallback(
		(shouldBroadcast = true) => {
			screenStreamRef.current?.getTracks().forEach((track) => track.stop())
			screenStreamRef.current = null
			setIsScreenSharing(false)
			setDisplayStream(localStreamRef.current)

			const cameraTrack = localStreamRef.current?.getVideoTracks()[0]
			if (cameraTrack) {
				for (const peer of peersRef.current.values()) {
					const sender = peer.connection.getSenders().find((item) => item.track?.kind === 'video')
					if (sender) {
						void sender.replaceTrack(cameraTrack)
					}
				}
			}

			if (shouldBroadcast && wsRef.current?.readyState === WebSocket.OPEN) {
				wsRef.current.send(
					JSON.stringify({
						type: 'media-state',
						audio: !isMuted,
						video: getVisibleVideoState(
							activeChannelKindRef.current,
							!isCameraOff,
							false
						),
						screenShare: false,
					})
				)
			}
		},
		[isCameraOff, isMuted]
	)

	const stopLocalMedia = useCallback(() => {
		stopScreenShare(false)
		localStreamRef.current?.getTracks().forEach((track) => track.stop())
		localStreamRef.current = null
		setLocalStream(null)
		setDisplayStream(null)
	}, [stopScreenShare])

	const flushPendingIceCandidates = useCallback(async (targetPeerId: string) => {
		const peer = peersRef.current.get(targetPeerId)
		if (!peer?.connection.remoteDescription) return

		const pending = pendingIceCandidatesRef.current.get(targetPeerId)
		if (!pending?.length) return

		for (const candidate of pending) {
			try {
				await peer.connection.addIceCandidate(candidate)
			} catch (err) {
				console.error('[webrtc] Failed to add queued ICE candidate:', err)
			}
		}

		pendingIceCandidatesRef.current.delete(targetPeerId)
	}, [])

	const queueIceCandidate = useCallback(
		async (targetPeerId: string, candidate: RTCIceCandidateInit) => {
			const peer = peersRef.current.get(targetPeerId)
			if (peer?.connection.remoteDescription) {
				try {
					await peer.connection.addIceCandidate(candidate)
				} catch (err) {
					console.error('[webrtc] Failed to add ICE candidate:', err)
				}
				return
			}

			const pending = pendingIceCandidatesRef.current.get(targetPeerId) ?? []
			pending.push(candidate)
			pendingIceCandidatesRef.current.set(targetPeerId, pending)
		},
		[]
	)

	const createPeerConnection = useCallback(
		(targetPeerId: string, participant?: ChannelParticipant) => {
			const existing = peersRef.current.get(targetPeerId)
			if (existing) return existing.connection

			const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS })

			if (localStreamRef.current) {
				for (const track of localStreamRef.current.getTracks()) {
					connection.addTrack(track, localStreamRef.current)
				}
			}

			connection.ontrack = (event) => {
				updatePeerRecord(targetPeerId, (peer) => ({
					...peer,
					stream: event.streams[0],
				}))
			}

			connection.onicecandidate = (event) => {
				if (!event.candidate || wsRef.current?.readyState !== WebSocket.OPEN) return

				wsRef.current.send(
					JSON.stringify({
						type: 'ice-candidate',
						targetPeerId,
						candidate: event.candidate,
					})
				)
			}

			connection.onconnectionstatechange = () => {
				if (
					connection.connectionState === 'failed' ||
					connection.connectionState === 'closed' ||
					connection.connectionState === 'disconnected'
				) {
					removePeer(targetPeerId)
				}
			}

			peersRef.current.set(targetPeerId, {
				peerId: targetPeerId,
				userName: participant?.userName,
				userColor: participant?.userColor,
				connection,
				audio: participant?.audio ?? true,
				video: participant?.video ?? false,
				screenShare: participant?.screenShare ?? false,
			})
			setPeers(new Map(peersRef.current))

			return connection
		},
		[ICE_SERVERS, removePeer, updatePeerRecord]
	)

	const broadcastMediaState = useCallback(
		(audioEnabled: boolean, videoEnabled: boolean, screenShare: boolean) => {
			if (wsRef.current?.readyState !== WebSocket.OPEN) return

			wsRef.current.send(
				JSON.stringify({
					type: 'media-state',
					audio: audioEnabled,
					video: videoEnabled,
					screenShare,
				})
			)
		},
		[]
	)

	const sendJoinPayload = useCallback((socket: WebSocket) => {
		socket.send(
			JSON.stringify({
				type: 'join',
				peerId: sessionPeerId,
				userId,
				userName,
				userColor,
			})
		)
	}, [sessionPeerId, userColor, userId, userName])

	const syncCurrentChannel = useCallback((socket: WebSocket) => {
		if (
			!activeChannelIdRef.current ||
			!activeChannelKindRef.current ||
			!localStreamRef.current
		) {
			return
		}

		const audioEnabled = localStreamRef.current.getAudioTracks()[0]?.enabled ?? false
		const cameraEnabled = localStreamRef.current.getVideoTracks()[0]?.enabled ?? false
		socket.send(
			JSON.stringify({
				type: 'set-channel',
				channelId: activeChannelIdRef.current,
				channelKind: activeChannelKindRef.current,
				audio: audioEnabled,
				video: getVisibleVideoState(
					activeChannelKindRef.current,
					cameraEnabled,
					isScreenSharing
				),
				screenShare: isScreenSharing,
			})
		)
	}, [isScreenSharing])

	const leaveChannel = useCallback(() => {
		clearPeerConnections()
		stopLocalMedia()
		setActiveChannelId(null)
		setActiveChannelKind(null)
		setIsMuted(false)
		setIsCameraOff(false)
		setIsScreenSharing(false)
		setError(null)

		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'leave-channel' }))
		}
	}, [clearPeerConnections, stopLocalMedia])

	const joinChannel = useCallback(
		async (channel: MediaChannel, options?: { startMuted?: boolean }) => {
			if (!roomId) return
			if (wsRef.current?.readyState !== WebSocket.OPEN) {
				setError('Realtime signaling is still connecting. Try again in a moment.')
				return
			}

			setError(null)
			setIsJoiningChannel(true)

			try {
				clearPeerConnections()
				stopLocalMedia()

				const stream = await navigator.mediaDevices.getUserMedia({
					audio: true,
					video: channel.kind === 'video',
				})
				const startMuted = !!options?.startMuted
				const audioTrack = stream.getAudioTracks()[0]
				if (audioTrack) {
					audioTrack.enabled = !startMuted
				}

				localStreamRef.current = stream
				setLocalStream(stream)
				setDisplayStream(stream)
				setActiveChannelId(channel.id)
				setActiveChannelKind(channel.kind)
				setIsMuted(startMuted)
				setIsCameraOff(channel.kind !== 'video')
				setIsScreenSharing(false)

				wsRef.current.send(
					JSON.stringify({
						type: 'set-channel',
						channelId: channel.id,
						channelKind: channel.kind,
						audio: !startMuted,
						video: channel.kind === 'video',
						screenShare: false,
					})
				)
			} catch (err) {
				console.error('[webrtc] Failed to join channel:', err)
				leaveChannel()
				setError('Camera or microphone access was blocked.')
			} finally {
				setIsJoiningChannel(false)
			}
		},
		[clearPeerConnections, leaveChannel, roomId, stopLocalMedia]
	)

	const joinCall = useCallback(async () => {
		await joinChannel(DEFAULT_VIDEO_CHANNEL)
	}, [joinChannel])

	useEffect(() => {
		if (!roomId || !userId) return

		shouldReconnectRef.current = true

		const scheduleReconnect = () => {
			if (!shouldReconnectRef.current || reconnectTimerRef.current) return

			const timeout = Math.min(1000 * 2 ** reconnectAttemptRef.current, 5000)
			reconnectTimerRef.current = setTimeout(() => {
				reconnectTimerRef.current = null
				reconnectAttemptRef.current += 1
				connect()
			}, timeout)
		}

		const connect = () => {
			void (async () => {
				const url = await resolveWsUrl(`/api/signal/${roomId}`)
				if (!shouldReconnectRef.current) return

				const ws = new WebSocket(url)
				wsRef.current = ws

				ws.onopen = () => {
					reconnectAttemptRef.current = 0
					setIsConnected(true)
					setError(null)
					sendJoinPayload(ws)
					syncCurrentChannel(ws)
				}

				ws.onmessage = async (event) => {
					const msg = JSON.parse(event.data)

					switch (msg.type) {
						case 'presence': {
							setParticipants(msg.participants)
							break
						}

						case 'offer': {
							const participant = participantsRef.current.find((item) => item.peerId === msg.fromPeerId)
							const connection = createPeerConnection(msg.fromPeerId, participant)
							await connection.setRemoteDescription(msg.offer)
							await flushPendingIceCandidates(msg.fromPeerId)
							const answer = await connection.createAnswer()
							await connection.setLocalDescription(answer)

							if (ws.readyState === WebSocket.OPEN) {
								ws.send(
									JSON.stringify({
										type: 'answer',
										targetPeerId: msg.fromPeerId,
										answer,
									})
								)
							}
							break
						}

						case 'answer': {
							const peer = peersRef.current.get(msg.fromPeerId)
							if (!peer) break
							await peer.connection.setRemoteDescription(msg.answer)
							await flushPendingIceCandidates(msg.fromPeerId)
							break
						}

						case 'ice-candidate': {
							await queueIceCandidate(msg.fromPeerId, msg.candidate)
							break
						}
					}
				}

				ws.onclose = () => {
					setIsConnected(false)
					setParticipants([])
					clearPeerConnections()
					if (shouldReconnectRef.current) {
						setError('Reconnecting to realtime voice...')
						scheduleReconnect()
					}
				}

				ws.onerror = () => {
					setIsConnected(false)
				}
			})()
		}

		connect()

		return () => {
			shouldReconnectRef.current = false
			if (reconnectTimerRef.current) {
				clearTimeout(reconnectTimerRef.current)
				reconnectTimerRef.current = null
			}
			wsRef.current?.close()
			leaveChannel()
		}
	}, [
		clearPeerConnections,
		createPeerConnection,
		flushPendingIceCandidates,
		leaveChannel,
		queueIceCandidate,
		roomId,
		sendJoinPayload,
		syncCurrentChannel,
		userColor,
		userId,
		userName,
	])

	useEffect(() => {
		if (!activeChannelId || !activeChannelKind) {
			clearPeerConnections()
			return
		}

		const inChannelParticipants = participants.filter(
			(participant) =>
				participant.peerId !== sessionPeerId &&
				participant.channelId === activeChannelId &&
				participant.channelKind === activeChannelKind
		)
		const participantIds = new Set(inChannelParticipants.map((participant) => participant.peerId))

		for (const existingPeerId of peersRef.current.keys()) {
			if (!participantIds.has(existingPeerId)) {
				removePeer(existingPeerId)
			}
		}

		for (const participant of inChannelParticipants) {
			const existingPeer = peersRef.current.get(participant.peerId)
			if (existingPeer) {
				peersRef.current.set(participant.peerId, {
					...existingPeer,
					userName: participant.userName,
					userColor: participant.userColor,
					audio: participant.audio,
					video: participant.video,
					screenShare: participant.screenShare,
				})
				continue
			}

			const connection = createPeerConnection(participant.peerId, participant)
			if (sessionPeerId < participant.peerId) {
				void (async () => {
					const offer = await connection.createOffer()
					await connection.setLocalDescription(offer)
					if (wsRef.current?.readyState === WebSocket.OPEN) {
						wsRef.current.send(
							JSON.stringify({
								type: 'offer',
								targetPeerId: participant.peerId,
								offer,
							})
						)
					}
				})()
			}
		}

		setPeers(new Map(peersRef.current))
	}, [
		activeChannelId,
		activeChannelKind,
		clearPeerConnections,
		createPeerConnection,
		participants,
		removePeer,
		sessionPeerId,
	])

	const toggleMute = useCallback(() => {
		const audioTrack = localStreamRef.current?.getAudioTracks()[0]
		if (!audioTrack) return

		audioTrack.enabled = !audioTrack.enabled
		const nextIsMuted = !audioTrack.enabled
		setIsMuted(nextIsMuted)
		broadcastMediaState(
			!nextIsMuted,
			getVisibleVideoState(activeChannelKindRef.current, !isCameraOff, isScreenSharing),
			isScreenSharing
		)
	}, [broadcastMediaState, isCameraOff, isScreenSharing])

	const toggleCamera = useCallback(() => {
		if (activeChannelKindRef.current !== 'video') return

		const cameraTrack = localStreamRef.current?.getVideoTracks()[0]
		if (!cameraTrack) return

		cameraTrack.enabled = !cameraTrack.enabled
		const nextCameraOff = !cameraTrack.enabled
		setIsCameraOff(nextCameraOff)
		broadcastMediaState(!isMuted, getVisibleVideoState('video', !nextCameraOff, isScreenSharing), isScreenSharing)
	}, [broadcastMediaState, isMuted, isScreenSharing])

	const toggleScreenShare = useCallback(async () => {
		if (activeChannelKindRef.current !== 'video') return

		if (isScreenSharing) {
			stopScreenShare(true)
			return
		}

		try {
			const screenStream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: false,
			})
			const screenTrack = screenStream.getVideoTracks()[0]
			screenStreamRef.current = screenStream
			setIsScreenSharing(true)
			setDisplayStream(screenStream)

			for (const peer of peersRef.current.values()) {
				const sender = peer.connection.getSenders().find((item) => item.track?.kind === 'video')
				if (sender) {
					void sender.replaceTrack(screenTrack)
				}
			}

			screenTrack.onended = () => {
				stopScreenShare(true)
			}

			broadcastMediaState(!isMuted, true, true)
		} catch (err) {
			console.error('[webrtc] Screen share failed:', err)
			setError('Screen sharing could not be started.')
		}
	}, [broadcastMediaState, isMuted, isScreenSharing, stopScreenShare])

	const leaveCall = leaveChannel

	const isInCall = !!activeChannelId

	return {
		localStream,
		displayStream,
		peers,
		participants,
		activeChannelId,
		activeChannelKind,
		isInCall,
		isConnected,
		isJoiningChannel,
		isMuted,
		isCameraOff,
		isScreenSharing,
		error,
		joinCall,
		joinChannel,
		leaveCall,
		leaveChannel,
		toggleMute,
		toggleCamera,
		toggleScreenShare,
	}
}
