import { useState, useEffect, useRef, useCallback } from 'react'
import { getWsUrl } from '../utils/network'

interface PeerConnection {
	peerId: string
	userName?: string
	connection: RTCPeerConnection
	stream?: MediaStream
	audio: boolean
	video: boolean
	screenShare: boolean
}

interface UseWebRTCReturn {
	localStream: MediaStream | null
	peers: Map<string, PeerConnection>
	isInCall: boolean
	isMuted: boolean
	isCameraOff: boolean
	isScreenSharing: boolean
	joinCall: () => Promise<void>
	leaveCall: () => void
	toggleMute: () => void
	toggleCamera: () => void
	toggleScreenShare: () => Promise<void>
}

export function useWebRTC(roomId: string, peerId: string, userName: string): UseWebRTCReturn {
	const [localStream, setLocalStream] = useState<MediaStream | null>(null)
	const [peers, setPeers] = useState<Map<string, PeerConnection>>(new Map())
	const [isInCall, setIsInCall] = useState(false)
	const [isMuted, setIsMuted] = useState(false)
	const [isCameraOff, setIsCameraOff] = useState(false)
	const [isScreenSharing, setIsScreenSharing] = useState(false)

	const wsRef = useRef<WebSocket | null>(null)
	const peersRef = useRef<Map<string, PeerConnection>>(new Map())
	const localStreamRef = useRef<MediaStream | null>(null)
	const screenStreamRef = useRef<MediaStream | null>(null)

	const ICE_SERVERS = [
		{ urls: 'stun:stun.l.google.com:19302' },
		{ urls: 'stun:stun1.l.google.com:19302' },
	]

	// Add TURN server if configured
	if (typeof window !== 'undefined') {
		const turnUrl = (window as any).__TURN_SERVER_URL__
		if (turnUrl) {
			ICE_SERVERS.push({
				urls: turnUrl,
				username: (window as any).__TURN_SERVER_USERNAME__,
				credential: (window as any).__TURN_SERVER_PASSWORD__,
			} as any)
		}
	}

	const createPeerConnection = useCallback((targetPeerId: string): RTCPeerConnection => {
		const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

		// Add local tracks
		if (localStreamRef.current) {
			localStreamRef.current.getTracks().forEach(track => {
				pc.addTrack(track, localStreamRef.current!)
			})
		}

		// Handle incoming tracks
		pc.ontrack = (event) => {
			const existing = peersRef.current.get(targetPeerId)
			if (existing) {
				existing.stream = event.streams[0]
				peersRef.current.set(targetPeerId, { ...existing })
				setPeers(new Map(peersRef.current))
			}
		}

		// Handle ICE candidates
		pc.onicecandidate = (event) => {
			if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
				wsRef.current.send(JSON.stringify({
					type: 'ice-candidate',
					targetPeerId,
					candidate: event.candidate,
				}))
			}
		}

		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
				removePeer(targetPeerId)
			}
		}

		return pc
	}, [])

	const removePeer = useCallback((targetPeerId: string) => {
		const existing = peersRef.current.get(targetPeerId)
		if (existing) {
			existing.connection.close()
			peersRef.current.delete(targetPeerId)
			setPeers(new Map(peersRef.current))
		}
	}, [])

	const joinCall = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: true,
			})
			localStreamRef.current = stream
			setLocalStream(stream)
			setIsInCall(true)

			// Connect to signaling server
			const ws = new WebSocket(getWsUrl(`/api/signal/${roomId}`))
			wsRef.current = ws

			ws.onopen = () => {
				ws.send(JSON.stringify({ type: 'join', peerId, userName }))
			}

			ws.onmessage = async (event) => {
				const msg = JSON.parse(event.data)

				switch (msg.type) {
					case 'peers': {
						// Create offers to all existing peers
						for (const existingPeerId of msg.peers) {
							const pc = createPeerConnection(existingPeerId)
							peersRef.current.set(existingPeerId, {
								peerId: existingPeerId,
								connection: pc,
								audio: true,
								video: true,
								screenShare: false,
							})

							const offer = await pc.createOffer()
							await pc.setLocalDescription(offer)
							ws.send(JSON.stringify({
								type: 'offer',
								targetPeerId: existingPeerId,
								offer,
							}))
						}
						setPeers(new Map(peersRef.current))
						break
					}

					case 'peer-joined': {
						// New peer joined, wait for their offer
						break
					}

					case 'offer': {
						const pc = createPeerConnection(msg.fromPeerId)
						peersRef.current.set(msg.fromPeerId, {
							peerId: msg.fromPeerId,
							userName: msg.userName,
							connection: pc,
							audio: true,
							video: true,
							screenShare: false,
						})

						await pc.setRemoteDescription(msg.offer)
						const answer = await pc.createAnswer()
						await pc.setLocalDescription(answer)
						ws.send(JSON.stringify({
							type: 'answer',
							targetPeerId: msg.fromPeerId,
							answer,
						}))
						setPeers(new Map(peersRef.current))
						break
					}

					case 'answer': {
						const peer = peersRef.current.get(msg.fromPeerId)
						if (peer) {
							await peer.connection.setRemoteDescription(msg.answer)
						}
						break
					}

					case 'ice-candidate': {
						const peer = peersRef.current.get(msg.fromPeerId)
						if (peer) {
							await peer.connection.addIceCandidate(msg.candidate)
						}
						break
					}

					case 'peer-left': {
						removePeer(msg.peerId)
						break
					}

					case 'media-state': {
						const peer = peersRef.current.get(msg.peerId)
						if (peer) {
							peer.audio = msg.audio
							peer.video = msg.video
							peer.screenShare = msg.screenShare
							peer.userName = msg.userName
							peersRef.current.set(msg.peerId, { ...peer })
							setPeers(new Map(peersRef.current))
						}
						break
					}
				}
			}

			ws.onclose = () => {
				// Clean up all peers on disconnect
			}
		} catch (err) {
			console.error('[webrtc] Failed to join call:', err)
		}
	}, [roomId, peerId, userName, createPeerConnection])

	const leaveCall = useCallback(() => {
		// Stop local stream
		localStreamRef.current?.getTracks().forEach(t => t.stop())
		localStreamRef.current = null
		setLocalStream(null)

		// Stop screen share
		screenStreamRef.current?.getTracks().forEach(t => t.stop())
		screenStreamRef.current = null

		// Close all peer connections
		for (const [, peer] of peersRef.current) {
			peer.connection.close()
		}
		peersRef.current.clear()
		setPeers(new Map())

		// Notify server
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'leave' }))
			wsRef.current.close()
		}

		setIsInCall(false)
		setIsMuted(false)
		setIsCameraOff(false)
		setIsScreenSharing(false)
	}, [])

	const broadcastMediaState = useCallback((audio: boolean, video: boolean, screenShare: boolean) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({
				type: 'media-state',
				audio,
				video,
				screenShare,
				userName,
			}))
		}
	}, [userName])

	const toggleMute = useCallback(() => {
		if (localStreamRef.current) {
			const audioTrack = localStreamRef.current.getAudioTracks()[0]
			if (audioTrack) {
				audioTrack.enabled = !audioTrack.enabled
				setIsMuted(!audioTrack.enabled)
				broadcastMediaState(audioTrack.enabled, !isCameraOff, isScreenSharing)
			}
		}
	}, [isCameraOff, isScreenSharing, broadcastMediaState])

	const toggleCamera = useCallback(() => {
		if (localStreamRef.current) {
			const videoTrack = localStreamRef.current.getVideoTracks()[0]
			if (videoTrack) {
				videoTrack.enabled = !videoTrack.enabled
				setIsCameraOff(!videoTrack.enabled)
				broadcastMediaState(!isMuted, videoTrack.enabled, isScreenSharing)
			}
		}
	}, [isMuted, isScreenSharing, broadcastMediaState])

	const toggleScreenShare = useCallback(async () => {
		if (isScreenSharing) {
			// Stop screen sharing
			screenStreamRef.current?.getTracks().forEach(t => t.stop())
			screenStreamRef.current = null
			setIsScreenSharing(false)

			// Replace screen track with camera track
			if (localStreamRef.current) {
				const videoTrack = localStreamRef.current.getVideoTracks()[0]
				for (const [, peer] of peersRef.current) {
					const sender = peer.connection.getSenders().find(s => s.track?.kind === 'video')
					if (sender && videoTrack) {
						sender.replaceTrack(videoTrack)
					}
				}
			}
			broadcastMediaState(!isMuted, !isCameraOff, false)
		} else {
			try {
				const screenStream = await navigator.mediaDevices.getDisplayMedia({
					video: true,
					audio: false,
				})
				screenStreamRef.current = screenStream
				const screenTrack = screenStream.getVideoTracks()[0]

				// Replace camera track with screen track
				for (const [, peer] of peersRef.current) {
					const sender = peer.connection.getSenders().find(s => s.track?.kind === 'video')
					if (sender) {
						sender.replaceTrack(screenTrack)
					}
				}

				screenTrack.onended = () => {
					setIsScreenSharing(false)
					if (localStreamRef.current) {
						const videoTrack = localStreamRef.current.getVideoTracks()[0]
						for (const [, peer] of peersRef.current) {
							const sender = peer.connection.getSenders().find(s => s.track?.kind === 'video')
							if (sender && videoTrack) {
								sender.replaceTrack(videoTrack)
							}
						}
					}
					broadcastMediaState(!isMuted, !isCameraOff, false)
				}

				setIsScreenSharing(true)
				broadcastMediaState(!isMuted, !isCameraOff, true)
			} catch (err) {
				console.error('[webrtc] Screen share failed:', err)
			}
		}
	}, [isScreenSharing, isMuted, isCameraOff, broadcastMediaState])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			localStreamRef.current?.getTracks().forEach(t => t.stop())
			screenStreamRef.current?.getTracks().forEach(t => t.stop())
			for (const [, peer] of peersRef.current) {
				peer.connection.close()
			}
			wsRef.current?.close()
		}
	}, [])

	return {
		localStream,
		peers,
		isInCall,
		isMuted,
		isCameraOff,
		isScreenSharing,
		joinCall,
		leaveCall,
		toggleMute,
		toggleCamera,
		toggleScreenShare,
	}
}
