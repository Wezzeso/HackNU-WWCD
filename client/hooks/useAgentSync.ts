import { useState, useEffect, useRef, useCallback } from 'react'
import { resolveWsUrl } from '../utils/network'
import { getModelConfig } from '../components/ModelSettings'

export interface AgentSuggestion {
	id: string
	type: 'calendar' | 'expand' | 'image' | 'video' | 'summary' | 'action' | 'text' | 'music'
	title: string
	description: string
	data?: Record<string, unknown>
	timestamp: number
	status: 'pending' | 'approved' | 'dismissed'
}

export interface AgentMessage {
	id: string
	text: string
	timestamp: number
}

export type AgentStatus = 'idle' | 'listening' | 'thinking' | 'generating'

interface UseAgentSyncReturn {
	suggestions: AgentSuggestion[]
	messages: AgentMessage[]
	agentStatus: AgentStatus
	isConnected: boolean
	approveSuggestion: (suggestionId: string) => void
	dismissSuggestion: (suggestionId: string) => void
	analyzeText: (text: string, context?: string) => Promise<void>
	expandDocument: (text: string) => Promise<string>
}

export function useAgentSync(
	roomId: string,
	userId: string,
	userName: string,
): UseAgentSyncReturn {
	const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([])
	const [messages, setMessages] = useState<AgentMessage[]>([])
	const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle')
	const [isConnected, setIsConnected] = useState(false)
	const [isEnabled, setIsEnabled] = useState(() => getModelConfig().enabled)
	const wsRef = useRef<WebSocket | null>(null)
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const reconnectAttemptRef = useRef(0)
	const shouldReconnectRef = useRef(true)

	useEffect(() => {
		const handleConfigChanged = () => {
			setIsEnabled(getModelConfig().enabled)
		}
		window.addEventListener('hacknu:model-config-changed', handleConfigChanged)
		return () => window.removeEventListener('hacknu:model-config-changed', handleConfigChanged)
	}, [])

	useEffect(() => {
		if (!roomId || !userId || !isEnabled) {
			if (wsRef.current) {
				wsRef.current.close()
				wsRef.current = null
				setIsConnected(false)
			}
			return
		}

		let disposed = false
		let activeSocket: WebSocket | null = null
		shouldReconnectRef.current = true

		const scheduleReconnect = () => {
			if (disposed || !shouldReconnectRef.current || reconnectTimerRef.current) return

			const timeout = Math.min(1000 * 2 ** reconnectAttemptRef.current, 5000)
			reconnectTimerRef.current = setTimeout(() => {
				if (disposed) {
					reconnectTimerRef.current = null
					return
				}
				reconnectTimerRef.current = null
				reconnectAttemptRef.current += 1
				connect()
			}, timeout)
		}

		const connect = () => {
			void (async () => {
				const url = await resolveWsUrl(`/api/agent-ws/${roomId}`)
				if (disposed || !shouldReconnectRef.current) return

				const ws = new WebSocket(url)
				activeSocket = ws
				wsRef.current = ws

				ws.onopen = () => {
					if (disposed || wsRef.current !== ws) {
						ws.close()
						return
					}
					reconnectAttemptRef.current = 0
					setIsConnected(true)
					ws.send(JSON.stringify({ type: 'join', userId, userName }))
				}

				ws.onmessage = (event) => {
					const msg = JSON.parse(event.data)

					switch (msg.type) {
						case 'agent:init':
							setSuggestions(msg.suggestions || [])
							setAgentStatus(msg.agentStatus || 'idle')
							break

						case 'agent:suggestion':
							setSuggestions(prev => [...prev, msg.suggestion])
							break

						case 'agent:suggestion-updated':
							setSuggestions(prev =>
								prev.map(s =>
									s.id === msg.suggestionId
										? { ...s, status: msg.status }
										: s
								)
							)
							break

						case 'agent:status':
							setAgentStatus(msg.status)
							break

						case 'agent:message':
							setMessages(prev => [...prev, msg.message])
							break
					}
				}

				ws.onclose = () => {
					if (wsRef.current === ws) {
						wsRef.current = null
					}
					setIsConnected(false)
					scheduleReconnect()
				}

				ws.onerror = () => {
					if (wsRef.current === ws) {
						wsRef.current = null
					}
					setIsConnected(false)
				}
			})()
		}

		connect()

		return () => {
			disposed = true
			shouldReconnectRef.current = false
			if (reconnectTimerRef.current) {
				clearTimeout(reconnectTimerRef.current)
				reconnectTimerRef.current = null
			}
			if (activeSocket && activeSocket.readyState < WebSocket.CLOSING) {
				activeSocket.close()
			}
			if (wsRef.current === activeSocket) {
				wsRef.current = null
			}
		}
	}, [roomId, userId, userName, isEnabled])

	const approveSuggestion = useCallback((suggestionId: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'agent:approve', suggestionId }))
		}
		setSuggestions(prev =>
			prev.map(s => s.id === suggestionId ? { ...s, status: 'approved' } : s)
		)
	}, [])

	const dismissSuggestion = useCallback((suggestionId: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'agent:dismiss', suggestionId }))
		}
		setSuggestions(prev =>
			prev.map(s => s.id === suggestionId ? { ...s, status: 'dismissed' } : s)
		)
	}, [])

	const analyzeText = useCallback(async (text: string, context?: string) => {
		if (!getModelConfig().enabled) return
		console.log('[agent-sync] analyzeText called, roomId:', roomId, 'text:', text.slice(0, 80))
		try {
			const res = await fetch('/api/agent/analyze', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ roomId, text, context }),
			})
			console.log('[agent-sync] analyzeText response status:', res.status)
			const data = await res.json()
			console.log('[agent-sync] analyzeText response data:', data)
		} catch (err) {
			console.error('[agent-sync] ❌ Failed to analyze text:', err)
		}
	}, [roomId])

	const expandDocument = useCallback(async (text: string): Promise<string> => {
		if (!getModelConfig().enabled) return ''
		try {
			const res = await fetch('/api/agent/expand', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, roomId }),
			})

			if (!res.ok) {
				throw new Error('Failed to expand document')
			}

			const data = await res.json()
			return data.text || ''
		} catch (err) {
			console.error('[agent] Failed to expand document:', err)
			return ''
		}
	}, [roomId])

	return {
		suggestions,
		messages,
		agentStatus,
		isConnected,
		approveSuggestion,
		dismissSuggestion,
		analyzeText,
		expandDocument,
	}
}
