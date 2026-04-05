import { useSync } from '@tldraw/sync'
import {
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
	ReactNode,
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { useParams } from 'react-router-dom'
import {
	Editor,
	TLShape,
	Tldraw,
	createShapeId,
	defaultShapeUtils,
	renderPlaintextFromRichText,
	toRichText,
	useValue,
} from 'tldraw'
import { getBookmarkPreview } from '../getBookmarkPreview'
import { multiplayerAssetStore } from '../multiplayerAssetStore'
import { Sidebar } from '../components/Sidebar'
import { TldrawContextualToolbar } from '../components/TldrawContextualToolbar'
import { getModelConfig } from '../components/ModelSettings'
import { getLocalStorageItem, setLocalStorageItem } from '../localStorage'
import { ReactionStampShapeUtil } from '../tldraw/ReactionStampShapeUtil'
import { StampTool } from '../tldraw/StampTool'
import { getWsUrl } from '../utils/network'
import { getUserColor } from '../utils/supabase'
import { getTldrawAssetUrls } from '../utils/tldrawAssets'
import { useAgentSync, type AgentSuggestion } from '../hooks/useAgentSync'
import { useBoardConcierge } from '../hooks/useBoardConcierge'
import { useImageGeneration } from '../hooks/useImageGeneration'
import { useVideoGeneration } from '../hooks/useVideoGeneration'

type PageId = ReturnType<Editor['getCurrentPageId']>
type ResizingSide = 'left' | 'right'
type AutoImageSource = 'audio' | 'text'

const DESKTOP_LAYOUT_QUERY = '(min-width: 1280px)'
const LEFT_PANEL_WIDTH_KEY = 'room-left-panel-width'
const RIGHT_PANEL_WIDTH_KEY = 'room-right-panel-width'
const DEFAULT_LEFT_PANEL_WIDTH = 360
const DEFAULT_RIGHT_PANEL_WIDTH = 340
const LEFT_PANEL_MIN_WIDTH = 300
const LEFT_PANEL_MAX_WIDTH = 500
const RIGHT_PANEL_MIN_WIDTH = 280
const RIGHT_PANEL_MAX_WIDTH = 520
const ROOM_MIN_CENTER_WIDTH = 560
const PANEL_KEYBOARD_STEP = 24
const AUTO_IMAGE_MODE_KEY = 'hacknu-auto-image-mode'

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

function getShapePlainText(editor: Editor, shape: TLShape) {
	const props = (shape as TLShape & { props?: Record<string, unknown> }).props ?? {}

	if (props.richText) {
		try {
			return renderPlaintextFromRichText(
				editor,
				props.richText as { attrs?: unknown; content: unknown[]; type: string }
			).trim()
		} catch {
			return ''
		}
	}

	if (typeof props.text === 'string') {
		return props.text.trim()
	}

	return ''
}

function buildBoardContext(editor: Editor | null) {
	if (!editor) return ''

	const currentPageId = editor.getCurrentPageId()
	const currentPage = editor.getPages().find((page) => page.id === currentPageId)
	const lines = Array.from(editor.getCurrentPageShapeIds())
		.map((shapeId) => editor.getShape(shapeId))
		.filter((shape): shape is NonNullable<ReturnType<Editor['getShape']>> => Boolean(shape))
		.map((shape) => ({
			text: getShapePlainText(editor, shape),
			bounds: editor.getShapePageBounds(shape),
		}))
		.filter(
			(
				entry
			): entry is {
				text: string
				bounds: NonNullable<ReturnType<Editor['getShapePageBounds']>>
			} => Boolean(entry.text) && Boolean(entry.bounds)
		)
		.sort((a, b) => {
			return a.bounds.y === b.bounds.y ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y
		})
		.slice(0, 18)
		.map((entry, index) => `${index + 1}. ${entry.text}`)

	if (lines.length === 0) {
		return currentPage?.name ? `Current page: ${currentPage.name}` : ''
	}

	const pageLabel = currentPage?.name ? `Current page: ${currentPage.name}` : 'Current page'
	return `${pageLabel}\n${lines.join('\n')}`.slice(0, 2600)
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

function createCanvasImageShape(
	parentId: ReturnType<Editor['getCurrentPageId']>,
	imageUrl: string,
	x: number,
	y: number,
	w: number,
	h: number,
	altText: string
) {
	return {
		id: createShapeId(),
		type: 'image',
		parentId,
		x,
		y,
		rotation: 0,
		opacity: 1,
		props: {
			w,
			h,
			playing: true,
			url: imageUrl,
			assetId: null,
			crop: null,
			flipX: false,
			flipY: false,
			altText,
		},
	}
}

function createCanvasTextShape(
	parentId: ReturnType<Editor['getCurrentPageId']>,
	x: number,
	y: number,
	text: string
) {
	return {
		id: createShapeId(),
		type: 'text',
		parentId,
		x,
		y,
		rotation: 0,
		opacity: 1,
		props: {
			autoSize: true,
			color: 'black',
			font: 'sans',
			richText: toRichText(text),
			scale: 1,
			size: 'm',
			textAlign: 'start',
			w: 320,
		},
	}
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

function normalizeAiTime(rawTime: string | null | undefined) {
	if (!rawTime) return '09:00'

	const trimmed = rawTime.trim()
	const twentyFourHourMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/)
	if (twentyFourHourMatch) {
		const hours = Number(twentyFourHourMatch[1])
		const minutes = Number(twentyFourHourMatch[2])
		if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
			return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
		}
	}

	const meridiemMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i)
	if (meridiemMatch) {
		const rawHours = Number(meridiemMatch[1])
		const minutes = Number(meridiemMatch[2] ?? '0')
		if (rawHours >= 1 && rawHours <= 12 && minutes >= 0 && minutes <= 59) {
			const normalizedHours = rawHours % 12 + (/pm/i.test(meridiemMatch[3]) ? 12 : 0)
			return `${String(normalizedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
		}
	}

	return '09:00'
}

function normalizeAiCalendarDateTime(data: Record<string, unknown>) {
	if (typeof data.start === 'string' && data.start.trim()) {
		const startDate = new Date(data.start)
		if (!Number.isNaN(startDate.getTime())) {
			return {
				event_date: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`,
				event_time: `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}:00`,
			}
		}
	}

	const rawDate = typeof data.date === 'string' ? data.date.trim() : ''
	const rawTime = typeof data.time === 'string' ? data.time.trim() : ''
	const normalizedTime = normalizeAiTime(rawTime)
	const dateMatch = rawDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)

	if (dateMatch) {
		const year = Number(dateMatch[1])
		const month = Number(dateMatch[2])
		const day = Number(dateMatch[3])
		const candidate = new Date(year, month - 1, day)
		if (
			candidate.getFullYear() === year &&
			candidate.getMonth() === month - 1 &&
			candidate.getDate() === day
		) {
			return {
				event_date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
				event_time: `${normalizedTime}:00`,
			}
		}
	}

	return null
}

