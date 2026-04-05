import { useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import {
	BoardConciergePass,
	BoardConciergeReview,
	acceptBoardConciergeReview,
	applyBoardConciergePass,
	createBoardConciergeReview,
	getBoardConciergeFingerprint,
	hasGenerativeSelection,
	hasRecognizableSelection,
	isBoardConciergePreviewShape,
	planBoardConciergePass,
	planBoardConciergeSelectedGenerationPass,
	planBoardConciergeSelectedVisionPass,
	planBoardConciergeVisionPass,
	rejectBoardConciergeReview,
} from '../utils/boardConcierge'

type BoardConciergeStatus = 'idle' | 'patrolling' | 'working'

export interface BoardConciergeOverlayState {
	agentName: string
	status: BoardConciergeStatus
	label: string
	detail: string
	pageX: number
	pageY: number
}

export interface UseBoardConciergeResult {
	overlay: BoardConciergeOverlayState | null
	pendingReview: BoardConciergeReview | null
	acceptReview: () => void
	rejectReview: () => void
	canRecognizeSelection: boolean
	canGenerateSelection: boolean
	canControlReviews: boolean
	recognizeSelection: () => Promise<boolean>
	generateFromSelection: () => Promise<boolean>
	runSelectionAction: () => Promise<boolean>
}

const AGENT_NAME = 'Orbit'
const APPLY_DELAY_MS = 380
const FINISH_DELAY_MS = 1400
const PROACTIVE_EDIT_THRESHOLD_MS = 2600
const PATROL_INTERVAL_MS = 1500
const ACTION_INTERVAL_MS = 1800
const IDLE_LINES = [
	{
		label: 'Roaming the board',
		detail: 'I am constantly walking the canvas so I can jump in before things drift.',
	},
	{
		label: 'Reading the room',
		detail: 'I scan notes, spacing, and flow the same way a teammate would.',
	},
	{
		label: 'Checking the clusters',
		detail: 'If ideas start scattering, I move in and tighten them up on my own.',
	},
]

type PatrolStop = {
	pageX: number
	pageY: number
	label: string
	detail: string
}

function getIdlePagePoint(editor: Editor) {
	const viewport = editor.getViewportScreenBounds()
	return editor.screenToPage({
		x: Math.max(148, viewport.width - 178),
		y: 92,
	})
}

function getIdleLine(index: number) {
	return IDLE_LINES[index % IDLE_LINES.length]
}

function getPatrolStops(editor: Editor, idleIndex: number): PatrolStop[] {
	const shapeStops = Array.from(editor.getCurrentPageShapeIds())
		.slice(0, 12)
		.map((shapeId) => editor.getShape(shapeId))
		.filter((shape): shape is NonNullable<ReturnType<Editor['getShape']>> => Boolean(shape))
		.filter((shape) => !isBoardConciergePreviewShape(shape))
		.map((shape) => editor.getShapePageBounds(shape))
		.filter((bounds): bounds is NonNullable<ReturnType<Editor['getShapePageBounds']>> => Boolean(bounds))
		.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
		.slice(0, 6)
		.map((bounds, index) => {
			const line = getIdleLine(idleIndex + index)
			return {
				pageX: bounds.center.x,
				pageY: bounds.center.y,
				label: line.label,
				detail: line.detail,
			}
		})

	if (shapeStops.length > 0) {
		return shapeStops
	}

	const viewport = editor.getViewportScreenBounds()
	const fallbackStops = [
		{ x: viewport.width * 0.24, y: viewport.height * 0.24 },
		{ x: viewport.width * 0.68, y: viewport.height * 0.3 },
		{ x: viewport.width * 0.57, y: viewport.height * 0.62 },
		{ x: viewport.width * 0.3, y: viewport.height * 0.56 },
	]

	return fallbackStops.map((stop, index) => {
		const line = getIdleLine(idleIndex + index)
		const point = editor.screenToPage(stop)
		return {
			pageX: point.x,
			pageY: point.y,
			label: line.label,
			detail: line.detail,
		}
	})
}

export function useBoardConcierge(
	editor: Editor | null,
	canControlReviews: boolean
): UseBoardConciergeResult {
	const idleLineIndexRef = useRef(0)
	const patrolIndexRef = useRef(0)
	const patrolStopsRef = useRef<PatrolStop[]>([])
	const lastInteractionAtRef = useRef(Date.now())
	const lastFingerprintRef = useRef<string | null>(null)
	const rejectedFingerprintsRef = useRef<Set<string>>(new Set())
	const isWorkingRef = useRef(false)
	const pendingReviewRef = useRef<BoardConciergeReview | null>(null)
	const finishTimerRef = useRef<number | null>(null)
	const applyTimerRef = useRef<number | null>(null)
	const [overlay, setOverlay] = useState<BoardConciergeOverlayState | null>(null)
	const [pendingReview, setPendingReview] = useState<BoardConciergeReview | null>(null)

	const finishPass = () => {
		idleLineIndexRef.current += 1
		isWorkingRef.current = false
		patrolStopsRef.current = []
	}

	const startPass = (pass: BoardConciergePass) => {
		if (!editor) return
		const activeEditor = editor

		lastFingerprintRef.current = pass.fingerprint
		isWorkingRef.current = true

		setOverlay({
			agentName: AGENT_NAME,
			status: 'working',
			label: pass.label,
			detail: pass.detail,
			pageX: pass.focusPagePoint.x,
			pageY: pass.focusPagePoint.y,
		})

		applyTimerRef.current = window.setTimeout(() => {
			if (pass.requiresReview) {
				if (!canControlReviews) {
					lastFingerprintRef.current = pass.fingerprint
					isWorkingRef.current = false
					return
				}

				const review = createBoardConciergeReview(activeEditor, pass)
				if (review) {
					pendingReviewRef.current = review
					setPendingReview(review)
				}
				isWorkingRef.current = false
				return
			}

			applyBoardConciergePass(activeEditor, pass)
			finishTimerRef.current = window.setTimeout(() => {
				finishPass()
				const stops = getPatrolStops(activeEditor, idleLineIndexRef.current)
				patrolStopsRef.current = stops
				const stop = stops[0]
				if (!stop) return
				setOverlay({
					agentName: AGENT_NAME,
					status: 'patrolling',
					label: stop.label,
					detail: stop.detail,
					pageX: stop.pageX,
					pageY: stop.pageY,
				})
			}, FINISH_DELAY_MS)
		}, APPLY_DELAY_MS)
	}

	const clearPendingReview = () => {
		pendingReviewRef.current = null
		setPendingReview(null)
	}

	const acceptReview = () => {
		if (!editor || !pendingReviewRef.current) return
		acceptBoardConciergeReview(editor, pendingReviewRef.current)
		clearPendingReview()
		lastInteractionAtRef.current = Date.now()
		idleLineIndexRef.current += 1
		patrolStopsRef.current = []
		isWorkingRef.current = false
	}

	const rejectReview = () => {
		if (!editor || !pendingReviewRef.current) return
		rejectedFingerprintsRef.current.add(pendingReviewRef.current.fingerprint)
		rejectBoardConciergeReview(editor, pendingReviewRef.current)
		clearPendingReview()
		lastInteractionAtRef.current = Date.now()
		patrolStopsRef.current = []
		isWorkingRef.current = false
	}

	const canRecognizeSelection = editor
		? canControlReviews && hasRecognizableSelection(editor)
		: false
	const canGenerateSelection = editor
		? canControlReviews && hasGenerativeSelection(editor)
		: false

	const recognizeSelection = async () => {
		if (!editor) return false
		if (!canControlReviews) return false
		if (!hasRecognizableSelection(editor)) return false
		if (isWorkingRef.current || pendingReviewRef.current) return false
		if (editor.getEditingShapeId()) return false

		lastInteractionAtRef.current = Date.now()
		isWorkingRef.current = true

		const selectionCenter =
			editor
				.getSelectedShapeIds()
				.map((shapeId) => editor.getShapePageBounds(shapeId))
				.find(Boolean)?.center ?? getIdlePagePoint(editor)

		setOverlay({
			agentName: AGENT_NAME,
			status: 'working',
			label: 'Recognizing selection',
			detail: 'I am reading the selected drawing so I can turn the whole thing into typed text.',
			pageX: selectionCenter.x,
			pageY: selectionCenter.y,
		})

		const pass = await planBoardConciergeSelectedVisionPass(editor)
		if (!pass) {
			isWorkingRef.current = false
			return false
		}

		startPass(pass)
		return true
	}

	const generateFromSelection = async () => {
		if (!editor) return false
		if (!canControlReviews) return false
		if (!hasGenerativeSelection(editor)) return false
		if (isWorkingRef.current || pendingReviewRef.current) return false
		if (editor.getEditingShapeId()) return false

		lastInteractionAtRef.current = Date.now()
		isWorkingRef.current = true

		const selectionCenter =
			editor
				.getSelectedShapeIds()
				.map((shapeId) => editor.getShapePageBounds(shapeId))
				.find(Boolean)?.center ?? getIdlePagePoint(editor)

		setOverlay({
			agentName: AGENT_NAME,
			status: 'working',
			label: 'Generating content',
			detail: 'I am using the selected prompt to generate board-ready diagrams or text blocks.',
			pageX: selectionCenter.x,
			pageY: selectionCenter.y,
		})

		const pass = await planBoardConciergeSelectedGenerationPass(editor)
		if (!pass) {
			isWorkingRef.current = false
			return false
		}

		startPass(pass)
		return true
	}

	const runSelectionAction = async () => {
		if (canGenerateSelection) {
			return generateFromSelection()
		}

		if (canRecognizeSelection) {
			return recognizeSelection()
		}

		return false
	}

	useEffect(() => {
		const markInteraction = () => {
			lastInteractionAtRef.current = Date.now()
		}

		window.addEventListener('pointerdown', markInteraction, true)
		window.addEventListener('wheel', markInteraction, true)
		window.addEventListener('keydown', markInteraction, true)

		return () => {
			window.removeEventListener('pointerdown', markInteraction, true)
			window.removeEventListener('wheel', markInteraction, true)
			window.removeEventListener('keydown', markInteraction, true)
		}
	}, [])

	useEffect(() => {
		if (!editor) {
			setOverlay(null)
			clearPendingReview()
			return
		}

		let isDisposed = false

		const syncIdleOverlay = () => {
			if (isWorkingRef.current || pendingReviewRef.current) return
			const copy = getIdleLine(idleLineIndexRef.current)
			const idlePoint = getIdlePagePoint(editor)
			setOverlay({
				agentName: AGENT_NAME,
				status: 'idle',
				label: copy.label,
				detail: copy.detail,
				pageX: idlePoint.x,
				pageY: idlePoint.y,
			})
		}

		const syncPatrolOverlay = () => {
			if (isWorkingRef.current || pendingReviewRef.current) return

			if (patrolStopsRef.current.length === 0 || patrolIndexRef.current >= patrolStopsRef.current.length) {
				patrolStopsRef.current = getPatrolStops(editor, idleLineIndexRef.current)
				patrolIndexRef.current = 0
			}

			const stop = patrolStopsRef.current[patrolIndexRef.current]
			patrolIndexRef.current = (patrolIndexRef.current + 1) % patrolStopsRef.current.length

			setOverlay({
				agentName: AGENT_NAME,
				status: 'patrolling',
				label: stop.label,
				detail: stop.detail,
				pageX: stop.pageX,
				pageY: stop.pageY,
			})
		}

		syncIdleOverlay()

		const handleResize = () => {
			patrolStopsRef.current = []
			syncIdleOverlay()
		}

		const patrolIntervalId = window.setInterval(() => {
			if (isWorkingRef.current || pendingReviewRef.current) return
			if (Date.now() - lastInteractionAtRef.current < 700) {
				syncIdleOverlay()
				return
			}
			syncPatrolOverlay()
		}, PATROL_INTERVAL_MS)

		const actionIntervalId = window.setInterval(async () => {
			if (isWorkingRef.current || pendingReviewRef.current) return
			if (editor.getEditingShapeId()) return
			if (Date.now() - lastInteractionAtRef.current < PROACTIVE_EDIT_THRESHOLD_MS) return

			const fingerprint = getBoardConciergeFingerprint(editor)
			if (fingerprint === lastFingerprintRef.current) return
			if (rejectedFingerprintsRef.current.has(fingerprint)) return

			const pass = planBoardConciergePass(editor)
			isWorkingRef.current = true
			if (pass) {
				startPass(pass)
				return
			}

			setOverlay({
				agentName: AGENT_NAME,
				status: 'working',
				label: 'Reading handwriting',
				detail: 'I am checking whether the drawn labels should become clean typed text.',
				pageX: getIdlePagePoint(editor).x,
				pageY: getIdlePagePoint(editor).y,
			})

			const visionPass = await planBoardConciergeVisionPass(editor, fingerprint)
			if (isDisposed) return

			if (!visionPass) {
				lastFingerprintRef.current = fingerprint
				finishPass()
				syncPatrolOverlay()
				return
			}

			startPass(visionPass)
		}, ACTION_INTERVAL_MS)

		window.addEventListener('resize', handleResize)

		return () => {
			isDisposed = true
			window.clearInterval(patrolIntervalId)
			window.clearInterval(actionIntervalId)
			window.removeEventListener('resize', handleResize)

			if (applyTimerRef.current !== null) {
				window.clearTimeout(applyTimerRef.current)
				applyTimerRef.current = null
			}

			if (finishTimerRef.current !== null) {
				window.clearTimeout(finishTimerRef.current)
				finishTimerRef.current = null
			}

			if (pendingReviewRef.current) {
				rejectBoardConciergeReview(editor, pendingReviewRef.current)
				clearPendingReview()
			}

			isWorkingRef.current = false
			patrolStopsRef.current = []
		}
	}, [editor])

	return {
		overlay,
		pendingReview,
		acceptReview,
		rejectReview,
		canRecognizeSelection,
		canGenerateSelection,
		canControlReviews,
		recognizeSelection,
		generateFromSelection,
		runSelectionAction,
	}
}
