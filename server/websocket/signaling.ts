import { WebSocket } from 'ws'

interface SignalingRoom {
	clients: Map<string, WebSocket>
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

export function setupSignaling(ws: WebSocket, roomId: string) {
	const room = getOrCreateSignalingRoom(roomId)
	let peerId = ''

	ws.on('message', (data) => {
		try {
			const msg = JSON.parse(data.toString())

			switch (msg.type) {
				case 'join': {
					peerId = msg.peerId || `peer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
					room.clients.set(peerId, ws)

					// Notify the new peer about existing peers
					const existingPeers = Array.from(room.clients.keys()).filter(id => id !== peerId)
					ws.send(JSON.stringify({
						type: 'peers',
						peers: existingPeers,
						peerId,
					}))

					// Notify existing peers about the new peer
					for (const [id, client] of room.clients) {
						if (id !== peerId && client.readyState === WebSocket.OPEN) {
							client.send(JSON.stringify({
								type: 'peer-joined',
								peerId,
								userName: msg.userName,
							}))
						}
					}
					break
				}

				case 'offer':
				case 'answer':
				case 'ice-candidate': {
					// Relay signaling messages to the target peer
					const targetWs = room.clients.get(msg.targetPeerId)
					if (targetWs && targetWs.readyState === WebSocket.OPEN) {
						targetWs.send(JSON.stringify({
							...msg,
							fromPeerId: peerId,
						}))
					}
					break
				}

				case 'media-state': {
					// Broadcast media state changes (mute/unmute, camera on/off)
					for (const [id, client] of room.clients) {
						if (id !== peerId && client.readyState === WebSocket.OPEN) {
							client.send(JSON.stringify({
								type: 'media-state',
								peerId,
								audio: msg.audio,
								video: msg.video,
								screenShare: msg.screenShare,
								userName: msg.userName,
							}))
						}
					}
					break
				}

				case 'leave': {
					room.clients.delete(peerId)
					for (const [, client] of room.clients) {
						if (client.readyState === WebSocket.OPEN) {
							client.send(JSON.stringify({
								type: 'peer-left',
								peerId,
							}))
						}
					}
					break
				}
			}
		} catch (err) {
			console.error('[signaling] Failed to parse message:', err)
		}
	})

	ws.on('close', () => {
		room.clients.delete(peerId)
		for (const [, client] of room.clients) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(JSON.stringify({
					type: 'peer-left',
					peerId,
				}))
			}
		}

		if (room.clients.size === 0) {
			signalingRooms.delete(roomId)
		}
	})

	ws.on('error', (err) => {
		console.error('[signaling] WebSocket error:', err)
		room.clients.delete(peerId)
	})
}