function normalizeAiCalendarTag(data: Record<string, unknown>): 'deadline' | 'celebration' | 'simple' {
	if (
		data.tag === 'deadline' ||
		data.tag === 'celebration' ||
		data.tag === 'simple'
	) {
		return data.tag
	}

	const title = typeof data.title === 'string' ? data.title.toLowerCase() : ''
	const description = typeof data.description === 'string' ? data.description.toLowerCase() : ''
	const combinedText = `${title} ${description}`

	if (
		combinedText.includes('deadline') ||
		combinedText.includes('due') ||
		combinedText.includes('submission') ||
		combinedText.includes('exam')
	) {
		return 'deadline'
	}

	if (
		combinedText.includes('birthday') ||
		combinedText.includes('anniversary') ||
		combinedText.includes('celebration') ||
		combinedText.includes('party') ||
		combinedText.includes('holiday')
	) {
		return 'celebration'
	}

	return 'simple'
}

function formatKanbanDueLabel(dateKey: string) {
	const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (!match) return 'Upcoming'

	const candidate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
	if (Number.isNaN(candidate.getTime())) return 'Upcoming'

	return candidate.toLocaleDateString([], {
		month: 'short',
		day: 'numeric',
	})
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
	const canControlConciergeReviews = useValue(
		'orbit-review-owner',
		() => {
			if (!editorRef) return false

			const participantIds = new Set([
				identity.userId,
				...editorRef
					.getCollaboratorsOnCurrentPage()
					.map((user) => user.userId)
					.filter((userId): userId is string => Boolean(userId)),
			])

			return [...participantIds].sort()[0] === identity.userId
		},
		[editorRef, identity.userId]
	)
	const concierge = useBoardConcierge(editorRef, canControlConciergeReviews)
	const placeImageOnCanvas = useCallback(
		(imageUrl: string) => {
			if (!editorRef) return

			const viewportBounds = editorRef.getViewportPageBounds()
			const imageWidth = clamp(Math.round(viewportBounds.width * 0.42), 320, 760)
			const imageHeight = Math.round(imageWidth * 0.75)
			const imageShape = createCanvasImageShape(
				editorRef.getCurrentPageId(),
				imageUrl,
				Math.round(viewportBounds.center.x - imageWidth / 2),
				Math.round(viewportBounds.center.y - imageHeight / 2),
				imageWidth,
				imageHeight,
				'AI generated image'
			)

			editorRef.markHistoryStoppingPoint('placing ai image')
			editorRef.createShapes([imageShape] as never[])
			editorRef.select(imageShape.id)
		},
		[editorRef]
	)

	const placeTextOnCanvas = useCallback(
		(text: string, title?: string) => {
			if (!editorRef) return

			const trimmedText = text.trim()
			if (!trimmedText) return

			const viewportBounds = editorRef.getViewportPageBounds()
			const textShape = createCanvasTextShape(
				editorRef.getCurrentPageId(),
				Math.round(viewportBounds.center.x - 140),
				Math.round(viewportBounds.center.y - 120),
				title?.trim() ? `${title.trim()}\n\n${trimmedText}` : trimmedText
			)

			editorRef.markHistoryStoppingPoint('placing ai text')
			editorRef.createShapes([textShape] as never[])
			editorRef.select(textShape.id)
		},
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
			getBoardContext={() => buildBoardContext(editorRef)}
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
			onPlaceImageOnCanvas={placeImageOnCanvas}
			onPlaceTextOnCanvas={placeTextOnCanvas}
		>
			<div
				className="absolute inset-0"
				onContextMenuCapture={(event: ReactMouseEvent<HTMLDivElement>) => {
					if (
						!editorRef ||
						!concierge.canControlReviews ||
						(!concierge.canRecognizeSelection && !concierge.canGenerateSelection)
					) {
						return
					}
					event.preventDefault()
					event.stopPropagation()
					void concierge.runSelectionAction()
				}}
			>
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
				<BoardConciergeReviewControls
					editor={editorRef}
					pendingReview={concierge.pendingReview}
					canControlReviews={concierge.canControlReviews}
					onAcceptReview={concierge.acceptReview}
					onRejectReview={concierge.rejectReview}
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
	getBoardContext,
	activeUsers,
	pages,
	currentPageId,
	onSelectPage,
	onAddPage,
	onDeletePage,
	onPlaceImageOnCanvas,
	onPlaceTextOnCanvas,
}: {
	children: ReactNode
	roomId?: string
	userId: string
	userName: string
	userColor: string
	getBoardContext: () => string
	activeUsers: Array<{ userId: string; userName: string; color: string }>
	pages: Array<{ id: PageId; name: string }>
	currentPageId: PageId | null
	onSelectPage: (pageId: PageId) => void
	onAddPage: () => void
	onDeletePage: (pageId: PageId) => void
	onPlaceImageOnCanvas: (imageUrl: string) => void
	onPlaceTextOnCanvas: (text: string, title?: string) => void
}) {
	const currentRoomId = roomId ?? createRoomId()
	const agent = useAgentSync(currentRoomId, userId, userName)
	const { generateImage } = useImageGeneration()
	const { generateImage: generateAutoImage } = useImageGeneration()
	const { generateVideo } = useVideoGeneration()
	const [autoGenerateImages, setAutoGenerateImages] = useState(
		() => getLocalStorageItem(AUTO_IMAGE_MODE_KEY) !== 'false'
	)
	const [lastAutoImagePrompt, setLastAutoImagePrompt] = useState<string | null>(null)
	const [lastAutoImageSource, setLastAutoImageSource] = useState<AutoImageSource | null>(null)
	const autoImageQueueRef = useRef<{ prompt: string; source: AutoImageSource } | null>(null)
	const autoImageProcessingRef = useRef(false)

	const processAutoImagePrompt = useCallback(async (prompt: string, source: AutoImageSource) => {
		const trimmedPrompt = prompt.trim().replace(/\s+/g, ' ').slice(0, 900)
		if (!autoGenerateImages || trimmedPrompt.length < 8) {
			return
		}

		autoImageProcessingRef.current = true
		setLastAutoImagePrompt(trimmedPrompt)
		setLastAutoImageSource(source)

		try {
			const imageUrl = await generateAutoImage(trimmedPrompt, {
				model: getModelConfig().image,
			})

			if (imageUrl) {
				onPlaceImageOnCanvas(imageUrl)
			}
		} finally {
			autoImageProcessingRef.current = false

			const queuedPrompt = autoImageQueueRef.current
			autoImageQueueRef.current = null

			if (queuedPrompt && autoGenerateImages) {
				if (queuedPrompt.prompt !== trimmedPrompt || queuedPrompt.source !== source) {
					void processAutoImagePrompt(queuedPrompt.prompt, queuedPrompt.source)
				}
			}
		}
	}, [autoGenerateImages, generateAutoImage, onPlaceImageOnCanvas])

	const queueAutoImagePrompt = useCallback((prompt: string, source: AutoImageSource) => {
		const trimmedPrompt = prompt.trim().replace(/\s+/g, ' ').slice(0, 900)
		if (!autoGenerateImages || trimmedPrompt.length < 8) {
			return
		}

		if (autoImageProcessingRef.current) {
			autoImageQueueRef.current = { prompt: trimmedPrompt, source }
			return
		}

		void processAutoImagePrompt(trimmedPrompt, source)
	}, [autoGenerateImages, processAutoImagePrompt])

	useEffect(() => {
		const handleAgentCmd = (e: Event) => {
			const customEvent = e as CustomEvent<{ text: string }>
			if (customEvent.detail?.text) {
				agent.analyzeText(customEvent.detail.text, getBoardContext())
			}
		}
		window.addEventListener('hacknu:agent-cmd', handleAgentCmd)
		return () => window.removeEventListener('hacknu:agent-cmd', handleAgentCmd)
	}, [agent, getBoardContext])

	useEffect(() => {
		setLocalStorageItem(AUTO_IMAGE_MODE_KEY, String(autoGenerateImages))

		if (!autoGenerateImages) {
			autoImageQueueRef.current = null
		}
	}, [autoGenerateImages])
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

	const addCalendarEventFromSuggestion = useCallback(async (data: Record<string, unknown>) => {
		try {
			const normalizedDateTime = normalizeAiCalendarDateTime(data)
			if (!normalizedDateTime) {
				throw new Error('AI suggestion is missing a valid date/time payload.')
			}

			const { supabase } = await import('../utils/supabase')

			const eventData = {
				user_id: userId,
				event_date: normalizedDateTime.event_date,
				event_time: normalizedDateTime.event_time,
				title:
					typeof data.title === 'string' && data.title.trim()
						? data.title.trim()
						: 'New AI Event',
				note:
					typeof data.description === 'string'
						? data.description.trim() || null
						: null,
				tag: normalizeAiCalendarTag(data),
			}

			const { error } = await supabase
				.from('planner_events')
				.insert(eventData)
				.select('id')
				.single()
			if (error) throw new Error(error.message)

			window.dispatchEvent(new CustomEvent('hacknu:calendar-refresh'))
		} catch (err) {
			console.error('Failed to add calendar event from AI:', err)
		}
	}, [userId])

	const addKanbanTaskFromSuggestion = useCallback(async (suggestion: AgentSuggestion) => {
		const taskTitle =
			typeof suggestion.data?.taskText === 'string' && suggestion.data.taskText.trim()
				? suggestion.data.taskText.trim()
				: suggestion.title.trim()
		if (!taskTitle) return

		try {
			const { supabase } = await import('../utils/supabase')
			const { data: existingTasks } = await supabase
				.from('kanban_tasks')
				.select('id')
				.eq('room_id', currentRoomId)
				.eq('status', 'todo')

			const { error } = await supabase.from('kanban_tasks').insert({
				room_id: currentRoomId,
				title: taskTitle,
				description: suggestion.description || null,
				status: 'todo',
				priority: 'normal',
				due_label: 'Today',
				comments_count: 0,
				sort_order: Array.isArray(existingTasks) ? existingTasks.length : 0,
				created_by: userId,
				created_by_name: userName,
				created_by_color: userColor,
			})

			if (error) throw new Error(error.message)

			window.dispatchEvent(new CustomEvent('hacknu:kanban-refresh'))
		} catch (err) {
			console.error('Failed to add AI task to kanban:', err)
		}
	}, [currentRoomId, userColor, userId, userName])

	const addDeadlineTaskFromCalendarSuggestion = useCallback(async (data: Record<string, unknown>) => {
		const normalizedDateTime = normalizeAiCalendarDateTime(data)
		const taskTitle =
			typeof data.title === 'string' && data.title.trim()
				? data.title.trim()
				: 'New deadline'
		const taskDescription =
			typeof data.description === 'string' && data.description.trim()
				? data.description.trim()
				: null

		try {
			const { supabase } = await import('../utils/supabase')
			const { data: existingTasks } = await supabase
				.from('kanban_tasks')
				.select('id')
				.eq('room_id', currentRoomId)
				.eq('status', 'todo')

			const { error } = await supabase.from('kanban_tasks').insert({
				room_id: currentRoomId,
				title: taskTitle,
				description: taskDescription,
				status: 'todo',
				priority: 'high',
				due_label: normalizedDateTime ? formatKanbanDueLabel(normalizedDateTime.event_date) : 'Upcoming',
				comments_count: 0,
				sort_order: Array.isArray(existingTasks) ? existingTasks.length : 0,
				created_by: userId,
				created_by_name: userName,
				created_by_color: userColor,
			})

			if (error) throw new Error(error.message)

			window.dispatchEvent(new CustomEvent('hacknu:kanban-refresh'))
		} catch (err) {
			console.error('Failed to add AI deadline to kanban:', err)
		}
	}, [currentRoomId, userColor, userId, userName])

	const executeSuggestion = useCallback(async (suggestion: AgentSuggestion) => {
		if (suggestion.type === 'calendar' && suggestion.data) {
			const calendarPayload = {
				...suggestion.data,
				title: suggestion.title,
				description: suggestion.description,
			}
			const calendarTag = normalizeAiCalendarTag(calendarPayload)

			await addCalendarEventFromSuggestion({
				...calendarPayload,
				tag: calendarTag,
			})

			if (calendarTag === 'deadline') {
				await addDeadlineTaskFromCalendarSuggestion({
					...calendarPayload,
					tag: calendarTag,
				})
			}
			return
		}

		if (suggestion.type === 'action') {
			await addKanbanTaskFromSuggestion(suggestion)
			return
		}

		if (suggestion.type === 'image' && typeof suggestion.data?.prompt === 'string') {
			const imageUrl = await generateImage(suggestion.data.prompt)
			if (imageUrl) {
				onPlaceImageOnCanvas(imageUrl)
			}
			return
		}

		if (suggestion.type === 'video' && typeof suggestion.data?.prompt === 'string') {
			const videoUrl = await generateVideo(suggestion.data.prompt)
			if (videoUrl) {
				onPlaceTextOnCanvas(`Video ready:\n${videoUrl}`, suggestion.title)
			}
		}
	}, [
		addCalendarEventFromSuggestion,
		addDeadlineTaskFromCalendarSuggestion,
		addKanbanTaskFromSuggestion,
		generateImage,
		generateVideo,
		onPlaceImageOnCanvas,
		onPlaceTextOnCanvas,
	])

	const handleVoiceTranscript = useCallback((text: string) => {
		agent.analyzeText(text, getBoardContext())
		queueAutoImagePrompt(text, 'audio')
	}, [agent, getBoardContext, queueAutoImagePrompt])

	const handleTextImagePrompt = useCallback((text: string) => {
		queueAutoImagePrompt(text, 'text')
	}, [queueAutoImagePrompt])

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
						onVoiceTranscript={handleVoiceTranscript}
						onPlaceImageOnCanvas={onPlaceImageOnCanvas}
						autoGenerateImages={autoGenerateImages}
						onAutoGenerateImagesChange={setAutoGenerateImages}
						lastAutoImagePrompt={lastAutoImagePrompt}
						lastAutoImageSource={lastAutoImageSource}
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
							<CalendarWidget userId={userId} isOpen onClose={() => { }} />
						</section>

						<section className="min-h-0 flex-[0.85] overflow-hidden border-t border-border/50 pt-2">
							<ChatPanel
								roomId={currentRoomId}
								userId={userId}
								userName={userName}
								userColor={userColor}
								isOpen
								onClose={() => { }}
								agentSuggestions={agent.suggestions}
								agentMessages={agent.messages}
								agentStatus={agent.agentStatus}
								onApproveSuggestion={agent.approveSuggestion}
								onDismissSuggestion={agent.dismissSuggestion}
								onAddCalendarEvent={addCalendarEventFromSuggestion}
								onPlaceImageOnCanvas={onPlaceImageOnCanvas}
								onPlaceTextOnCanvas={onPlaceTextOnCanvas}
								onExecuteSuggestion={executeSuggestion}
								onSubmitTextInput={handleTextImagePrompt}
							/>
						</section>

						<section className="mt-auto basis-[214px] flex-none overflow-hidden border-t border-border/50 pt-2">
							<MusicPlayer
								roomId={currentRoomId}
								userId={userId}
								userName={userName}
								isOpen
								onClose={() => { }}
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
			className={`group absolute inset-y-0 z-20 hidden w-4 cursor-col-resize touch-none items-center justify-center outline-none xl:flex ${isLeftHandle ? '-right-2' : '-left-2'
				}`}
			onPointerDown={(event) => onPointerDown(side, event)}
			onKeyDown={(event) => onKeyDown(side, event)}
		>
			<span className="h-full w-px rounded-full bg-border/70 transition-colors group-hover:bg-foreground/20 group-focus-visible:bg-foreground/30" />
		</div>
	)
}

