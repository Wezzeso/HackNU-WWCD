import { useState, useEffect, useRef, useCallback } from 'react'
import { getWsUrl } from '../utils/network'

export interface ChatMessage {
	id: string
	roomId: string
	userId: string
	userName: string
	userColor: string
	text: string
	timestamp: number
	replyTo?: string
	reactions: Record<string, string[]>
	edited?: boolean
}

export interface OnlineUser {
	id: string
	name: string
	color: string
}

interface UseChatReturn {
	messages: ChatMessage[]
	onlineUsers: OnlineUser[]
	typingUsers: string[]
	sendMessage: (text: string, replyTo?: string) => void
	editMessage: (messageId: string, text: string) => void
	deleteMessage: (messageId: string) => void
	addReaction: (messageId: string, emoji: string) => void
	sendTyping: () => void
	isConnected: boolean
	unreadCount: number
	resetUnread: () => void
}

export function useChat(roomId: string, userId: string, userName: string, userColor: string, isPanelOpen: boolean): UseChatReturn {
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
	const [typingUsers, setTypingUsers] = useState<string[]>([])
	const [isConnected, setIsConnected] = useState(false)
	const [unreadCount, setUnreadCount] = useState(0)
	const wsRef = useRef<WebSocket | null>(null)
	const typingTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
	const isPanelOpenRef = useRef(isPanelOpen)

	isPanelOpenRef.current = isPanelOpen

	useEffect(() => {
		if (!roomId || !userId) return

		const ws = new WebSocket(getWsUrl(`/api/chat/${roomId}`))
		wsRef.current = ws

		ws.onopen = () => {
			setIsConnected(true)
			ws.send(JSON.stringify({ type: 'join', userId, userName, userColor }))
		}

		ws.onmessage = (event) => {
			const msg = JSON.parse(event.data)

			switch (msg.type) {
				case 'history':
					setMessages(msg.messages)
					setOnlineUsers(msg.onlineUsers)
					break

				case 'message':
					setMessages(prev => [...prev, msg.message])
					if (!isPanelOpenRef.current) {
						setUnreadCount(prev => prev + 1)
					}
					break

				case 'user-joined':
					setOnlineUsers(prev => [...prev.filter(u => u.id !== msg.userId), {
						id: msg.userId,
						name: msg.userName,
						color: msg.userColor,
					}])
					break

				case 'user-left':
					setOnlineUsers(prev => prev.filter(u => u.id !== msg.userId))
					break

				case 'typing': {
					setTypingUsers(prev => {
						if (!prev.includes(msg.userName)) return [...prev, msg.userName]
						return prev
					})
					// Clear typing after 3 seconds
					const existing = typingTimeoutsRef.current.get(msg.userId)
					if (existing) clearTimeout(existing)
					typingTimeoutsRef.current.set(msg.userId, setTimeout(() => {
						setTypingUsers(prev => prev.filter(u => u !== msg.userName))
					}, 3000))
					break
				}

				case 'reaction':
					setMessages(prev => prev.map(m =>
						m.id === msg.messageId ? { ...m, reactions: msg.reactions } : m
					))
					break

				case 'edit':
					setMessages(prev => prev.map(m =>
						m.id === msg.messageId ? { ...m, text: msg.text, edited: true } : m
					))
					break

				case 'delete':
					setMessages(prev => prev.filter(m => m.id !== msg.messageId))
					break
			}
		}

		ws.onclose = () => {
			setIsConnected(false)
		}

		ws.onerror = () => {
			setIsConnected(false)
		}

		return () => {
			ws.close()
			typingTimeoutsRef.current.forEach(t => clearTimeout(t))
		}
	}, [roomId, userId, userName, userColor])

	const sendMessage = useCallback((text: string, replyTo?: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'message', text, replyTo }))
		}
	}, [])

	const editMessage = useCallback((messageId: string, text: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'edit', messageId, text }))
		}
	}, [])

	const deleteMessage = useCallback((messageId: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'delete', messageId }))
		}
	}, [])

	const addReaction = useCallback((messageId: string, emoji: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'reaction', messageId, emoji }))
		}
	}, [])

	const sendTyping = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'typing' }))
		}
	}, [])

	const resetUnread = useCallback(() => {
		setUnreadCount(0)
	}, [])

	return {
		messages,
		onlineUsers,
		typingUsers,
		sendMessage,
		editMessage,
		deleteMessage,
		addReaction,
		sendTyping,
		isConnected,
		unreadCount,
		resetUnread,
	}
}
