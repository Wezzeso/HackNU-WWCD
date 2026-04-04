import { useState, useRef, useEffect } from 'react'
import { useChat, type ChatMessage } from '../hooks/useChat'
import './ChatPanel.css'

interface ChatPanelProps {
	roomId: string
	userId: string
	userName: string
	userColor: string
	isOpen: boolean
	onClose: () => void
}

const EMOJI_REACTIONS = ['👍', '❤️', '😂', '🎉', '🤔', '👀']

export function ChatPanel({ roomId, userId, userName, userColor, isOpen, onClose }: ChatPanelProps) {
	const {
		messages, onlineUsers, typingUsers,
		sendMessage, addReaction, sendTyping,
		isConnected, unreadCount, resetUnread,
	} = useChat(roomId, userId, userName, userColor, isOpen)

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
	}, [messages])

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

	return (
		<div className={`chat-panel ${isOpen ? 'chat-panel--open' : ''}`}>
			<div className="chat-panel__header">
				<div className="chat-panel__header-left">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
					</svg>
					<span>Chat</span>
					<span className={`chat-panel__status ${isConnected ? 'chat-panel__status--connected' : ''}`}>
						{isConnected ? 'Online' : 'Offline'}
					</span>
				</div>
				<div className="chat-panel__header-right">
					<div className="chat-panel__online-count">
						<span className="chat-panel__online-dot" />
						{onlineUsers.length}
					</div>
					<button className="chat-panel__close" onClick={onClose} aria-label="Close chat">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<path d="M18 6L6 18M6 6l12 12" />
						</svg>
					</button>
				</div>
			</div>

			<div className="chat-panel__online-bar">
				{onlineUsers.map(user => (
					<div
						key={user.id}
						className="chat-panel__user-avatar"
						style={{ background: user.color }}
						title={user.name}
					>
						{user.name.charAt(0).toUpperCase()}
					</div>
				))}
			</div>

			<div className="chat-panel__messages">
				{messages.length === 0 && (
					<div className="chat-panel__empty">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</svg>
						<p>No messages yet</p>
						<p className="chat-panel__empty-sub">Start the conversation!</p>
					</div>
				)}

				{messages.map((msg) => {
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
