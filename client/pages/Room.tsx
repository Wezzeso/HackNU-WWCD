import { useSync } from '@tldraw/sync'
import type { LucideIcon } from 'lucide-react'
import {
	Check,
	Copy,
	Share2,
	Wifi,
} from 'lucide-react'
import { ReactNode, Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Editor, Tldraw, useValue } from 'tldraw'
import { getBookmarkPreview } from '../getBookmarkPreview'
import { multiplayerAssetStore } from '../multiplayerAssetStore'
import { PANEL_TOOLS, Sidebar, type ToolPanel } from '../components/Sidebar'
import { FloatingWindow } from '../components/FloatingWindow'
import { TldrawContextualToolbar } from '../components/TldrawContextualToolbar'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { useThemePreference } from '../hooks/useTheme'
import { getLocalStorageItem, setLocalStorageItem } from '../localStorage'
import { getWsUrl } from '../utils/network'
import { getUserColor } from '../utils/supabase'
import { getTldrawAssetUrls } from '../utils/tldrawAssets'

const ChatPanel = lazy(async () => {
	const mod = await import('../components/ChatPanel')
	return { default: mod.ChatPanel }
})

const VideoCallPanel = lazy(async () => {
	const mod = await import('../components/VideoCallPanel')
	return { default: mod.VideoCallPanel }
})

const GeminiPanel = lazy(async () => {
	const mod = await import('../components/GeminiPanel')
	return { default: mod.GeminiPanel }
})

const MusicPlayer = lazy(async () => {
	const mod = await import('../components/MusicPlayer')
	return { default: mod.MusicPlayer }
})

const CalendarWidget = lazy(async () => {
	const mod = await import('../components/CalendarWidget')
	return { default: mod.CalendarWidget }
})

const TelegramSettings = lazy(async () => {
	const mod = await import('../components/TelegramSettings')
	return { default: mod.TelegramSettings }
})

const PANEL_SPECS: Record<
	ToolPanel,
	{
		title: string
		subtitle: string
		accent: string
		position: { x: number; y: number }
		size: { width: number; height: number }
		minSize: { width?: number; height?: number }
	}
> = {
	chat: {
		title: 'Chat',
		subtitle: 'Live room presence and messages',
		accent: 'hsl(217, 80%, 50%)',
		position: { x: 28, y: 152 },
		size: { width: 390, height: 360 },
		minSize: { width: 360, height: 320 },
	},
	video: {
		title: 'Video Call',
		subtitle: 'Camera, mic, and screen sharing',
		accent: 'hsl(142, 70%, 45%)',
		position: { x: 210, y: 168 },
		size: { width: 560, height: 460 },
		minSize: { width: 420, height: 280 },
	},
	gemini: {
		title: 'Gemini AI',
		subtitle: 'Board-aware assistant',
		accent: 'hsl(260, 80%, 55%)',
		position: { x: 430, y: 148 },
		size: { width: 430, height: 560 },
		minSize: { width: 380, height: 340 },
	},
	music: {
		title: 'Music',
		subtitle: 'Shared soundtrack',
		accent: 'hsl(300, 70%, 50%)',
		position: { x: 110, y: 452 },
		size: { width: 400, height: 360 },
		minSize: { width: 360, height: 260 },
	},
	calendar: {
		title: 'Calendar',
		subtitle: 'Events and scheduling',
		accent: 'hsl(45, 90%, 50%)',
		position: { x: 44, y: 210 },
		size: { width: 360, height: 480 },
		minSize: { width: 340, height: 320 },
	},
	telegram: {
		title: 'Telegram',
		subtitle: 'Share room updates',
		accent: 'hsl(199, 92%, 56%)',
		position: { x: 590, y: 188 },
		size: { width: 390, height: 430 },
		minSize: { width: 360, height: 300 },
	},
}

