import { WebSocket } from 'ws'
import fs from 'fs'

// ─── In-memory room store for tldraw sync ───
// Each room holds a set of connected clients and document state
interface TldrawRoom {
	clients: Map<string, WebSocket>
	// We store the document records as a simple key-value map
	records: Map<string, any>
}

const rooms = new Map<string, TldrawRoom>()

function getOrCreateRoom(roomId: string): TldrawRoom {
	let room = rooms.get(roomId)
	if (!room) {
		room = {
			clients: new Map(),
			records: new Map(),
		}
		rooms.set(roomId, room)
	}
	return room
}

export function setupTldrawSync(ws: WebSocket, roomId: string, params: URLSearchParams) {
	const sessionId = params.get('sessionId') || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
	const room = getOrCreateRoom(roomId)

	room.clients.set(sessionId, ws)
	console.log(`[tldraw] Client ${sessionId} joined room ${roomId} (${room.clients.size} clients)`)

	// Send current state to the new client
	if (room.records.size > 0) {
		const snapshot = Array.from(room.records.values())
		ws.send(JSON.stringify({
			type: 'init',
			records: snapshot,
		}))
	}

	ws.on('message', (data) => {
		try {
			const rawData = data.toString()
			fs.writeFileSync('tldraw-msg.json', rawData + '\n', { flag: 'a' })
			const message = JSON.parse(rawData)

			// Handle different message types
			if (message.type === 'update' && message.updates) {
				// Apply updates to room state
				for (const update of message.updates) {
					if (update.type === 'put') {
						room.records.set(update.record.id, update.record)
					} else if (update.type === 'remove') {
						room.records.delete(update.id)
					}
				}
			}

			// Broadcast to all other clients in the room
			for (const [sid, client] of room.clients) {
				if (sid !== sessionId && client.readyState === WebSocket.OPEN) {
					client.send(data.toString())
				}
			}
		} catch (err) {
			console.error('[tldraw] Failed to parse message:', err)
		}
	})

	ws.on('close', () => {
		room.clients.delete(sessionId)
		console.log(`[tldraw] Client ${sessionId} left room ${roomId} (${room.clients.size} clients)`)

		// Clean up empty rooms after a delay
		if (room.clients.size === 0) {
			setTimeout(() => {
				const r = rooms.get(roomId)
				if (r && r.clients.size === 0) {
					rooms.delete(roomId)
					console.log(`[tldraw] Room ${roomId} cleaned up`)
				}
			}, 60000) // Keep room data for 1 minute after last client leaves
		}

		// Notify remaining clients about the disconnect
		for (const [, client] of room.clients) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(JSON.stringify({
					type: 'presence',
					action: 'leave',
					sessionId,
				}))
			}
		}
	})

	ws.on('error', (err) => {
		console.error(`[tldraw] WebSocket error for ${sessionId}:`, err)
		room.clients.delete(sessionId)
	})
}

// Export for use by other modules
export function getRoomClients(roomId: string): string[] {
	const room = rooms.get(roomId)
	return room ? Array.from(room.clients.keys()) : []
}

export function getActiveRooms(): string[] {
	return Array.from(rooms.keys())
}
