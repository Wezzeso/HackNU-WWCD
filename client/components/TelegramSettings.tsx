import { useState } from 'react'
import './TelegramSettings.css'

interface TelegramSettingsProps {
	roomId: string
	isOpen: boolean
	onClose: () => void
}

export function TelegramSettings({ roomId, isOpen, onClose }: TelegramSettingsProps) {
	const [chatId, setChatId] = useState('')
	const [botInfo, setBotInfo] = useState<any>(null)
	const [shareMessage, setShareMessage] = useState('')
	const [shareStatus, setShareStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

	const fetchBotInfo = async () => {
		try {
			const res = await fetch('/api/telegram/me')
			if (res.ok) {
				const data = await res.json()
				setBotInfo(data.result)
			}
		} catch (err) {
			console.error('Bot info error:', err)
		}
	}

	const shareToTelegram = async () => {
		if (!chatId) return

		setShareStatus('sending')
		try {
			const res = await fetch('/api/telegram/share', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chatId,
					roomId,
					message: shareMessage || `🎨 Check out this collaboration board!`,
				}),
			})

			if (res.ok) {
				setShareStatus('sent')
				setTimeout(() => setShareStatus('idle'), 3000)
			} else {
				setShareStatus('error')
			}
		} catch (err) {
			setShareStatus('error')
		}
	}

	const exportBoardToTelegram = async () => {
		if (!chatId) return

		setShareStatus('sending')
		try {
			// Capture the board as an image using tldraw's export
			// For now, share the link
			const baseUrl = window.location.origin
			const res = await fetch('/api/telegram/share', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chatId,
					roomId,
					message: `📋 Board Export\n\n${shareMessage || 'Here\'s the latest board state:'}\n\n🔗 View board: ${baseUrl}/${roomId}`,
				}),
			})

			if (res.ok) {
				setShareStatus('sent')
				setTimeout(() => setShareStatus('idle'), 3000)
			} else {
				setShareStatus('error')
			}
		} catch (err) {
			setShareStatus('error')
		}
	}

	if (!isOpen) return null

	return (
		<div className="telegram-settings">
			<div className="telegram-settings__header">
				<div className="telegram-settings__header-left">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="#29B6F6">
						<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
					</svg>
					<span>Telegram</span>
				</div>
				<button className="telegram-settings__close" onClick={onClose}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div className="telegram-settings__content">
				{!botInfo ? (
					<div className="telegram-settings__setup">
						<p>Connect your Telegram bot to share boards and receive notifications.</p>
						<button className="telegram-settings__check-btn" onClick={fetchBotInfo}>
							Check Bot Connection
						</button>
					</div>
				) : (
					<div className="telegram-settings__bot-info">
						<div className="telegram-settings__bot-card">
							<span className="telegram-settings__bot-icon">🤖</span>
							<div>
								<div className="telegram-settings__bot-name">{botInfo.first_name}</div>
								<div className="telegram-settings__bot-username">@{botInfo.username}</div>
							</div>
							<span className="telegram-settings__bot-status">Connected ✓</span>
						</div>
					</div>
				)}

				<div className="telegram-settings__share-section">
					<h4>Share to Telegram</h4>
					<input
						type="text"
						placeholder="Telegram Chat ID"
						value={chatId}
						onChange={(e) => setChatId(e.target.value)}
						className="telegram-settings__input"
					/>
					<textarea
						placeholder="Optional message..."
						value={shareMessage}
						onChange={(e) => setShareMessage(e.target.value)}
						className="telegram-settings__textarea"
						rows={2}
					/>
					<div className="telegram-settings__share-actions">
						<button className="telegram-settings__share-btn" onClick={shareToTelegram} disabled={!chatId || shareStatus === 'sending'}>
							{shareStatus === 'sending' ? '⟳ Sending...' : shareStatus === 'sent' ? '✓ Sent!' : '📤 Share Link'}
						</button>
						<button className="telegram-settings__export-btn" onClick={exportBoardToTelegram} disabled={!chatId || shareStatus === 'sending'}>
							📋 Export Board
						</button>
					</div>
					{shareStatus === 'error' && <span className="telegram-settings__error">Failed to send. Check Chat ID.</span>}
				</div>
			</div>
		</div>
	)
}