function createRoomId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `test-room-${crypto.randomUUID()}`
	}

	return `test-room-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

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

function truncateMiddle(value: string, start = 8, end = 6) {
	if (value.length <= start + end + 3) return value
	return `${value.slice(0, start)}...${value.slice(-end)}`
}

export function Room() {
	const { roomId } = useParams<{ roomId: string }>()
	const [editorRef, setEditorRef] = useState<Editor | null>(null)
	const identity = useMemo(() => getUserIdentity(), [])
	const [currentUserName, setCurrentUserName] = useState(identity.userName)
	const { resolvedTheme } = useThemePreference()
	const assetUrls = useMemo(() => getTldrawAssetUrls(), [])
	const tldrawComponents = useMemo(
		() => ({
			StylePanel: null,
			Toolbar: TldrawContextualToolbar,
		}),
		[]
	)

	useEffect(() => {
		if (!editorRef) return
		editorRef.user.updateUserPreferences({
			colorScheme: resolvedTheme === 'dark' ? 'dark' : 'light',
			name: currentUserName,
			color: identity.userColor,
		})
	}, [currentUserName, editorRef, identity.userColor, resolvedTheme])

	const activeUsers = useValue(
		'active users',
		() => {
			if (!editorRef) return []
			return editorRef.getCollaboratorsOnCurrentPage().map((user) => ({
				userId: user.userId,
				userName: user.userName,
				color: user.color,
			}))
		},
		[editorRef]
	)

	// Create a store connected to multiplayer.
	const store = useSync({
		uri: getWsUrl(`/api/connect/${roomId}`),
		assets: multiplayerAssetStore,
	})

	const getBoardContext = useCallback(() => {
		if (!editorRef) return ''
		try {
			const shapes = editorRef.getCurrentPageShapes()
			return shapes
				.map((s: any) => {
					if (s.type === 'text') return s.props?.text || ''
					if (s.type === 'note') return s.props?.text || ''
					if (s.type === 'geo') return `[${s.props?.geo}] ${s.props?.text || ''}`
					return `[${s.type}]`
				})
				.filter(Boolean)
				.join('\n')
		} catch {
			return ''
		}
	}, [editorRef])

	return (
		<RoomWrapper
			roomId={roomId}
			userId={identity.userId}
			userName={currentUserName}
			userColor={identity.userColor}
			setUserName={setCurrentUserName}
			activeUsers={activeUsers}
			getBoardContext={getBoardContext}
		>
			<Tldraw
				store={store}
				assetUrls={assetUrls}
				components={tldrawComponents}
				options={{ deepLinks: true }}
				onMount={(editor) => {
					editor.registerExternalAssetHandler('url', getBookmarkPreview)
					editor.updateInstanceState({ isGridMode: true })
					editor.user.updateUserPreferences({
						colorScheme: resolvedTheme === 'dark' ? 'dark' : 'light',
					})
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
	setUserName,
	activeUsers,
	getBoardContext,
}: {
	children: ReactNode
	roomId?: string
	userId: string
	userName: string
	userColor: string
	setUserName: (name: string) => void
	activeUsers: Array<{ userId: string; userName: string; color: string }>
	getBoardContext: () => string
}) {
	const [didCopy, setDidCopy] = useState(false)
	const [editingName, setEditingName] = useState(false)
	const [nameInput, setNameInput] = useState(userName)
	const [mountedPanels, setMountedPanels] = useState<Partial<Record<ToolPanel, boolean>>>({})
	const [visiblePanels, setVisiblePanels] = useState<Partial<Record<ToolPanel, boolean>>>({})
	const [panelZ, setPanelZ] = useState<Record<ToolPanel, number>>({
		chat: 1100,
		video: 1101,
		gemini: 1102,
		music: 1103,
		calendar: 1104,
		telegram: 1105,
	})

	useEffect(() => {
		setNameInput(userName)
	}, [userName])

	useEffect(() => {
		if (!didCopy) return
		const timeout = setTimeout(() => setDidCopy(false), 2200)
		return () => clearTimeout(timeout)
	}, [didCopy])

	const focusPanel = useCallback((panel: ToolPanel) => {
		setPanelZ((prev) => {
			const top = Math.max(...Object.values(prev))
			if (prev[panel] === top) return prev
			return { ...prev, [panel]: top + 1 }
		})
	}, [])

	const togglePanel = useCallback(
		(panel: ToolPanel) => {
			setMountedPanels((prev) => ({ ...prev, [panel]: true }))
			setVisiblePanels((prev) => {
				const nextVisible = !prev[panel]
				return { ...prev, [panel]: nextVisible }
			})
			focusPanel(panel)
		},
		[focusPanel]
	)

	const hidePanel = useCallback((panel: ToolPanel) => {
		setVisiblePanels((prev) => ({ ...prev, [panel]: false }))
	}, [])

	const closePanel = useCallback((panel: ToolPanel) => {
		setVisiblePanels((prev) => ({ ...prev, [panel]: false }))
		setMountedPanels((prev) => ({ ...prev, [panel]: false }))
	}, [])

	const handleNameSave = () => {
		const nextName = nameInput.trim()
		if (!nextName) return
		setLocalStorageItem('user-name', nextName)
		setUserName(nextName)
		setEditingName(false)
	}

	const handleCopyLink = async () => {
		try {
			await navigator.clipboard.writeText(window.location.href)
			setDidCopy(true)
		} catch {
			setDidCopy(false)
		}
	}

	const openPanelsCount = Object.values(visiblePanels).filter(Boolean).length
	const currentRoomId = roomId ?? createRoomId()
	const allActiveUsers = useMemo(() => {
		const map = new Map<string, { userId: string; userName: string; color: string }>()
		map.set(userId, { userId, userName, color: userColor })
		for (const user of activeUsers) {
			map.set(user.userId, user)
		}
		return Array.from(map.values())
	}, [activeUsers, userColor, userId, userName])

	return (
		<div className="relative min-h-screen overflow-hidden bg-background text-foreground">
			<div className="pointer-events-none absolute right-3 top-3 z-[980] md:right-4 md:top-4">
				<Card className="pointer-events-auto rounded-[22px] border-border/70 bg-background/88 shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur-xl">
					<div className="flex flex-wrap items-center gap-2 p-2">
						<div className="flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-2.5 py-1.5">
							<div className="flex -space-x-2">
								{allActiveUsers.slice(0, 4).map((activeUser) => (
									<div
										key={activeUser.userId}
										className="flex size-8 items-center justify-center rounded-full border-2 border-background text-[11px] font-bold text-white"
										style={{ background: activeUser.color }}
										title={activeUser.userName}
									>
										{activeUser.userName.charAt(0).toUpperCase()}
									</div>
								))}
							</div>
							<div className="pr-1 leading-tight">
								<div className="inline-flex items-center gap-1.5 text-sm font-medium">
									<Wifi size={12} />
									Active users
								</div>
								<div className="text-[11px] text-muted-foreground">
									{allActiveUsers.length} in room
									<span className="ml-1 hidden sm:inline">· {truncateMiddle(currentRoomId, 8, 4)}</span>
								</div>
							</div>
						</div>

						<Button
							type="button"
							variant="outline"
							size="sm"
							className="rounded-full border-border/70 bg-card/80 px-3"
							onClick={handleCopyLink}
						>
							{didCopy ? <Check size={14} className="mr-1.5" /> : <Share2 size={14} className="mr-1.5" />}
							{didCopy ? 'Copied' : 'Share'}
						</Button>

						{editingName ? (
							<div className="flex items-center gap-2 rounded-full border border-border/70 bg-card/80 p-1.5">
								<Input
									value={nameInput}
									onChange={(event) => setNameInput(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === 'Enter') handleNameSave()
										if (event.key === 'Escape') {
											setNameInput(userName)
											setEditingName(false)
										}
									}}
									autoFocus
									className="h-8 min-w-[10rem] border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
								/>
								<Button type="button" size="sm" className="rounded-full px-3" onClick={handleNameSave}>
									Save
								</Button>
							</div>
						) : (
							<button
								type="button"
								className="flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-2 py-1.5 text-left transition hover:border-border hover:bg-card"
								onClick={() => setEditingName(true)}
							>
								<div
									className="flex size-8 items-center justify-center rounded-full text-xs font-bold text-white"
									style={{ background: userColor }}
								>
									{userName.charAt(0).toUpperCase()}
								</div>
								<div className="pr-2 leading-tight">
									<div className="text-sm font-medium">{userName}</div>
									<div className="text-[11px] text-muted-foreground">My profile</div>
								</div>
							</button>
						)}
					</div>
				</Card>
			</div>

			<main className="absolute inset-0">
				<div className="absolute inset-0 overflow-hidden">
					{children}
					<div className="pointer-events-none absolute inset-2 rounded-[28px] border border-white/35 dark:border-white/10" />

					<Sidebar visiblePanels={visiblePanels} onPanelChange={togglePanel} chatUnread={0} />

					<Suspense fallback={null}>
						{mountedPanels.chat ? (
							<FloatingWindow
								id="chat"
								title={PANEL_SPECS.chat.title}
								subtitle={PANEL_SPECS.chat.subtitle}
								accent={PANEL_SPECS.chat.accent}
								visible={!!visiblePanels.chat}
								zIndex={panelZ.chat}
								defaultPosition={PANEL_SPECS.chat.position}
								defaultSize={PANEL_SPECS.chat.size}
								minSize={PANEL_SPECS.chat.minSize}
								onHide={() => hidePanel('chat')}
								onClose={() => closePanel('chat')}
								onFocus={() => focusPanel('chat')}
							>
								<ChatPanel
									roomId={roomId || ''}
									userId={userId}
									userName={userName}
									userColor={userColor}
									isOpen={!!visiblePanels.chat}
									onClose={() => hidePanel('chat')}
								/>
							</FloatingWindow>
						) : null}

						{mountedPanels.video ? (
							<FloatingWindow
								id="video"
								title={PANEL_SPECS.video.title}
								subtitle={PANEL_SPECS.video.subtitle}
								accent={PANEL_SPECS.video.accent}
								visible={!!visiblePanels.video}
								zIndex={panelZ.video}
								defaultPosition={PANEL_SPECS.video.position}
								defaultSize={PANEL_SPECS.video.size}
								minSize={PANEL_SPECS.video.minSize}
								onHide={() => hidePanel('video')}
								onClose={() => closePanel('video')}
								onFocus={() => focusPanel('video')}
							>
								<VideoCallPanel
									roomId={roomId || ''}
									userId={userId}
									userName={userName}
									isOpen={!!visiblePanels.video}
									onClose={() => hidePanel('video')}
								/>
							</FloatingWindow>
						) : null}

						{mountedPanels.gemini ? (
							<FloatingWindow
								id="gemini"
								title={PANEL_SPECS.gemini.title}
								subtitle={PANEL_SPECS.gemini.subtitle}
								accent={PANEL_SPECS.gemini.accent}
								visible={!!visiblePanels.gemini}
								zIndex={panelZ.gemini}
								defaultPosition={PANEL_SPECS.gemini.position}
								defaultSize={PANEL_SPECS.gemini.size}
								minSize={PANEL_SPECS.gemini.minSize}
								onHide={() => hidePanel('gemini')}
								onClose={() => closePanel('gemini')}
								onFocus={() => focusPanel('gemini')}
							>
								<GeminiPanel
									roomId={roomId || ''}
									isOpen={!!visiblePanels.gemini}
									onClose={() => hidePanel('gemini')}
									getBoardContext={getBoardContext}
								/>
							</FloatingWindow>
						) : null}

						{mountedPanels.music ? (
							<FloatingWindow
								id="music"
								title={PANEL_SPECS.music.title}
								subtitle={PANEL_SPECS.music.subtitle}
								accent={PANEL_SPECS.music.accent}
								visible={!!visiblePanels.music}
								zIndex={panelZ.music}
								defaultPosition={PANEL_SPECS.music.position}
								defaultSize={PANEL_SPECS.music.size}
								minSize={PANEL_SPECS.music.minSize}
								onHide={() => hidePanel('music')}
								onClose={() => closePanel('music')}
								onFocus={() => focusPanel('music')}
							>
								<MusicPlayer
									roomId={roomId || ''}
									userId={userId}
									userName={userName}
									isOpen={!!visiblePanels.music}
									onClose={() => hidePanel('music')}
								/>
							</FloatingWindow>
						) : null}

						{mountedPanels.calendar ? (
							<FloatingWindow
								id="calendar"
								title={PANEL_SPECS.calendar.title}
								subtitle={PANEL_SPECS.calendar.subtitle}
								accent={PANEL_SPECS.calendar.accent}
								visible={!!visiblePanels.calendar}
								zIndex={panelZ.calendar}
								defaultPosition={PANEL_SPECS.calendar.position}
								defaultSize={PANEL_SPECS.calendar.size}
								minSize={PANEL_SPECS.calendar.minSize}
								onHide={() => hidePanel('calendar')}
								onClose={() => closePanel('calendar')}
								onFocus={() => focusPanel('calendar')}
							>
								<CalendarWidget
									userId={userId}
									isOpen={!!visiblePanels.calendar}
									onClose={() => hidePanel('calendar')}
								/>
							</FloatingWindow>
						) : null}

						{mountedPanels.telegram ? (
							<FloatingWindow
								id="telegram"
								title={PANEL_SPECS.telegram.title}
								subtitle={PANEL_SPECS.telegram.subtitle}
								accent={PANEL_SPECS.telegram.accent}
								visible={!!visiblePanels.telegram}
								zIndex={panelZ.telegram}
								defaultPosition={PANEL_SPECS.telegram.position}
								defaultSize={PANEL_SPECS.telegram.size}
								minSize={PANEL_SPECS.telegram.minSize}
								onHide={() => hidePanel('telegram')}
								onClose={() => closePanel('telegram')}
								onFocus={() => focusPanel('telegram')}
							>
								<TelegramSettings
									roomId={roomId || ''}
									isOpen={!!visiblePanels.telegram}
									onClose={() => hidePanel('telegram')}
								/>
							</FloatingWindow>
						) : null}
					</Suspense>
				</div>
			</main>
		</div>
	)
}
