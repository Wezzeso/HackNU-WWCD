import { useSync } from '@tldraw/sync'
import {
	KeyboardEvent as ReactKeyboardEvent,
	PointerEvent as ReactPointerEvent,
	ReactNode,
	Suspense,
	lazy,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { useParams } from 'react-router-dom'
import { Editor, Tldraw, defaultShapeUtils, useValue } from 'tldraw'
import { getBookmarkPreview } from '../getBookmarkPreview'
import { multiplayerAssetStore } from '../multiplayerAssetStore'
import { Sidebar } from '../components/Sidebar'
import { TldrawContextualToolbar } from '../components/TldrawContextualToolbar'
import { getLocalStorageItem, setLocalStorageItem } from '../localStorage'
import { ReactionStampShapeUtil } from '../tldraw/ReactionStampShapeUtil'
import { StampTool } from '../tldraw/StampTool'
import { getWsUrl } from '../utils/network'
import { getUserColor } from '../utils/supabase'
import { getTldrawAssetUrls } from '../utils/tldrawAssets'
import { useAgentSync } from '../hooks/useAgentSync'

type PageId = ReturnType<Editor['getCurrentPageId']>
type ResizingSide = 'left' | 'right'

const DESKTOP_LAYOUT_QUERY = '(min-width: 1280px)'
const LEFT_PANEL_WIDTH_KEY = 'room-left-panel-width'
const RIGHT_PANEL_WIDTH_KEY = 'room-right-panel-width'
const DEFAULT_LEFT_PANEL_WIDTH = 260
const DEFAULT_RIGHT_PANEL_WIDTH = 340
const LEFT_PANEL_MIN_WIDTH = 220
const LEFT_PANEL_MAX_WIDTH = 420
const RIGHT_PANEL_MIN_WIDTH = 280
const RIGHT_PANEL_MAX_WIDTH = 520
const ROOM_MIN_CENTER_WIDTH = 560
const PANEL_KEYBOARD_STEP = 24

const ChatPanel = lazy(async () => {
	const mod = await import('../components/ChatPanel')
	return { default: mod.ChatPanel }
})

const MusicPlayer = lazy(async () => {
	const mod = await import('../components/MusicPlayer')
	return { default: mod.MusicPlayer }
})

const CalendarWidget = lazy(async () => {
	const mod = await import('../components/CalendarWidget')
	return { default: mod.CalendarWidget }
})

function createRoomId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `test-room-${crypto.randomUUID()}`
	}

	return `test-room-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

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

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

function getStoredPanelWidth(key: string, fallback: number) {
	const storedValue = getLocalStorageItem(key)
	if (!storedValue) return fallback

	const parsedValue = Number.parseInt(storedValue, 10)
	return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function getIsDesktopLayout() {
	return typeof window !== 'undefined' && window.matchMedia(DESKTOP_LAYOUT_QUERY).matches
}

function getMaxLeftPanelWidth(viewportWidth: number, rightPanelWidth: number) {
	return Math.max(
		LEFT_PANEL_MIN_WIDTH,
		Math.min(LEFT_PANEL_MAX_WIDTH, viewportWidth - rightPanelWidth - ROOM_MIN_CENTER_WIDTH)
	)
}

function getMaxRightPanelWidth(viewportWidth: number, leftPanelWidth: number) {
	return Math.max(
		RIGHT_PANEL_MIN_WIDTH,
		Math.min(RIGHT_PANEL_MAX_WIDTH, viewportWidth - leftPanelWidth - ROOM_MIN_CENTER_WIDTH)
	)
}

function normalizePanelWidths(leftPanelWidth: number, rightPanelWidth: number, viewportWidth: number) {
	let nextLeftPanelWidth = clamp(leftPanelWidth, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH)
	let nextRightPanelWidth = clamp(rightPanelWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH)
	const maxCombinedWidth = Math.max(
		LEFT_PANEL_MIN_WIDTH + RIGHT_PANEL_MIN_WIDTH,
		viewportWidth - ROOM_MIN_CENTER_WIDTH
	)

	if (nextLeftPanelWidth + nextRightPanelWidth <= maxCombinedWidth) {
		return {
			leftPanelWidth: nextLeftPanelWidth,
			rightPanelWidth: nextRightPanelWidth,
		}
	}

	const overflow = nextLeftPanelWidth + nextRightPanelWidth - maxCombinedWidth
	const reducibleRightPanelWidth = nextRightPanelWidth - RIGHT_PANEL_MIN_WIDTH
	const rightReduction = Math.min(overflow, reducibleRightPanelWidth)
	nextRightPanelWidth -= rightReduction

	const remainingOverflow = overflow - rightReduction
	if (remainingOverflow > 0) {
		nextLeftPanelWidth = Math.max(LEFT_PANEL_MIN_WIDTH, nextLeftPanelWidth - remainingOverflow)
	}

	return {
		leftPanelWidth: nextLeftPanelWidth,
		rightPanelWidth: nextRightPanelWidth,
	}
}

export function Room() {
	const { roomId } = useParams<{ roomId: string }>()
	const [editorRef, setEditorRef] = useState<Editor | null>(null)
	const identity = useMemo(() => getUserIdentity(), [])
	const assetUrls = useMemo(() => getTldrawAssetUrls(), [])
	const tldrawShapeUtils = useMemo(() => [...defaultShapeUtils, ReactionStampShapeUtil], [])
	const tldrawTools = useMemo(() => [StampTool], [])
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
			colorScheme: 'light',
			name: identity.userName,
			color: identity.userColor,
		})
	}, [editorRef, identity.userColor, identity.userName])

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

	const pages = useValue(
		'pages',
		() => (editorRef ? editorRef.getPages().map((page) => ({ id: page.id, name: page.name })) : []),
		[editorRef]
	)

	const currentPageId = useValue(
		'current page id',
		() => (editorRef ? editorRef.getCurrentPageId() : null),
		[editorRef]
	)

	const store = useSync({
		uri: getWsUrl(`/api/connect/${roomId}`),
		assets: multiplayerAssetStore,
		shapeUtils: tldrawShapeUtils,
	})

	return (
		<RoomWrapper
			roomId={roomId}
			userId={identity.userId}
			userName={identity.userName}
			userColor={identity.userColor}
			activeUsers={activeUsers}
			pages={pages}
			currentPageId={currentPageId}
			onSelectPage={(pageId) => editorRef?.setCurrentPage(pageId)}
			onAddPage={() => {
				if (!editorRef) return
				const existingPageIds = new Set(editorRef.getPages().map((page) => page.id))
				const nextPageNumber = editorRef.getPages().length + 1
				editorRef.markHistoryStoppingPoint('creating page')
				editorRef.createPage({ name: `Page ${nextPageNumber}` })
				const createdPage = editorRef.getPages().find((page) => !existingPageIds.has(page.id))
				if (createdPage) {
					editorRef.setCurrentPage(createdPage.id)
				}
			}}
			onDeletePage={(pageId) => {
				if (!editorRef || editorRef.getPages().length <= 1) return
				editorRef.markHistoryStoppingPoint('deleting page')
				editorRef.deletePage(pageId)
			}}
		>
			<div className="absolute inset-0">
				<Tldraw
					store={store}
					assetUrls={assetUrls}
					components={tldrawComponents}
					shapeUtils={tldrawShapeUtils}
					tools={tldrawTools}
					options={{ deepLinks: true }}
					onMount={(editor) => {
						editor.registerExternalAssetHandler('url', getBookmarkPreview)
						editor.updateInstanceState({ isGridMode: true })
						editor.user.updateUserPreferences({
							colorScheme: 'light',
						})
						setEditorRef(editor)
					}}
				/>
			</div>
		</RoomWrapper>
	)
}

function RoomWrapper({
	children,
	roomId,
	userId,
	userName,
	userColor,
	activeUsers,
	pages,
	currentPageId,
	onSelectPage,
	onAddPage,
	onDeletePage,
}: {
	children: ReactNode
	roomId?: string
	userId: string
	userName: string
	userColor: string
	activeUsers: Array<{ userId: string; userName: string; color: string }>
	pages: Array<{ id: PageId; name: string }>
	currentPageId: PageId | null
	onSelectPage: (pageId: PageId) => void
	onAddPage: () => void
	onDeletePage: (pageId: PageId) => void
}) {
	const currentRoomId = roomId ?? createRoomId()
	const agent = useAgentSync(currentRoomId, userId, userName)
	const [isDesktopLayout, setIsDesktopLayout] = useState(() => getIsDesktopLayout())
	const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
		getStoredPanelWidth(LEFT_PANEL_WIDTH_KEY, DEFAULT_LEFT_PANEL_WIDTH)
	)
	const [rightPanelWidth, setRightPanelWidth] = useState(() =>
		getStoredPanelWidth(RIGHT_PANEL_WIDTH_KEY, DEFAULT_RIGHT_PANEL_WIDTH)
	)
	const [activeResize, setActiveResize] = useState<{
		side: ResizingSide
		startX: number
		startWidth: number
	} | null>(null)
	const leftPanelWidthRef = useRef(leftPanelWidth)
	const rightPanelWidthRef = useRef(rightPanelWidth)
	const allActiveUsers = useMemo(() => {
		const map = new Map<string, { userId: string; userName: string; color: string }>()
		map.set(userId, { userId, userName, color: userColor })
		for (const user of activeUsers) {
			map.set(user.userId, user)
		}
		return Array.from(map.values())
	}, [activeUsers, userColor, userId, userName])

	useEffect(() => {
		leftPanelWidthRef.current = leftPanelWidth
	}, [leftPanelWidth])

	useEffect(() => {
		rightPanelWidthRef.current = rightPanelWidth
	}, [rightPanelWidth])

	useEffect(() => {
		if (typeof window === 'undefined') return

		const mediaQuery = window.matchMedia(DESKTOP_LAYOUT_QUERY)
		const handleChange = (event: MediaQueryListEvent) => {
			setIsDesktopLayout(event.matches)
		}

		setIsDesktopLayout(mediaQuery.matches)
		mediaQuery.addEventListener('change', handleChange)
		return () => mediaQuery.removeEventListener('change', handleChange)
	}, [])

	useEffect(() => {
		setLocalStorageItem(LEFT_PANEL_WIDTH_KEY, String(leftPanelWidth))
	}, [leftPanelWidth])

	useEffect(() => {
		setLocalStorageItem(RIGHT_PANEL_WIDTH_KEY, String(rightPanelWidth))
	}, [rightPanelWidth])

	useEffect(() => {
		if (!isDesktopLayout || typeof window === 'undefined') return

		const syncPanelWidths = () => {
			const normalizedWidths = normalizePanelWidths(
				leftPanelWidthRef.current,
				rightPanelWidthRef.current,
				window.innerWidth
			)

			if (normalizedWidths.leftPanelWidth !== leftPanelWidthRef.current) {
				setLeftPanelWidth(normalizedWidths.leftPanelWidth)
			}

			if (normalizedWidths.rightPanelWidth !== rightPanelWidthRef.current) {
				setRightPanelWidth(normalizedWidths.rightPanelWidth)
			}
		}

		syncPanelWidths()
		window.addEventListener('resize', syncPanelWidths)
		return () => window.removeEventListener('resize', syncPanelWidths)
	}, [isDesktopLayout])

	useEffect(() => {
		if (!activeResize || typeof window === 'undefined') return

		const handlePointerMove = (event: PointerEvent) => {
			if (activeResize.side === 'left') {
				const maxLeftPanelWidth = getMaxLeftPanelWidth(window.innerWidth, rightPanelWidthRef.current)
				const nextLeftPanelWidth = clamp(
					activeResize.startWidth + event.clientX - activeResize.startX,
					LEFT_PANEL_MIN_WIDTH,
					maxLeftPanelWidth
				)
				setLeftPanelWidth(nextLeftPanelWidth)
				return
			}

			const maxRightPanelWidth = getMaxRightPanelWidth(window.innerWidth, leftPanelWidthRef.current)
			const nextRightPanelWidth = clamp(
				activeResize.startWidth - (event.clientX - activeResize.startX),
				RIGHT_PANEL_MIN_WIDTH,
				maxRightPanelWidth
			)
			setRightPanelWidth(nextRightPanelWidth)
		}

		const handlePointerUp = () => {
			setActiveResize(null)
		}

		const previousCursor = document.body.style.cursor
		const previousUserSelect = document.body.style.userSelect
		document.body.style.cursor = 'col-resize'
		document.body.style.userSelect = 'none'

		window.addEventListener('pointermove', handlePointerMove)
		window.addEventListener('pointerup', handlePointerUp)

		return () => {
			document.body.style.cursor = previousCursor
			document.body.style.userSelect = previousUserSelect
			window.removeEventListener('pointermove', handlePointerMove)
			window.removeEventListener('pointerup', handlePointerUp)
		}
	}, [activeResize])

	const startResize = (side: ResizingSide, event: ReactPointerEvent<HTMLDivElement>) => {
		if (!isDesktopLayout || event.button !== 0) return

		event.preventDefault()
		setActiveResize({
			side,
			startX: event.clientX,
			startWidth: side === 'left' ? leftPanelWidthRef.current : rightPanelWidthRef.current,
		})
	}

	const nudgePanelWidth = (side: ResizingSide, direction: 'increase' | 'decrease') => {
		if (typeof window === 'undefined') return

		const delta = direction === 'increase' ? PANEL_KEYBOARD_STEP : -PANEL_KEYBOARD_STEP
		if (side === 'left') {
			const maxLeftPanelWidth = getMaxLeftPanelWidth(window.innerWidth, rightPanelWidthRef.current)
			setLeftPanelWidth((currentWidth) =>
				clamp(currentWidth + delta, LEFT_PANEL_MIN_WIDTH, maxLeftPanelWidth)
			)
			return
		}

		const maxRightPanelWidth = getMaxRightPanelWidth(window.innerWidth, leftPanelWidthRef.current)
		setRightPanelWidth((currentWidth) =>
			clamp(currentWidth + delta, RIGHT_PANEL_MIN_WIDTH, maxRightPanelWidth)
		)
	}

	const handleResizeHandleKeyDown = (
		side: ResizingSide,
		event: ReactKeyboardEvent<HTMLDivElement>
	) => {
		if (side === 'left') {
			if (event.key === 'ArrowLeft') {
				event.preventDefault()
				nudgePanelWidth('left', 'decrease')
			}
			if (event.key === 'ArrowRight') {
				event.preventDefault()
				nudgePanelWidth('left', 'increase')
			}
			return
		}

		if (event.key === 'ArrowLeft') {
			event.preventDefault()
			nudgePanelWidth('right', 'increase')
		}
		if (event.key === 'ArrowRight') {
			event.preventDefault()
			nudgePanelWidth('right', 'decrease')
		}
	}

	return (
		<div className="h-screen overflow-hidden bg-background text-foreground">
			<div
				className="grid h-screen grid-cols-1 overflow-hidden"
				style={
					isDesktopLayout
						? {
								gridTemplateColumns: `${leftPanelWidth}px minmax(0, 1fr) ${rightPanelWidth}px`,
							}
						: undefined
				}
			>
				<div className="relative h-full min-h-0">
					<Sidebar
						currentRoomId={currentRoomId}
						userId={userId}
						userName={userName}
						userColor={userColor}
						activeUsers={allActiveUsers}
						pages={pages.map((page) => ({ id: String(page.id), name: page.name }))}
						currentPageId={currentPageId ? String(currentPageId) : null}
						agentStatus={agent.agentStatus}
						onSelectPage={(pageId) => onSelectPage(pageId as PageId)}
						onAddPage={onAddPage}
						onDeletePage={(pageId) => onDeletePage(pageId as PageId)}
					/>
					<ResizeHandle
						side="left"
						onPointerDown={startResize}
						onKeyDown={handleResizeHandleKeyDown}
					/>
				</div>

				<section className="relative h-full overflow-hidden border-r border-border bg-card">
					{children}
				</section>

				<aside className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#fbfbfa] px-3 py-2">
					<ResizeHandle
						side="right"
						onPointerDown={startResize}
						onKeyDown={handleResizeHandleKeyDown}
					/>
					<Suspense fallback={null}>
						<section className="min-h-0 flex-[1.2] overflow-hidden">
							<CalendarWidget userId={userId} isOpen onClose={() => {}} />
						</section>

						<section className="min-h-0 flex-[0.85] overflow-hidden border-t border-border/50 pt-2">
							<ChatPanel
								roomId={currentRoomId}
								userId={userId}
								userName={userName}
								userColor={userColor}
								isOpen
								onClose={() => {}}
								agentSuggestions={agent.suggestions}
								agentMessages={agent.messages}
								agentStatus={agent.agentStatus}
								onApproveSuggestion={agent.approveSuggestion}
								onDismissSuggestion={agent.dismissSuggestion}
							/>
						</section>

						<section className="mt-auto basis-[214px] flex-none overflow-hidden border-t border-border/50 pt-2">
							<MusicPlayer
								roomId={currentRoomId}
								userId={userId}
								userName={userName}
								isOpen
								onClose={() => {}}
							/>
						</section>
					</Suspense>
				</aside>
			</div>
		</div>
	)
}

function ResizeHandle({
	side,
	onPointerDown,
	onKeyDown,
}: {
	side: ResizingSide
	onPointerDown: (side: ResizingSide, event: ReactPointerEvent<HTMLDivElement>) => void
	onKeyDown: (side: ResizingSide, event: ReactKeyboardEvent<HTMLDivElement>) => void
}) {
	const isLeftHandle = side === 'left'

	return (
		<div
			role="separator"
			tabIndex={0}
			aria-orientation="vertical"
			aria-label={isLeftHandle ? 'Resize left sidebar' : 'Resize right panel'}
			className={`group absolute inset-y-0 z-20 hidden w-4 cursor-col-resize touch-none items-center justify-center outline-none xl:flex ${
				isLeftHandle ? '-right-2' : '-left-2'
			}`}
			onPointerDown={(event) => onPointerDown(side, event)}
			onKeyDown={(event) => onKeyDown(side, event)}
		>
			<span className="h-full w-px rounded-full bg-border/70 transition-colors group-hover:bg-foreground/20 group-focus-visible:bg-foreground/30" />
		</div>
	)
}
