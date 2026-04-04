import { useState, useRef, useEffect } from 'react'
import { useChat, type ChatMessage } from '../hooks/useChat'
import type { AgentSuggestion, AgentMessage, AgentStatus } from '../hooks/useAgentSync'
import { useImageGeneration } from '../hooks/useImageGeneration'
import './ChatPanel.css'

interface ChatPanelProps {
	roomId: string
	userId: string
	userName: string
	userColor: string
	isOpen: boolean
	onClose: () => void
	agentSuggestions?: AgentSuggestion[]
	agentMessages?: AgentMessage[]
	agentStatus?: AgentStatus
	onApproveSuggestion?: (id: string) => void
	onDismissSuggestion?: (id: string) => void
	onAddCalendarEvent?: (data: Record<string, unknown>) => void
	onPlaceImageOnCanvas?: (imageUrl: string) => void
}

const EMOJI_REACTIONS = ['👍', '❤️', '😂', '🎉', '🤔', '👀']

type TimelineItem =
	| { kind: 'chat'; data: ChatMessage; ts: number }
	| { kind: 'suggestion'; data: AgentSuggestion; ts: number }
	| { kind: 'agent-message'; data: AgentMessage; ts: number }

export function ChatPanel({
	roomId, userId, userName, userColor,
	isOpen, onClose,
	agentSuggestions = [],
	agentMessages = [],
	agentStatus,
	onApproveSuggestion,
	onDismissSuggestion,
	onAddCalendarEvent,
	onPlaceImageOnCanvas,
}: ChatPanelProps) {
	const {
		messages, typingUsers,
		sendMessage, addReaction, sendTyping,
		isConnected, unreadCount, resetUnread,
	} = useChat(roomId, userId, userName, userColor, isOpen)

	const { isGenerating, imageUrl, generateImage, reset: resetImage } = useImageGeneration()

	const [input, setInput] = useState('')
	const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
	const [showEmojiFor, setShowEmojiFor] = useState<string | null>(null)
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (isOpen) {
			resetUnread()
			inputRef.current?.focus()
		}
	}, [isOpen, resetUnread])

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages, agentSuggestions, agentMessages])

	const handleSend = () => {
		if (!input.trim()) return
		sendMessage(input.trim(), replyTo?.id)
		setInput('')
		setReplyTo(null)
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			handleSend()
		}
	}

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setInput(e.target.value)
		sendTyping()
	}

	const formatTime = (ts: number) => {
		const d = new Date(ts)
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	}

	const findReplyMessage = (id: string) => messages.find(m => m.id === id)

	const handleApprove = async (suggestion: AgentSuggestion) => {
		onApproveSuggestion?.(suggestion.id)

		if (suggestion.type === 'calendar' && suggestion.data) {
			onAddCalendarEvent?.(suggestion.data)
		}

		if (suggestion.type === 'image' && suggestion.data?.prompt) {
			const url = await generateImage(suggestion.data.prompt as string)
			if (url) {
				// Image generated successfully
			}
		}
	}

	// Merge all items into a timeline
	const pendingSuggestions = agentSuggestions.filter(s => s.status === 'pending')

	const timeline: TimelineItem[] = [
		...messages.map(m => ({ kind: 'chat' as const, data: m, ts: m.timestamp })),
		...agentMessages.map(m => ({ kind: 'agent-message' as const, data: m, ts: m.timestamp })),
	].sort((a, b) => a.ts - b.ts)

	return (
		<div className={`chat-panel ${isOpen ? 'chat-panel--open' : ''}`}>
			<div className="chat-panel__messages">
				{timeline.length === 0 && pendingSuggestions.length === 0 && (
					<div className="chat-panel__empty">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</svg>
						<p>No messages yet</p>
						<p className="chat-panel__empty-sub">Start the conversation!</p>
					</div>
				)}

				{timeline.map((item) => {
					if (item.kind === 'agent-message') {
						const msg = item.data
						return (
							<div key={msg.id} className="chat-message chat-message--agent">
								<div className="chat-message__avatar chat-message__avatar--agent">
									✨
								</div>
								<div className="chat-message__content">
									<div className="chat-message__name" style={{ color: '#8b5cf6' }}>
										AI Assistant
									</div>
									<div className="chat-message__bubble chat-message__bubble--agent">
										<span>{msg.text}</span>
										<span className="chat-message__time">{formatTime(msg.timestamp)}</span>
									</div>
								</div>
							</div>
						)
					}

					const msg = item.data as ChatMessage
					const isOwn = msg.userId === userId
					const replyMsg = msg.replyTo ? findReplyMessage(msg.replyTo) : null

					return (
						<div key={msg.id} className={`chat-message ${isOwn ? 'chat-message--own' : ''}`}>
							{!isOwn && (
								<div className="chat-message__avatar" style={{ background: msg.userColor }}>
									{msg.userName.charAt(0).toUpperCase()}
								</div>
							)}
							<div className="chat-message__content">
								{!isOwn && (
									<div className="chat-message__name" style={{ color: msg.userColor }}>
										{msg.userName}
									</div>
								)}
								{replyMsg && (
									<div className="chat-message__reply-preview">
										<span className="chat-message__reply-name">{replyMsg.userName}</span>
										<span className="chat-message__reply-text">{replyMsg.text.slice(0, 50)}</span>
									</div>
								)}
								<div className="chat-message__bubble">
									<span>{msg.text}</span>
									<span className="chat-message__time">
										{msg.edited && <span className="chat-message__edited">edited </span>}
										{formatTime(msg.timestamp)}
									</span>
								</div>
								{Object.keys(msg.reactions).length > 0 && (
									<div className="chat-message__reactions">
										{Object.entries(msg.reactions).map(([emoji, users]) =>
											users.length > 0 && (
												<button
													key={emoji}
													className={`chat-message__reaction ${users.includes(userId) ? 'chat-message__reaction--active' : ''}`}
													onClick={() => addReaction(msg.id, emoji)}
												>
													{emoji} {users.length}
												</button>
											)
										)}
									</div>
								)}
								<div className="chat-message__actions">
									<button onClick={() => setReplyTo(msg)} title="Reply">↩</button>
									<button onClick={() => setShowEmojiFor(showEmojiFor === msg.id ? null : msg.id)} title="React">😊</button>
								</div>
								{showEmojiFor === msg.id && (
									<div className="chat-message__emoji-picker">
										{EMOJI_REACTIONS.map(emoji => (
											<button
												key={emoji}
												onClick={() => {
													addReaction(msg.id, emoji)
													setShowEmojiFor(null)
												}}
											>
												{emoji}
											</button>
										))}
									</div>
								)}
							</div>
						</div>
					)
				})}

				{/* AI Suggestion Cards */}
				{pendingSuggestions.map((suggestion) => (
					<div key={suggestion.id} className="chat-suggestion">
						<div className="chat-suggestion__header">
							<span className="chat-suggestion__icon">
								{suggestion.type === 'calendar' ? '📅' :
									suggestion.type === 'image' ? '🖼️' :
									suggestion.type === 'video' ? '🎬' :
									suggestion.type === 'expand' ? '📄' :
									suggestion.type === 'summary' ? '📋' : '💡'}
							</span>
							<span className="chat-suggestion__badge">AI Suggestion</span>
						</div>
						<div className="chat-suggestion__title">{suggestion.title}</div>
						<div className="chat-suggestion__desc">{suggestion.description}</div>
						{suggestion.data && suggestion.type === 'calendar' && (
							<div className="chat-suggestion__meta">
								{typeof suggestion.data.date === 'string' && <span>📅 {suggestion.data.date}</span>}
								{typeof suggestion.data.time === 'string' && <span>🕐 {suggestion.data.time}</span>}
							</div>
						)}
						<div className="chat-suggestion__actions">
							<button
								className="chat-suggestion__approve"
								onClick={() => handleApprove(suggestion)}
								disabled={isGenerating}
							>
								{isGenerating && suggestion.type === 'image' ? 'Generating...' : '✓ Approve'}
							</button>
							<button
								className="chat-suggestion__dismiss"
								onClick={() => onDismissSuggestion?.(suggestion.id)}
							>
								✗ Dismiss
							</button>
						</div>
					</div>
				))}

				{/* Image generation result */}
				{imageUrl && (
					<div className="chat-suggestion chat-suggestion--result">
						<div className="chat-suggestion__header">
							<span className="chat-suggestion__icon">🖼️</span>
							<span className="chat-suggestion__badge">Generated Image</span>
						</div>
						<img
							src={imageUrl}
							alt="AI generated"
							className="chat-suggestion__image"
							loading="lazy"
						/>
						<div className="chat-suggestion__actions">
							<button
								className="chat-suggestion__approve"
								onClick={() => {
									onPlaceImageOnCanvas?.(imageUrl)
									resetImage()
								}}
							>
								📌 Place on Canvas
							</button>
							<button
								className="chat-suggestion__dismiss"
								onClick={resetImage}
							>
								Dismiss
							</button>
						</div>
					</div>
				)}

				{/* Agent thinking indicator */}
				{agentStatus === 'thinking' && (
					<div className="chat-message chat-message--agent">
						<div className="chat-message__avatar chat-message__avatar--agent">✨</div>
						<div className="chat-message__content">
							<div className="chat-message__name" style={{ color: '#8b5cf6' }}>AI Assistant</div>
							<div className="chat-message__bubble chat-message__bubble--agent">
								<div className="chat-panel__typing-dots">
									<span /><span /><span />
								</div>
							</div>
						</div>
					</div>
				)}

				<div ref={messagesEndRef} />
			</div>

			{typingUsers.length > 0 && (
				<div className="chat-panel__typing">
					<div className="chat-panel__typing-dots">
						<span /><span /><span />
					</div>
					{typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
				</div>
			)}

			{replyTo && (
				<div className="chat-panel__reply-bar">
					<span>Replying to <strong>{replyTo.userName}</strong></span>
					<button onClick={() => setReplyTo(null)}>✕</button>
				</div>
			)}

			<div className="chat-panel__input-area">
				<input
					ref={inputRef}
					type="text"
					value={input}
					onChange={handleInputChange}
					onKeyDown={handleKeyDown}
					placeholder="Type a message..."
					className="chat-panel__input"
				/>
				<button
					className="chat-panel__send"
					onClick={handleSend}
					disabled={!input.trim()}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
					</svg>
				</button>
			</div>
		</div>
	)
}
