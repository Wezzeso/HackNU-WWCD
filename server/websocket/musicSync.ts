import { WebSocket } from 'ws'

interface Track {
	id: string
	title: string
	youtubeId: string
	addedBy: string
	addedByName: string
	duration?: number
	thumbnail?: string
}

interface MusicState {
	currentTrack: Track | null
	queue: Track[]
	isPlaying: boolean
	position: number // seconds into the current track
	lastSync: number // timestamp of last sync
	volume: number
	skipVotes: Set<string>
}

interface MusicRoom {
	clients: Map<string, { ws: WebSocket; userName: string }>
	state: MusicState
}

const musicRooms = new Map<string, MusicRoom>()

function getOrCreateMusicRoom(roomId: string): MusicRoom {
	let room = musicRooms.get(roomId)
	if (!room) {
		room = {
			clients: new Map(),
			state: {
				currentTrack: null,
				queue: [],
				isPlaying: false,
				position: 0,
				lastSync: Date.now(),
				volume: 80,
				skipVotes: new Set(),
			},
		}
		musicRooms.set(roomId, room)
	}
	return room
}

function broadcast(room: MusicRoom, message: any, excludeId?: string) {
	const data = JSON.stringify(message)
	for (const [id, client] of room.clients) {
		if (id !== excludeId && client.ws.readyState === WebSocket.OPEN) {
			client.ws.send(data)
		}
	}
}

function sendState(room: MusicRoom, ws: WebSocket) {
	ws.send(JSON.stringify({
		type: 'state',
		currentTrack: room.state.currentTrack,
		queue: room.state.queue,
		isPlaying: room.state.isPlaying,
		position: room.state.position,
		lastSync: room.state.lastSync,
		volume: room.state.volume,
		skipVotes: room.state.skipVotes.size,
		totalUsers: room.clients.size,
	}))
}

function playNext(room: MusicRoom) {
	room.state.skipVotes.clear()
	if (room.state.queue.length > 0) {
		room.state.currentTrack = room.state.queue.shift()!
		room.state.isPlaying = true
		room.state.position = 0
		room.state.lastSync = Date.now()
	} else {
		room.state.currentTrack = null
		room.state.isPlaying = false
		room.state.position = 0
	}
	broadcast(room, {
		type: 'state',
		currentTrack: room.state.currentTrack,
		queue: room.state.queue,
		isPlaying: room.state.isPlaying,
		position: room.state.position,
		lastSync: room.state.lastSync,
		volume: room.state.volume,
		skipVotes: room.state.skipVotes.size,
		totalUsers: room.clients.size,
	})
}

export function setupMusicSync(ws: WebSocket, roomId: string) {
	const room = getOrCreateMusicRoom(roomId)
	let userId = ''

	ws.on('message', (data) => {
		try {
			const msg = JSON.parse(data.toString())

			switch (msg.type) {
				case 'join': {
					userId = msg.userId || `user-${Date.now()}`
					room.clients.set(userId, { ws, userName: msg.userName || 'Anonymous' })
					sendState(room, ws)
					break
				}

				case 'add-track': {
					const track: Track = {
						id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
						title: msg.title,
						youtubeId: msg.youtubeId,
						addedBy: userId,
						addedByName: room.clients.get(userId)?.userName || 'Anonymous',
						duration: msg.duration,
						thumbnail: msg.thumbnail,
					}

					if (!room.state.currentTrack) {
						room.state.currentTrack = track
						room.state.isPlaying = true
						room.state.position = 0
						room.state.lastSync = Date.now()
					} else {
						room.state.queue.push(track)
					}

					broadcast(room, {
						type: 'state',
						currentTrack: room.state.currentTrack,
						queue: room.state.queue,
						isPlaying: room.state.isPlaying,
						position: room.state.position,
						lastSync: room.state.lastSync,
						volume: room.state.volume,
						skipVotes: room.state.skipVotes.size,
						totalUsers: room.clients.size,
					})
					break
				}

				case 'play-pause': {
					room.state.isPlaying = !room.state.isPlaying
					room.state.lastSync = Date.now()
					if (msg.position !== undefined) {
						room.state.position = msg.position
					}
					broadcast(room, {
						type: 'play-pause',
						isPlaying: room.state.isPlaying,
						position: room.state.position,
						lastSync: room.state.lastSync,
					})
					break
				}

				case 'seek': {
					room.state.position = msg.position
					room.state.lastSync = Date.now()
					broadcast(room, {
						type: 'seek',
						position: room.state.position,
						lastSync: room.state.lastSync,
					})
					break
				}

				case 'skip': {
					room.state.skipVotes.add(userId)
					const needed = Math.ceil(room.clients.size / 2)
					if (room.state.skipVotes.size >= needed) {
						playNext(room)
					} else {
						broadcast(room, {
							type: 'skip-vote',
							skipVotes: room.state.skipVotes.size,
							needed,
						})
					}
					break
				}

				case 'track-ended': {
					playNext(room)
					break
				}

				case 'volume': {
					room.state.volume = msg.volume
					broadcast(room, { type: 'volume', volume: msg.volume }, userId)
					break
				}

				case 'remove-track': {
					room.state.queue = room.state.queue.filter(t => t.id !== msg.trackId)
					broadcast(room, {
						type: 'queue-update',
						queue: room.state.queue,
					})
					break
				}
			}
		} catch (err) {
			console.error('[music] Failed to parse message:', err)
		}
	})

	ws.on('close', () => {
		room.clients.delete(userId)
		room.state.skipVotes.delete(userId)

		if (room.clients.size === 0) {
			setTimeout(() => {
				const r = musicRooms.get(roomId)
				if (r && r.clients.size === 0) {
					musicRooms.delete(roomId)
				}
			}, 300000)
		}
	})

	ws.on('error', (err) => {
		console.error('[music] WebSocket error:', err)
		room.clients.delete(userId)
	})
}
