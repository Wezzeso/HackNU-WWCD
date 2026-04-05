import { WebSocket } from 'ws'

export interface AgentSuggestion {
	id: string
	type: 'calendar' | 'expand' | 'image' | 'video' | 'summary' | 'action' | 'text' | 'music'
	title: string
	description: string
	data?: Record<string, unknown>
	timestamp: number
	status: 'pending' | 'approved' | 'dismissed'
}

interface AgentRoom {
	clients: Map<string, { ws: WebSocket; userId: string; userName: string }>
	suggestions: AgentSuggestion[]
	agentStatus: 'idle' | 'listening' | 'thinking' | 'generating'
	history: { role: 'user' | 'model'; parts: { text: string }[] }[]
}

const agentRooms = new Map<string, AgentRoom>()

function getOrCreateAgentRoom(roomId: string): AgentRoom {
	let room = agentRooms.get(roomId)
	if (!room) {
		room = {
			clients: new Map(),
			suggestions: [],
			agentStatus: 'idle',
			history: [],
		}
		agentRooms.set(roomId, room)
	}
	return room
}

function generateSuggestionId(): string {
	return `sug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function broadcast(room: AgentRoom, message: unknown, excludeId?: string) {
	const data = JSON.stringify(message)
	for (const [id, client] of room.clients) {
		if (id !== excludeId && client.ws.readyState === WebSocket.OPEN) {
			client.ws.send(data)
		}
	}
}

export function broadcastAgentSuggestion(roomId: string, suggestion: Omit<AgentSuggestion, 'id' | 'timestamp' | 'status'>) {
	const room = agentRooms.get(roomId)
	if (!room) return null

	const fullSuggestion: AgentSuggestion = {
		...suggestion,
		id: generateSuggestionId(),
		timestamp: Date.now(),
		status: 'pending',
	}

	room.suggestions.push(fullSuggestion)
	if (room.suggestions.length > 50) {
		room.suggestions = room.suggestions.slice(-50)
	}

	broadcast(room, { type: 'agent:suggestion', suggestion: fullSuggestion })
	return fullSuggestion
}

export function broadcastAgentStatus(roomId: string, status: AgentRoom['agentStatus']) {
	const room = agentRooms.get(roomId)
	if (!room) return

	room.agentStatus = status
	broadcast(room, { type: 'agent:status', status })
}

export function broadcastAgentMessage(roomId: string, text: string) {
	const room = agentRooms.get(roomId)
	if (!room) return

	broadcast(room, {
		type: 'agent:message',
		message: {
			id: `agent-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			text,
			timestamp: Date.now(),
		},
	})
}

export function getAgentRoomHistory(roomId: string) {
	const room = agentRooms.get(roomId)
	return room ? room.history : []
}

export function addAgentRoomHistory(roomId: string, role: 'user' | 'model', text: string) {
	const room = getOrCreateAgentRoom(roomId)
	room.history.push({ role, parts: [{ text }] })
	if (room.history.length > 50) {
		room.history = room.history.slice(-50)
	}
}

export function setupAgentSync(ws: WebSocket, roomId: string) {
	const room = getOrCreateAgentRoom(roomId)
	let clientId = ''

	ws.on('message', (data) => {
		try {
			const msg = JSON.parse(data.toString())

			switch (msg.type) {
				case 'join': {
					clientId = msg.userId || `agent-client-${Date.now()}`
					room.clients.set(clientId, {
						ws,
						userId: msg.userId,
						userName: msg.userName,
					})

					ws.send(JSON.stringify({
						type: 'agent:init',
						suggestions: room.suggestions.filter(s => s.status === 'pending'),
						agentStatus: room.agentStatus,
					}))
					break
				}

				case 'agent:approve': {
					const suggestion = room.suggestions.find(s => s.id === msg.suggestionId)
					if (suggestion) {
						suggestion.status = 'approved'
						broadcast(room, {
							type: 'agent:suggestion-updated',
							suggestionId: suggestion.id,
							status: 'approved',
						})
					}
					break
				}

				case 'agent:dismiss': {
					const suggestion = room.suggestions.find(s => s.id === msg.suggestionId)
					if (suggestion) {
						suggestion.status = 'dismissed'
						broadcast(room, {
							type: 'agent:suggestion-updated',
							suggestionId: suggestion.id,
							status: 'dismissed',
						})
					}
					break
				}
			}
		} catch (err) {
			console.error('[agent] Failed to parse message:', err)
		}
	})

	ws.on('close', () => {
		room.clients.delete(clientId)

		if (room.clients.size === 0) {
			setTimeout(() => {
				const r = agentRooms.get(roomId)
				if (r && r.clients.size === 0) {
					agentRooms.delete(roomId)
				}
			}, 300000)
		}
	})

	ws.on('error', (err) => {
		console.error('[agent] WebSocket error:', err)
		room.clients.delete(clientId)
	})
}
