import { WebSocket } from 'ws'

interface ChatMessage {
	id: string
	roomId: string
	userId: string
	userName: string
	userColor: string
	text: string
	timestamp: number
	replyTo?: string
	reactions: Record<string, string[]> // emoji -> userId[]
	edited?: boolean
}

interface ChatRoom {
	clients: Map<string, { ws: WebSocket; userName: string; userColor: string }>
	messages: ChatMessage[]
	typing: Map<string, number> // userId -> timestamp
}

const chatRooms = new Map<string, ChatRoom>()

function getOrCreateChatRoom(roomId: string): ChatRoom {
	let room = chatRooms.get(roomId)
	if (!room) {
		room = {
			clients: new Map(),
			messages: [],
			typing: new Map(),
		}
		chatRooms.set(roomId, room)
	}
	return room
}

function generateId(): string {
	return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function broadcast(room: ChatRoom, message: any, excludeId?: string) {
	const data = JSON.stringify(message)
	for (const [id, client] of room.clients) {
		if (id !== excludeId && client.ws.readyState === WebSocket.OPEN) {
			client.ws.send(data)
		}
	}
}

export function setupChatSync(ws: WebSocket, roomId: string) {
	const room = getOrCreateChatRoom(roomId)
	let userId = ''

	ws.on('message', (data) => {
		try {
			const msg = JSON.parse(data.toString())

			switch (msg.type) {
				case 'join': {
					userId = msg.userId || `user-${Date.now()}`
					const userName = msg.userName || 'Anonymous'
					const userColor = msg.userColor || `hsl(${Math.random() * 360}, 70%, 50%)`
					room.clients.set(userId, { ws, userName, userColor })

					// Send message history
					ws.send(JSON.stringify({
						type: 'history',
						messages: room.messages.slice(-100), // last 100 messages
						onlineUsers: Array.from(room.clients.entries()).map(([id, c]) => ({
							id,
							name: c.userName,
							color: c.userColor,
						})),
					}))

					// Notify others
					broadcast(room, {
						type: 'user-joined',
						userId,
						userName,
						userColor,
					}, userId)
					break
				}

				case 'message': {
					const chatMsg: ChatMessage = {
						id: generateId(),
						roomId,
						userId,
						userName: room.clients.get(userId)?.userName || 'Anonymous',
						userColor: room.clients.get(userId)?.userColor || '#888',
						text: msg.text,
						timestamp: Date.now(),
						replyTo: msg.replyTo,
						reactions: {},
					}
					room.messages.push(chatMsg)

					// Keep only last 500 messages in memory
					if (room.messages.length > 500) {
						room.messages = room.messages.slice(-500)
					}

					// Broadcast to all including sender (with server-generated id)
					broadcast(room, { type: 'message', message: chatMsg })
					break
				}

				case 'typing': {
					room.typing.set(userId, Date.now())
					broadcast(room, {
						type: 'typing',
						userId,
						userName: room.clients.get(userId)?.userName,
					}, userId)
					break
				}

				case 'reaction': {
					const target = room.messages.find(m => m.id === msg.messageId)
					if (target) {
						if (!target.reactions[msg.emoji]) {
							target.reactions[msg.emoji] = []
						}
						const idx = target.reactions[msg.emoji].indexOf(userId)
						if (idx >= 0) {
							target.reactions[msg.emoji].splice(idx, 1)
						} else {
							target.reactions[msg.emoji].push(userId)
						}
						broadcast(room, {
							type: 'reaction',
							messageId: msg.messageId,
							emoji: msg.emoji,
							reactions: target.reactions,
						})
					}
					break
				}

				case 'edit': {
					const editTarget = room.messages.find(m => m.id === msg.messageId && m.userId === userId)
					if (editTarget) {
						editTarget.text = msg.text
						editTarget.edited = true
						broadcast(room, {
							type: 'edit',
							messageId: msg.messageId,
							text: msg.text,
						})
					}
					break
				}

				case 'delete': {
					const deleteIdx = room.messages.findIndex(m => m.id === msg.messageId && m.userId === userId)
					if (deleteIdx >= 0) {
						room.messages.splice(deleteIdx, 1)
						broadcast(room, {
							type: 'delete',
							messageId: msg.messageId,
						})
					}
					break
				}
			}
		} catch (err) {
			console.error('[chat] Failed to parse message:', err)
		}
	})

	ws.on('close', () => {
		room.clients.delete(userId)
		room.typing.delete(userId)
		broadcast(room, {
			type: 'user-left',
			userId,
		})

		if (room.clients.size === 0) {
			setTimeout(() => {
				const r = chatRooms.get(roomId)
				if (r && r.clients.size === 0) {
					chatRooms.delete(roomId)
				}
			}, 300000) // 5 min
		}
	})

	ws.on('error', (err) => {
		console.error('[chat] WebSocket error:', err)
		room.clients.delete(userId)
	})
}
