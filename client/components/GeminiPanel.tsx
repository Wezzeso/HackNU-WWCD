import { useState, useRef, useEffect } from 'react'
import { useGemini } from '../hooks/useGemini'
import './GeminiPanel.css'

interface GeminiPanelProps {
	roomId: string
	isOpen: boolean
	onClose: () => void
	getBoardContext?: () => string
}

interface ConversationMessage {
	role: 'user' | 'assistant'
	text: string
	timestamp: number
}

export function GeminiPanel({ roomId, isOpen, onClose, getBoardContext }: GeminiPanelProps) {
	const { isLoading, askGemini } = useGemini()
	const [input, setInput] = useState('')
	const [conversation, setConversation] = useState<ConversationMessage[]>([])
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLTextAreaElement>(null)

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [conversation])

	useEffect(() => {
		if (isOpen) inputRef.current?.focus()
	}, [isOpen])

	const handleSend = async () => {
		const prompt = input.trim()
		if (!prompt || isLoading) return

		setInput('')
		setConversation(prev => [...prev, { role: 'user', text: prompt, timestamp: Date.now() }])

		const context = getBoardContext?.() || ''
		const response = await askGemini(prompt, context)

		if (response) {
			setConversation(prev => [...prev, { role: 'assistant', text: response, timestamp: Date.now() }])
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			handleSend()
		}
	}

	const quickActions = [
		{ label: '💡 Brainstorm', prompt: 'Help me brainstorm ideas based on what\'s on the board' },
		{ label: '📋 Summarize', prompt: 'Summarize the content on this board' },
		{ label: '✅ Action items', prompt: 'Create a list of action items from this board' },
		{ label: '🎯 Prioritize', prompt: 'Help prioritize the items on this board' },
	]

	if (!isOpen) return null

	return (
		<div className="gemini-panel">
			<div className="gemini-panel__header">
				<div className="gemini-panel__header-left">
					<div className="gemini-panel__icon">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
							<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
						</svg>
					</div>
					<span>Gemini AI</span>
				</div>
				<button className="gemini-panel__close" onClick={onClose}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div className="gemini-panel__messages">
				{conversation.length === 0 && (
					<div className="gemini-panel__welcome">
						<div className="gemini-panel__welcome-icon">✨</div>
						<h3>How can I help?</h3>
						<p>I can analyze your board, brainstorm ideas, create action items, and more.</p>
						<div className="gemini-panel__quick-actions">
							{quickActions.map(action => (
								<button
									key={action.label}
									className="gemini-panel__quick-action"
									onClick={() => {
										setInput(action.prompt)
										setTimeout(() => handleSend(), 100)
									}}
								>
									{action.label}
								</button>
							))}
						</div>
					</div>
				)}

				{conversation.map((msg, i) => (
					<div key={i} className={`gemini-msg gemini-msg--${msg.role}`}>
						{msg.role === 'assistant' && (
							<div className="gemini-msg__avatar">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
									<path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="2"/>
								</svg>
							</div>
						)}
						<div className="gemini-msg__content">
							<div className="gemini-msg__text" dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.text) }} />
						</div>
					</div>
				))}

				{isLoading && (
					<div className="gemini-msg gemini-msg--assistant">
						<div className="gemini-msg__avatar">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
								<path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="2"/>
							</svg>
						</div>
						<div className="gemini-msg__content">
							<div className="gemini-msg__loading">
								<span /><span /><span />
							</div>
						</div>
					</div>
				)}

				<div ref={messagesEndRef} />
			</div>

			<div className="gemini-panel__input-area">
				<textarea
					ref={inputRef}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Ask Gemini anything..."
					className="gemini-panel__input"
					rows={1}
				/>
				<button
					className="gemini-panel__send"
					onClick={handleSend}
					disabled={!input.trim() || isLoading}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
					</svg>
				</button>
			</div>
		</div>
	)
}

function formatMarkdown(text: string): string {
	return text
		.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
		.replace(/\*(.*?)\*/g, '<em>$1</em>')
		.replace(/`(.*?)`/g, '<code>$1</code>')
		.replace(/\n/g, '<br />')
		.replace(/^- (.*)/gm, '<li>$1</li>')
		.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
}
