import { WebSocket } from 'ws'

type ChannelKind = 'voice' | 'video'

interface SignalingClient {
	peerId: string
	userId: string
	userName: string
	userColor: string
	channelId: string | null
	channelKind: ChannelKind | null
	audio: boolean
	video: boolean
	screenShare: boolean
	ws: WebSocket
}

interface SignalingRoom {
	clients: Map<string, SignalingClient>
}

const signalingRooms = new Map<string, SignalingRoom>()

function getOrCreateSignalingRoom(roomId: string): SignalingRoom {
	let room = signalingRooms.get(roomId)
	if (!room) {
		room = { clients: new Map() }
		signalingRooms.set(roomId, room)
	}
	return room
}

function broadcastPresence(room: SignalingRoom) {
	const participants = Array.from(room.clients.values()).map((client) => ({
		peerId: client.peerId,
		userId: client.userId,
		userName: client.userName,
		userColor: client.userColor,
		channelId: client.channelId,
		channelKind: client.channelKind,
		audio: client.audio,
		video: client.video,
		screenShare: client.screenShare,
	}))

	const payload = JSON.stringify({
		type: 'presence',
		participants,
	})

	for (const client of room.clients.values()) {
		if (client.ws.readyState === WebSocket.OPEN) {
			client.ws.send(payload)
		}
	}
}

function createPeerId() {
	return `peer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function detachClient(room: SignalingRoom, peerId: string) {
	if (!peerId) return

	room.clients.delete(peerId)

	if (room.clients.size === 0) {
		for (const [roomId, existingRoom] of signalingRooms) {
			if (existingRoom === room) {
				signalingRooms.delete(roomId)
				break
			}
		}
		return
	}

	broadcastPresence(room)
}

export function setupSignaling(ws: WebSocket, roomId: string) {
	const room = getOrCreateSignalingRoom(roomId)
	let peerId = ''

	ws.on('message', (data) => {
		try {
			const msg = JSON.parse(data.toString())

			switch (msg.type) {
				case 'join': {
					peerId = msg.peerId || createPeerId()
					room.clients.set(peerId, {
						peerId,
						userId: msg.userId || peerId,
						userName: msg.userName || 'Anonymous',
						userColor: msg.userColor || '#64748b',
						channelId: null,
						channelKind: null,
						audio: false,
						video: false,
						screenShare: false,
						ws,
					})

					ws.send(
						JSON.stringify({
							type: 'joined',
							peerId,
						})
					)
					broadcastPresence(room)
					break
				}

				case 'set-channel': {
					const client = room.clients.get(peerId)
					if (!client) break

					client.channelId = msg.channelId || null
					client.channelKind = msg.channelKind || null
					client.audio = !!msg.audio
					client.video = !!msg.video
					client.screenShare = !!msg.screenShare
					room.clients.set(peerId, client)
					broadcastPresence(room)
					break
				}

				case 'leave-channel': {
					const client = room.clients.get(peerId)
					if (!client) break

					client.channelId = null
					client.channelKind = null
					client.audio = false
					client.video = false
					client.screenShare = false
					room.clients.set(peerId, client)
					broadcastPresence(room)
					break
				}

				case 'offer':
				case 'answer':
				case 'ice-candidate': {
					const targetWs = room.clients.get(msg.targetPeerId)?.ws
					if (targetWs && targetWs.readyState === WebSocket.OPEN) {
						targetWs.send(
							JSON.stringify({
								...msg,
								fromPeerId: peerId,
							})
						)
					}
					break
				}

				case 'media-state': {
					const client = room.clients.get(peerId)
					if (!client) break

					client.audio = !!msg.audio
					client.video = !!msg.video
					client.screenShare = !!msg.screenShare
					room.clients.set(peerId, client)
					broadcastPresence(room)
					break
				}

				case 'leave': {
					detachClient(room, peerId)
					break
				}
			}
		} catch (err) {
			console.error('[signaling] Failed to parse message:', err)
		}
	})

	ws.on('close', () => {
		detachClient(room, peerId)
	})

	ws.on('error', (err) => {
		console.error('[signaling] WebSocket error:', err)
		detachClient(room, peerId)
	})
}
