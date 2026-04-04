import { WebSocket } from 'ws'
import { TLSocketRoom } from '@tldraw/sync-core'
import { reactionStampTLSchema } from '../../shared/tldraw/reactionStampSchema.js'

// ─── TLSocketRoom based sync ───
const rooms = new Map<string, TLSocketRoom<any, any>>()

function getOrCreateRoom(roomId: string): TLSocketRoom<any, any> {
	let room = rooms.get(roomId)
	if (!room) {
		room = new TLSocketRoom({
			clientTimeout: 60000,
			schema: reactionStampTLSchema,
			onSessionRemoved: (r, args) => {
				console.log(`[tldraw] Client ${args.sessionId} left room ${roomId} (${args.numSessionsRemaining} clients remaining)`)
				if (args.numSessionsRemaining === 0) {
					// Clean up empty rooms after a delay
					setTimeout(() => {
						const currentRoom = rooms.get(roomId)
						if (currentRoom && currentRoom.getNumActiveSessions() === 0) {
							currentRoom.close()
							rooms.delete(roomId)
							console.log(`[tldraw] Room ${roomId} cleaned up`)
						}
					}, 60000)
				}
			}
		})
		rooms.set(roomId, room)
	}
	return room
}

export function setupTldrawSync(ws: WebSocket, roomId: string, params: URLSearchParams) {
	const sessionId = params.get('sessionId') || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
	const room = getOrCreateRoom(roomId)

	console.log(`[tldraw] Client ${sessionId} joining room ${roomId}...`)

	// The `ws` package WebSocket doesn't always perfectly match the DOM WebSocket type expected
	// by TLSocketRoom (specifically regarding addEventListener). 
	// TLSocketRoom uses `handleSocketMessage`, `handleSocketClose`, `handleSocketError` directly 
	// if we don't pass them in through socket, but the easiest way is to let handleSocketConnect try,
	// and if `addEventListener` is missing, we wire it up manually.
	room.handleSocketConnect({
		sessionId,
		socket: ws as any,
	})

	// ws package uses .on() mostly, so let's guarantee events are mapped:
	if (!(ws as any).addEventListener) {
		ws.on('message', (data) => room.handleSocketMessage(sessionId, data as any))
		ws.on('close', () => room.handleSocketClose(sessionId))
		ws.on('error', () => room.handleSocketError(sessionId))
	}
}

// Export for use by other modules
export function getRoomClients(roomId: string): string[] {
	const room = rooms.get(roomId)
	if (!room) return []
	return room.getSessions().map(s => s.sessionId)
}

export function getActiveRooms(): string[] {
	return Array.from(rooms.keys())
}
