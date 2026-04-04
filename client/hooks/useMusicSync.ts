import { useState, useEffect, useRef, useCallback } from 'react'
import { resolveWsUrl } from '../utils/network'

export interface Track {
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
	position: number
	lastSync: number
	volume: number
	skipVotes: number
	totalUsers: number
}

interface UseMusicSyncReturn {
	state: MusicState
	addTrack: (title: string, youtubeId: string, duration?: number, thumbnail?: string) => void
	togglePlayPause: (position?: number) => void
	seek: (position: number) => void
	skip: () => void
	setVolume: (volume: number) => void
	removeTrack: (trackId: string) => void
	isConnected: boolean
}

export function useMusicSync(roomId: string, userId: string, userName: string): UseMusicSyncReturn {
	const [state, setState] = useState<MusicState>({
		currentTrack: null,
		queue: [],
		isPlaying: false,
		position: 0,
		lastSync: Date.now(),
		volume: 80,
		skipVotes: 0,
		totalUsers: 0,
	})
	const [isConnected, setIsConnected] = useState(false)
	const wsRef = useRef<WebSocket | null>(null)
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const reconnectAttemptRef = useRef(0)
	const shouldReconnectRef = useRef(true)

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
				const url = await resolveWsUrl(`/api/music/${roomId}`)
				if (!shouldReconnectRef.current) return

				const ws = new WebSocket(url)
				wsRef.current = ws

				ws.onopen = () => {
					reconnectAttemptRef.current = 0
					setIsConnected(true)
					ws.send(JSON.stringify({ type: 'join', userId, userName }))
				}

				ws.onmessage = (event) => {
					const msg = JSON.parse(event.data)

					switch (msg.type) {
						case 'state':
							setState({
								currentTrack: msg.currentTrack,
								queue: msg.queue,
								isPlaying: msg.isPlaying,
								position: msg.position,
								lastSync: msg.lastSync,
								volume: msg.volume,
								skipVotes: msg.skipVotes,
								totalUsers: msg.totalUsers,
							})
							break

						case 'play-pause':
							setState(prev => ({
								...prev,
								isPlaying: msg.isPlaying,
								position: msg.position,
								lastSync: msg.lastSync,
							}))
							break

						case 'seek':
							setState(prev => ({
								...prev,
								position: msg.position,
								lastSync: msg.lastSync,
							}))
							break

						case 'volume':
							setState(prev => ({ ...prev, volume: msg.volume }))
							break

						case 'queue-update':
							setState(prev => ({ ...prev, queue: msg.queue }))
							break

						case 'skip-vote':
							setState(prev => ({ ...prev, skipVotes: msg.skipVotes }))
							break
					}
				}

				ws.onclose = () => {
					setIsConnected(false)
					scheduleReconnect()
				}
				ws.onerror = () => setIsConnected(false)
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
		}
	}, [roomId, userId, userName])

	const addTrack = useCallback((title: string, youtubeId: string, duration?: number, thumbnail?: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({
				type: 'add-track',
				title,
				youtubeId,
				duration,
				thumbnail,
			}))
		}
	}, [])

	const togglePlayPause = useCallback((position?: number) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'play-pause', position }))
		}
	}, [])

	const seek = useCallback((position: number) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'seek', position }))
		}
	}, [])

	const skip = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'skip' }))
		}
	}, [])

	const setVolume = useCallback((volume: number) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'volume', volume }))
		}
	}, [])

	const removeTrack = useCallback((trackId: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'remove-track', trackId }))
		}
	}, [])

	return {
		state,
		addTrack,
		togglePlayPause,
		seek,
		skip,
		setVolume,
		removeTrack,
		isConnected,
	}
}
