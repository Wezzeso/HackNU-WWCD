import { useSync } from '@tldraw/sync'
import { ReactNode, useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Tldraw, Editor } from 'tldraw'
import { getBookmarkPreview } from '../getBookmarkPreview'
import { multiplayerAssetStore } from '../multiplayerAssetStore'
import { Sidebar, type PanelType } from '../components/Sidebar'
import { ChatPanel } from '../components/ChatPanel'
import { VideoCallPanel } from '../components/VideoCallPanel'
import { GeminiPanel } from '../components/GeminiPanel'
import { MusicPlayer } from '../components/MusicPlayer'
import { CalendarWidget } from '../components/CalendarWidget'
import { TelegramSettings } from '../components/TelegramSettings'
import { useChat } from '../hooks/useChat'
import { getUserColor } from '../utils/supabase'
import { getLocalStorageItem, setLocalStorageItem } from '../localStorage'

// Generate or retrieve a persistent user identity
function getUserIdentity() {
	let userId = getLocalStorageItem('user-id')
	let userName = getLocalStorageItem('user-name')

	if (!userId) {
		userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
		setLocalStorageItem('user-id', userId)
	}
	if (!userName) {
		userName = `User ${userId.slice(-4)}`
		setLocalStorageItem('user-name', userName)
	}

	return { userId, userName, userColor: getUserColor(userId) }
}

export function Room() {
	const { roomId } = useParams<{ roomId: string }>()
	const [editorRef, setEditorRef] = useState<Editor | null>(null)
	const { userId, userName, userColor } = getUserIdentity()

	// Create a store connected to multiplayer.
	const store = useSync({
		uri: `${window.location.origin.replace(/^http/, 'ws')}/api/connect/${roomId}`,
		assets: multiplayerAssetStore,
	})

	const getBoardContext = useCallback(() => {
		if (!editorRef) return ''
		try {
			const shapes = editorRef.getCurrentPageShapes()
			return shapes.map((s: any) => {
				if (s.type === 'text') return s.props?.text || ''
				if (s.type === 'note') return s.props?.text || ''
				if (s.type === 'geo') return `[${s.props?.geo}] ${s.props?.text || ''}`
				return `[${s.type}]`
			}).filter(Boolean).join('\n')
		} catch {
			return ''
		}
	}, [editorRef])

	return (
		<RoomWrapper roomId={roomId} userId={userId} userName={userName} userColor={userColor} getBoardContext={getBoardContext}>
			<Tldraw
				store={store}
				options={{ deepLinks: true }}
				onMount={(editor) => {
					editor.registerExternalAssetHandler('url', getBookmarkPreview)
					editor.updateInstanceState({ isGridMode: true })
					setEditorRef(editor)
				}}
			/>
		</RoomWrapper>
	)
}

function RoomWrapper({
	children,
	roomId,
	userId,
	userName,
	userColor,
	getBoardContext,
}: {
	children: ReactNode
	roomId?: string
	userId: string
	userName: string
	userColor: string
	getBoardContext: () => string
}) {
	const [didCopy, setDidCopy] = useState(false)
	const [activePanel, setActivePanel] = useState<PanelType>(null)
	const [editingName, setEditingName] = useState(false)
	const [nameInput, setNameInput] = useState(userName)

	// We need unread count from chat even when panel is closed
	const chatUnread = 0 // This is tracked inside ChatPanel via the hook

	useEffect(() => {
		if (!didCopy) return
		const timeout = setTimeout(() => setDidCopy(false), 3000)
		return () => clearTimeout(timeout)
	}, [didCopy])

	const handleNameSave = () => {
		if (nameInput.trim()) {
			setLocalStorageItem('user-name', nameInput.trim())
			setEditingName(false)
			// Reload to apply new name
			window.location.reload()
		}
	}

	return (
		<div className="RoomWrapper">
			<div className="RoomWrapper-header">
				<WifiIcon />
				<div className="RoomWrapper-roomId">{roomId}</div>
				<button
					className="RoomWrapper-copy"
					onClick={() => {
						navigator.clipboard.writeText(window.location.href)
						setDidCopy(true)
					}}
					aria-label="copy room link"
				>
					Copy link
					{didCopy && <div className="RoomWrapper-copied">Copied!</div>}
				</button>

				<div className="RoomWrapper-spacer" />

				<div className="RoomWrapper-user">
					{editingName ? (
						<div className="RoomWrapper-name-edit">
							<input
								type="text"
								value={nameInput}
								onChange={(e) => setNameInput(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
								autoFocus
							/>
							<button onClick={handleNameSave}>✓</button>
						</div>
					) : (
						<button className="RoomWrapper-user-btn" onClick={() => setEditingName(true)}>
							<div className="RoomWrapper-user-avatar" style={{ background: userColor }}>
								{userName.charAt(0).toUpperCase()}
							</div>
							<span>{userName}</span>
						</button>
					)}
				</div>
			</div>

			<div className="RoomWrapper-content">
				{children}

				{/* Sidebar toolbar */}
				<Sidebar
					activePanel={activePanel}
					onPanelChange={setActivePanel}
					chatUnread={chatUnread}
				/>

				{/* Panels */}
				<ChatPanel
					roomId={roomId || ''}
					userId={userId}
					userName={userName}
					userColor={userColor}
					isOpen={activePanel === 'chat'}
					onClose={() => setActivePanel(null)}
				/>

				<VideoCallPanel
					roomId={roomId || ''}
					userId={userId}
					userName={userName}
					isOpen={activePanel === 'video'}
					onClose={() => setActivePanel(null)}
				/>

				<GeminiPanel
					roomId={roomId || ''}
					isOpen={activePanel === 'gemini'}
					onClose={() => setActivePanel(null)}
					getBoardContext={getBoardContext}
				/>

				<MusicPlayer
					roomId={roomId || ''}
					userId={userId}
					userName={userName}
					isOpen={activePanel === 'music'}
					onClose={() => setActivePanel(null)}
				/>

				<CalendarWidget
					userId={userId}
					isOpen={activePanel === 'calendar'}
					onClose={() => setActivePanel(null)}
				/>

				<TelegramSettings
					roomId={roomId || ''}
					isOpen={activePanel === 'telegram'}
					onClose={() => setActivePanel(null)}
				/>
			</div>
		</div>
	)
}

function WifiIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			strokeWidth="1.5"
			stroke="currentColor"
			width={16}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z"
			/>
		</svg>
	)
}