function BoardConciergeReviewControls({
	editor,
	pendingReview,
	canControlReviews,
	onAcceptReview,
	onRejectReview,
}: {
	editor: Editor | null
	pendingReview: ReturnType<typeof useBoardConcierge>['pendingReview']
	canControlReviews: boolean
	onAcceptReview: () => void
	onRejectReview: () => void
}) {
	if (!editor || !pendingReview || !canControlReviews) return null

	const reviewViewportPoint = useValue(
		'orbit-review-controls-point',
		() => editor.pageToViewport(pendingReview.focusPagePoint),
		[editor, pendingReview.focusPagePoint.x, pendingReview.focusPagePoint.y]
	)
	const zoomLevel = useValue('orbit-review-controls-zoom', () => editor.getZoomLevel(), [editor])
	const controlScale = Math.max(0.8, Math.min(1.08, zoomLevel))

	return (
		<div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
			<div
				className="pointer-events-auto absolute left-0 top-0"
				style={{
					transform: `translate(${reviewViewportPoint.x}px, ${reviewViewportPoint.y}px) translate(-50%, calc(-100% - 14px)) scale(${controlScale})`,
					transformOrigin: 'bottom center',
				}}
			>
				<div className="flex items-center gap-2 rounded-[18px] border border-[#d7e2ec] bg-white/96 px-2 py-2 shadow-[0_10px_28px_rgba(15,39,68,0.16)] backdrop-blur-sm">
					<button
						type="button"
						className="rounded-full bg-[#173f6a] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0f2744]"
						onClick={onAcceptReview}
					>
						Accept
					</button>
					<button
						type="button"
						className="rounded-full border border-[#c8d6e4] bg-white px-3 py-1.5 text-xs font-semibold text-[#46637f] transition hover:border-[#9fb8cf] hover:text-[#17324d]"
						onClick={onRejectReview}
					>
						Reject
					</button>
				</div>
			</div>
		</div>
	)
}
