import {
	Editor,
	TLShape,
	TLShapeId,
	createShapeId,
	isPageId,
	renderPlaintextFromRichText,
	toRichText,
} from 'tldraw'
import { generateBoardImage } from './boardGeneration'
import { recognizeHandwriting } from './handwritingRecognition'

type PagePoint = {
	x: number
	y: number
}

type BoundsLike = {
	x: number
	y: number
	w: number
	h: number
	center: PagePoint
}

type ShapeSnapshot = {
	shape: TLShape
	bounds: ReturnType<Editor['getShapePageBounds']> extends infer T ? Exclude<T, undefined> : never
	plainText: string
	isTextCarrier: boolean
	isMovable: boolean
}

type NumericSnapshot = {
	snapshot: ShapeSnapshot
	value: number
}

export interface BoardConciergePass {
	fingerprint: string
	label: string
	detail: string
	focusPagePoint: PagePoint
	updates: Array<Record<string, unknown>>
	creates: Array<Record<string, unknown>>
	deleteShapeIds: TLShapeId[]
	requiresReview: boolean
}

export interface BoardConciergeReview {
	fingerprint: string
	label: string
	detail: string
	focusPagePoint: PagePoint
	previewShapeIds: TLShapeId[]
	finalCreates: Array<Record<string, unknown>>
	deleteShapeIds: TLShapeId[]
	restoreShapeOpacities: Array<{
		id: TLShapeId
		type: TLShape['type']
		opacity: number
	}>
}

const STYLABLE_SHAPE_TYPES = new Set(['geo', 'note', 'text'])
const ORGANIZABLE_SHAPE_TYPES = new Set(['geo', 'note', 'text', 'image', 'video', 'bookmark'])
const COMMON_CORRECTIONS: Array<[RegExp, string]> = [
	[/\borginized\b/gi, 'organized'],
	[/\bcousor\b/gi, 'cursor'],
	[/\bteh\b/gi, 'the'],
	[/\brecieve\b/gi, 'receive'],
	[/\bseperate\b/gi, 'separate'],
	[/\bdefinately\b/gi, 'definitely'],
	[/\bwich\b/gi, 'which'],
	[/\bwierd\b/gi, 'weird'],
	[/\bthier\b/gi, 'their'],
	[/\bdont\b/gi, "don't"],
	[/\bcant\b/gi, "can't"],
]

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

function round(value: number) {
	return Math.round(value)
}

function average(values: number[]) {
	if (values.length === 0) return 0
	return values.reduce((total, value) => total + value, 0) / values.length
}

function median(values: number[]) {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function normalizeGuidePositions(rawPositions: number[], gap: number, anchor?: number) {
	if (rawPositions.length === 0) return []

	const guides: number[] = []
	guides[0] = anchor ?? rawPositions[0]

	for (let index = 1; index < rawPositions.length; index += 1) {
		guides[index] = Math.max(rawPositions[index], guides[index - 1] + gap)
	}

	return guides
}

function findBestSlotOffset(values: number[], slots: number[]) {
	if (values.length === 0 || values.length >= slots.length) return 0

	let bestOffset = 0
	let bestScore = Number.POSITIVE_INFINITY

	for (let offset = 0; offset <= slots.length - values.length; offset += 1) {
		const score = values.reduce(
			(total, value, index) => total + Math.abs(value - slots[offset + index]),
			0
		)

		if (score < bestScore) {
			bestScore = score
			bestOffset = offset
		}
	}

	return bestOffset
}

export function isBoardConciergePreviewShape(shape: TLShape) {
	const meta = (shape as TLShape & { meta?: Record<string, unknown> }).meta ?? {}
	return meta.orbitPreview === true
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

function normalizeLine(line: string) {
	let next = line.replace(/[ \t]+/g, ' ').trim()
	if (!next) return next
	if (next.includes('://') || next.includes('@')) return next

	for (const [pattern, replacement] of COMMON_CORRECTIONS) {
		next = next.replace(pattern, replacement)
	}

	next = next
		.replace(/(^|\s)i(?=\s|$)/g, '$1I')
		.replace(/\s+([,.;!?])/g, '$1')
		.replace(/([!?.,]){2,}/g, '$1')

	if (/^[a-z]/.test(next)) {
		next = next[0].toUpperCase() + next.slice(1)
	}

	const wordCount = next.split(/\s+/).filter(Boolean).length
	if (
		wordCount >= 6 &&
		!/[.!?]$/.test(next) &&
		!/[:;,-]$/.test(next)
	) {
		next = `${next}.`
	}

	return next
}

function normalizeText(text: string) {
	return text
		.split(/\r?\n/)
		.map((line) => {
			const bulletMatch = line.match(/^(\s*[-*•]\s+)(.*)$/)
			if (!bulletMatch) return normalizeLine(line)
			return `${bulletMatch[1]}${normalizeLine(bulletMatch[2])}`
		})
		.join('\n')
		.trim()
}

function normalizeComparableText(text: string) {
	return text
		.toLowerCase()
		.replace(/[\s\p{P}\p{S}]+/gu, ' ')
		.trim()
}

function extractStructuredListItems(text: string) {
	const bulletItems = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.map((line) => line.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
		.filter(Boolean)

	if (
		bulletItems.length >= 3 &&
		bulletItems.length <= 6 &&
		text.split(/\r?\n/).some((line) => /^(\s*[-*•]\s+|\s*\d+[.)]\s+)/.test(line))
	) {
		return bulletItems
	}

	if (!/[;,]/.test(text)) return null

	const inlineItems = text
		.split(/[;,]/)
		.map((item) => item.trim())
		.filter(Boolean)

	if (inlineItems.length < 3 || inlineItems.length > 6) return null
	if (inlineItems.some((item) => item.length > 52)) return null

	return inlineItems
}

function collectSnapshots(editor: Editor) {
	const snapshots: ShapeSnapshot[] = []

	for (const shapeId of editor.getCurrentPageShapeIds()) {
		const shape = editor.getShape(shapeId)
		if (!shape) continue
		if (isBoardConciergePreviewShape(shape)) continue

		const bounds = editor.getShapePageBounds(shape)
		if (!bounds) continue

		const plainText = getShapePlainText(editor, shape)
		const isTextCarrier = plainText.length > 0
		const isMovable =
			ORGANIZABLE_SHAPE_TYPES.has(shape.type) &&
			isPageId(shape.parentId) &&
			!(shape as TLShape & { isLocked?: boolean }).isLocked &&
			Math.abs((shape as TLShape & { rotation?: number }).rotation ?? 0) < 0.001

		snapshots.push({
			shape,
			bounds,
			plainText,
			isTextCarrier,
			isMovable,
		})
	}

	return snapshots
}

function fingerprintBoard(snapshots: ShapeSnapshot[]) {
	return snapshots
		.map(({ shape, bounds, plainText }) => {
			const props = (shape as TLShape & { props?: Record<string, unknown> }).props ?? {}
			return [
				shape.id,
				shape.type,
				round(bounds.x),
				round(bounds.y),
				round(bounds.w),
				round(bounds.h),
				plainText.slice(0, 80),
				props.color ?? '',
				props.fill ?? '',
				props.font ?? '',
			].join(':')
		})
		.join('|')
}

function createRichTextUpdate(shape: TLShape, nextText: string) {
	return {
		id: shape.id,
		type: shape.type,
		props: {
			richText: toRichText(nextText),
		},
	}
}

function getNumericLabelValue(text: string) {
	if (!/^-?\d+$/.test(text.trim())) return null
	return Number.parseInt(text.trim(), 10)
}

function createShapeFromTemplate(shape: TLShape, nextText: string, x: number, y: number) {
	const props = { ...((shape as TLShape & { props?: Record<string, unknown> }).props ?? {}) }

	if ('richText' in props || shape.type === 'geo' || shape.type === 'note' || shape.type === 'text') {
		props.richText = toRichText(nextText)
	}

	if (typeof props.text === 'string') {
		props.text = nextText
	}

	return {
		type: shape.type,
		parentId: shape.parentId,
		x: round(x),
		y: round(y),
		rotation: (shape as TLShape & { rotation?: number }).rotation ?? 0,
		opacity: (shape as TLShape & { opacity?: number }).opacity ?? 1,
		props,
	}
}

function createTextShapeFromBounds(shape: TLShape, nextText: string, bounds: BoundsLike) {
	const estimatedWidth = clamp(Math.max(bounds.w + 12, nextText.length * 26), 36, 220)
	const estimatedHeight = clamp(bounds.h, 28, 120)

	return {
		type: 'text',
		parentId: shape.parentId,
		x: round(bounds.center.x - estimatedWidth / 2),
		y: round(bounds.center.y - estimatedHeight / 2),
		rotation: 0,
		opacity: 1,
		props: {
			autoSize: true,
			color: 'black',
			font: 'sans',
			richText: toRichText(nextText),
			scale: 1,
			size: bounds.h >= 72 ? 'xl' : bounds.h >= 46 ? 'l' : 'm',
			textAlign: 'middle',
			w: estimatedWidth,
		},
	}
}

function createImageShapeFromUrl(
	parentId: TLShape['parentId'],
	url: string,
	x: number,
	y: number,
	w: number,
	h: number,
	altText: string
) {
	return {
		type: 'image',
		parentId,
		x: round(x),
		y: round(y),
		rotation: 0,
		opacity: 1,
		props: {
			w,
			h,
			playing: true,
			url,
			assetId: null,
			crop: null,
			flipX: false,
			flipY: false,
			altText,
		},
	}
}

function createTextShapeFromPrompt(
	parentId: TLShape['parentId'],
	x: number,
	y: number,
	text: string
) {
	return {
		type: 'text',
		parentId,
		x: round(x),
		y: round(y),
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

function mergeSnapshotBounds(snapshots: ShapeSnapshot[]) {
	const minX = Math.min(...snapshots.map((snapshot) => snapshot.bounds.x))
	const minY = Math.min(...snapshots.map((snapshot) => snapshot.bounds.y))
	const maxX = Math.max(...snapshots.map((snapshot) => snapshot.bounds.x + snapshot.bounds.w))
	const maxY = Math.max(...snapshots.map((snapshot) => snapshot.bounds.y + snapshot.bounds.h))
	const w = maxX - minX
	const h = maxY - minY

	return {
		x: minX,
		y: minY,
		w,
		h,
		center: {
			x: minX + w / 2,
			y: minY + h / 2,
		},
	}
}

function getCenterDistance(a: ShapeSnapshot, b: ShapeSnapshot) {
	return Math.hypot(a.bounds.center.x - b.bounds.center.x, a.bounds.center.y - b.bounds.center.y)
}

function overlapsEnough(a: ShapeSnapshot, b: ShapeSnapshot) {
	const overlapX =
		Math.min(a.bounds.x + a.bounds.w, b.bounds.x + b.bounds.w) - Math.max(a.bounds.x, b.bounds.x)
	const overlapY =
		Math.min(a.bounds.y + a.bounds.h, b.bounds.y + b.bounds.h) - Math.max(a.bounds.y, b.bounds.y)

	if (overlapX <= 0 || overlapY <= 0) return false

	const overlapArea = overlapX * overlapY
	const smallerArea = Math.min(a.bounds.w * a.bounds.h, b.bounds.w * b.bounds.h)
	return overlapArea / Math.max(1, smallerArea) >= 0.16
}

function clusterByAxis(
	snapshots: ShapeSnapshot[],
	axis: 'horizontal' | 'vertical'
) {
	const sorted = [...snapshots].sort((a, b) =>
		axis === 'horizontal'
			? a.bounds.center.y === b.bounds.center.y
				? a.bounds.center.x - b.bounds.center.x
				: a.bounds.center.y - b.bounds.center.y
			: a.bounds.center.x === b.bounds.center.x
				? a.bounds.center.y - b.bounds.center.y
				: a.bounds.center.x - b.bounds.center.x
	)

	const clusters: ShapeSnapshot[][] = []
	const threshold = axis === 'horizontal' ? 90 : 110

	for (const snapshot of sorted) {
		const value = axis === 'horizontal' ? snapshot.bounds.center.y : snapshot.bounds.center.x
		const cluster = clusters[clusters.length - 1]
		if (!cluster) {
			clusters.push([snapshot])
			continue
		}

		const anchor =
			cluster.reduce(
				(total, item) =>
					total + (axis === 'horizontal' ? item.bounds.center.y : item.bounds.center.x),
				0
			) / cluster.length

		if (Math.abs(value - anchor) <= threshold) {
			cluster.push(snapshot)
		} else {
			clusters.push([snapshot])
		}
	}

	return clusters
}

function collectNumericSnapshots(snapshots: ShapeSnapshot[]) {
	return snapshots
		.filter((snapshot) => snapshot.isTextCarrier)
		.map((snapshot) => ({
			snapshot,
			value: getNumericLabelValue(snapshot.plainText),
		}))
		.filter((item): item is NumericSnapshot => item.value !== null)
}

function getStraightLineGapPlacement(start: ShapeSnapshot, end: ShapeSnapshot) {
	const deltaCenterX = end.bounds.center.x - start.bounds.center.x
	const deltaCenterY = end.bounds.center.y - start.bounds.center.y
	const horizontal = Math.abs(deltaCenterX) >= Math.abs(deltaCenterY)
	const primaryDistance = horizontal ? Math.abs(deltaCenterX) : Math.abs(deltaCenterY)
	const crossDistance = horizontal ? Math.abs(deltaCenterY) : Math.abs(deltaCenterX)

	if (primaryDistance < 90) return null
	if (crossDistance > clamp(primaryDistance * 0.24, 44, 120)) return null

	return {
		score: crossDistance,
		targetsForGap(totalGap: number) {
			return Array.from({ length: totalGap - 1 }, (_, index) => {
				const ratio = (index + 1) / totalGap
				const targetX = start.bounds.x + (end.bounds.x - start.bounds.x) * ratio
				const targetY = start.bounds.y + (end.bounds.y - start.bounds.y) * ratio
				return {
					x: targetX,
					y: targetY,
					center: {
						x: start.bounds.center.x + deltaCenterX * ratio,
						y: start.bounds.center.y + deltaCenterY * ratio,
					},
				}
			})
		},
	}
}

function getBoundsBottom(snapshot: ShapeSnapshot) {
	return snapshot.bounds.y + snapshot.bounds.h
}

function findAnchorValueBelow(drawSnapshot: ShapeSnapshot, numericSnapshots: NumericSnapshot[]) {
	const candidates = numericSnapshots
		.filter(({ snapshot }) => snapshot.shape.id !== drawSnapshot.shape.id)
		.map(({ snapshot, value }) => {
			const horizontalDelta = Math.abs(snapshot.bounds.center.x - drawSnapshot.bounds.center.x)
			const verticalGap = snapshot.bounds.y - getBoundsBottom(drawSnapshot)
			return {
				snapshot,
				value,
				horizontalDelta,
				verticalGap,
				score: horizontalDelta + Math.abs(verticalGap) * 0.2,
			}
		})
		.filter(
			(candidate) =>
				candidate.verticalGap >= 18 &&
				candidate.verticalGap <= 320 &&
				candidate.horizontalDelta <=
					Math.max(84, drawSnapshot.bounds.w * 0.95, candidate.snapshot.bounds.w * 0.55)
		)
		.sort((a, b) => a.score - b.score)

	return candidates[0] ?? null
}

function inferValuesForDrawRow(drawRow: ShapeSnapshot[], numericSnapshots: NumericSnapshot[]) {
	const anchors = drawRow
		.map((snapshot, index) => {
			const anchor = findAnchorValueBelow(snapshot, numericSnapshots)
			return anchor ? { index, value: anchor.value } : null
		})
		.filter((anchor): anchor is { index: number; value: number } => anchor !== null)

	if (drawRow.length === 1 && anchors.length === 1) {
		return [anchors[0].value]
	}

	if (anchors.length < 2) return null

	const baseCounts = new Map<number, number>()
	for (const anchor of anchors) {
		const base = anchor.value - anchor.index
		baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1)
	}

	let bestBase: number | null = null
	let bestCount = 0

	for (const [base, count] of baseCounts) {
		if (count > bestCount) {
			bestBase = base
			bestCount = count
		}
	}

	if (bestBase === null || bestCount < 2) return null

	const inferred = drawRow.map((_, index) => bestBase + index)
	const isConsistent = anchors.every((anchor) => inferred[anchor.index] === anchor.value)
	if (!isConsistent) return null

	return inferred
}

function hasTypedValueNearDraw(
	drawSnapshot: ShapeSnapshot,
	value: number,
	snapshots: ShapeSnapshot[]
) {
	return snapshots.some((snapshot) => {
		if (snapshot.shape.type !== 'text') return false
		if (getNumericLabelValue(snapshot.plainText) !== value) return false

		return (
			Math.abs(snapshot.bounds.center.x - drawSnapshot.bounds.center.x) <= 48 &&
			Math.abs(snapshot.bounds.center.y - drawSnapshot.bounds.center.y) <= 42
		)
	})
}

function planHandwritingNormalizationPass(
	snapshots: ShapeSnapshot[],
	fingerprint: string
): BoardConciergePass | null {
	const numericSnapshots = collectNumericSnapshots(snapshots)
	if (numericSnapshots.length === 0) return null

	const drawSnapshots = snapshots
		.filter((snapshot) => snapshot.shape.type === 'draw')
		.filter((snapshot) => isPageId(snapshot.shape.parentId))
		.filter((snapshot) => snapshot.bounds.w >= 16 && snapshot.bounds.h >= 20)

	if (drawSnapshots.length === 0) return null

	const drawRows = clusterByAxis(drawSnapshots, 'horizontal')
		.map((row) => [...row].sort((a, b) => a.bounds.center.x - b.bounds.center.x))
		.sort(
			(a, b) =>
				average(a.map((snapshot) => snapshot.bounds.center.y)) -
				average(b.map((snapshot) => snapshot.bounds.center.y))
		)

	const creates: Array<Record<string, unknown>> = []
	const deleteShapeIds: TLShapeId[] = []
	const focusTargets: PagePoint[] = []

	for (const row of drawRows) {
		const inferredValues = inferValuesForDrawRow(row, numericSnapshots)
		if (!inferredValues) continue

		for (let index = 0; index < row.length; index += 1) {
			const drawSnapshot = row[index]
			const inferredValue = inferredValues[index]
			if (!Number.isFinite(inferredValue)) continue
			if (hasTypedValueNearDraw(drawSnapshot, inferredValue, snapshots)) continue

			creates.push(
				createTextShapeFromBounds(drawSnapshot.shape, String(inferredValue), drawSnapshot.bounds)
			)
			deleteShapeIds.push(drawSnapshot.shape.id)
			focusTargets.push(drawSnapshot.bounds.center)
		}
	}

	if (creates.length === 0 || deleteShapeIds.length === 0) return null

	return {
		fingerprint,
		label: 'Converting handwriting',
		detail: 'I found handwritten number marks and I am previewing clean typed text directly on the canvas.',
		focusPagePoint: focusTargets[0] ?? drawRows[0]?.[0]?.bounds.center ?? { x: 0, y: 0 },
		updates: [],
		creates: creates.slice(0, 6),
		deleteShapeIds: deleteShapeIds.slice(0, 6),
		requiresReview: true,
	}
}

function planEmptyCleanupPass(snapshots: ShapeSnapshot[], fingerprint: string): BoardConciergePass | null {
	const emptyShapes = snapshots
		.filter((snapshot) => snapshot.shape.type === 'note' || snapshot.shape.type === 'text')
		.filter((snapshot) => snapshot.plainText.length === 0)
		.filter((snapshot) => snapshot.bounds.w <= 280 && snapshot.bounds.h <= 280)

	if (emptyShapes.length === 0) return null

	return {
		fingerprint,
		label: 'Cleaning empty notes',
		detail: 'I found blank notes with no content and I am asking before clearing them away.',
		focusPagePoint: emptyShapes[0].bounds.center,
		updates: [],
		creates: [],
		deleteShapeIds: emptyShapes.slice(0, 4).map((snapshot) => snapshot.shape.id),
		requiresReview: true,
	}
}

function planDuplicateCleanupPass(
	snapshots: ShapeSnapshot[],
	fingerprint: string
): BoardConciergePass | null {
	const candidates = snapshots
		.filter((snapshot) => snapshot.isTextCarrier)
		.filter((snapshot) => snapshot.plainText.length >= 2 && snapshot.plainText.length <= 80)
		.filter((snapshot) => snapshot.shape.type === 'note' || snapshot.shape.type === 'text')
		.map((snapshot) => ({
			snapshot,
			key: normalizeComparableText(snapshot.plainText),
		}))
		.filter((item) => item.key.length >= 2)

	const duplicates: ShapeSnapshot[] = []
	const grouped = new Map<string, ShapeSnapshot[]>()

	for (const item of candidates) {
		const group = grouped.get(item.key) ?? []
		group.push(item.snapshot)
		grouped.set(item.key, group)
	}

	for (const group of grouped.values()) {
		if (group.length < 2) continue

		const ordered = [...group].sort((a, b) =>
			a.bounds.y === b.bounds.y ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y
		)
		const keeper = ordered[0]

		for (let index = 1; index < ordered.length; index += 1) {
			const candidate = ordered[index]
			if (
				overlapsEnough(keeper, candidate) ||
				getCenterDistance(keeper, candidate) <=
					Math.max(180, Math.max(keeper.bounds.w, candidate.bounds.w) * 1.45)
			) {
				duplicates.push(candidate)
			}
		}
	}

	if (duplicates.length === 0) return null

	return {
		fingerprint,
		label: 'Removing duplicates',
		detail: 'I spotted repeated notes in the same area and I am previewing a cleaner single copy.',
		focusPagePoint: duplicates[0].bounds.center,
		updates: [],
		creates: [],
		deleteShapeIds: duplicates.slice(0, 4).map((snapshot) => snapshot.shape.id),
		requiresReview: true,
	}
}

function planListExpansionPass(snapshots: ShapeSnapshot[], fingerprint: string): BoardConciergePass | null {
	const candidate = snapshots
		.filter((snapshot) => snapshot.isTextCarrier)
		.filter((snapshot) => snapshot.shape.type === 'note' || snapshot.shape.type === 'text')
		.map((snapshot) => ({
			snapshot,
			items: extractStructuredListItems(snapshot.plainText),
		}))
		.find(
			(item) =>
				Boolean(item.items) &&
				item.items!.length >= 3 &&
				item.snapshot.plainText.length >= 18
		)

	if (!candidate?.items) return null

	const direction =
		candidate.snapshot.bounds.h >= candidate.snapshot.bounds.w * 1.1 ? 'vertical' : 'horizontal'
	const gapX = clamp(candidate.snapshot.bounds.w + 56, 170, 320)
	const gapY = clamp(candidate.snapshot.bounds.h + 42, 120, 220)
	const creates = candidate.items.map((item, index) =>
		createShapeFromTemplate(
			candidate.snapshot.shape,
			item,
			direction === 'horizontal'
				? candidate.snapshot.bounds.x + index * gapX
				: candidate.snapshot.bounds.x,
			direction === 'horizontal'
				? candidate.snapshot.bounds.y
				: candidate.snapshot.bounds.y + index * gapY
		)
	)

	return {
		fingerprint,
		label: 'Breaking out a list',
		detail: 'I found a packed list and I am previewing separate cards so each idea can move on its own.',
		focusPagePoint: candidate.snapshot.bounds.center,
		updates: [],
		creates: creates.slice(0, 6),
		deleteShapeIds: [candidate.snapshot.shape.id],
		requiresReview: true,
	}
}

function splitDrawRowIntoPhraseGroups(row: ShapeSnapshot[]) {
	if (row.length === 0) return []

	const gaps = row.slice(1).map((snapshot, index) => snapshot.bounds.x - (row[index].bounds.x + row[index].bounds.w))
	const gapThreshold = clamp(Math.max(median(gaps) * 1.8, 42), 42, 180)
	const groups: ShapeSnapshot[][] = [[row[0]]]

	for (let index = 1; index < row.length; index += 1) {
		const previous = row[index - 1]
		const current = row[index]
		const gap = current.bounds.x - (previous.bounds.x + previous.bounds.w)
		if (gap > gapThreshold) {
			groups.push([current])
			continue
		}

		groups[groups.length - 1].push(current)
	}

	return groups
}

function hasTypedTextNearBounds(bounds: BoundsLike, snapshots: ShapeSnapshot[]) {
	return snapshots.some((snapshot) => {
		if (!snapshot.isTextCarrier) return false
		if (snapshot.shape.type === 'draw') return false

		return (
			Math.abs(snapshot.bounds.center.x - bounds.center.x) <= Math.max(64, bounds.w * 0.35) &&
			Math.abs(snapshot.bounds.center.y - bounds.center.y) <= Math.max(52, bounds.h * 0.5)
		)
	})
}

function getSelectedPromptSnapshots(editor: Editor, snapshots: ShapeSnapshot[]) {
	const selectedIds = new Set(editor.getSelectedShapeIds())
	return snapshots.filter(
		(snapshot) =>
			selectedIds.has(snapshot.shape.id) &&
			snapshot.isTextCarrier &&
			!isBoardConciergePreviewShape(snapshot.shape)
	)
}

function getSelectedPromptText(editor: Editor, snapshots: ShapeSnapshot[]) {
	return getSelectedPromptSnapshots(editor, snapshots)
		.map((snapshot) => snapshot.plainText)
		.filter(Boolean)
		.join('\n\n')
		.trim()
}

async function recognizeHandwritingFromImage(dataUrl: string) {
	return recognizeHandwriting(dataUrl)
}

function planAutocompletePass(snapshots: ShapeSnapshot[], fingerprint: string): BoardConciergePass | null {
	const numericSnapshots = collectNumericSnapshots(snapshots)
	if (numericSnapshots.length < 2) return null

	const uniqueNumericSnapshots = [...numericSnapshots]
		.sort((a, b) => a.value - b.value)
		.filter((item, index, array) => index === 0 || array[index - 1].value !== item.value)

	const creates: Array<Record<string, unknown>> = []
	const targets: PagePoint[] = []
	const seenCreateKeys = new Set<string>()

	for (let index = 0; index < uniqueNumericSnapshots.length - 1; index += 1) {
		const current = uniqueNumericSnapshots[index]
		const next = uniqueNumericSnapshots[index + 1]
		const gap = next.value - current.value
		if (gap < 2 || gap > 3) continue

		const placement = getStraightLineGapPlacement(current.snapshot, next.snapshot)
		if (!placement) continue

		const gapTargets = placement.targetsForGap(gap)
		for (let gapIndex = 0; gapIndex < gapTargets.length; gapIndex += 1) {
			const missingValue = current.value + gapIndex + 1
			const target = gapTargets[gapIndex]
			const createKey = `${missingValue}:${round(target.center.x / 10)}:${round(target.center.y / 10)}`
			if (seenCreateKeys.has(createKey)) continue

			seenCreateKeys.add(createKey)
			creates.push(
				createShapeFromTemplate(current.snapshot.shape, String(missingValue), target.x, target.y)
			)
			targets.push(target.center)
		}
	}

	if (creates.length === 0) return null

	return {
		fingerprint,
		label: 'Filling the pattern',
		detail: 'I am reading the board lines themselves and previewing the missing pieces directly on the canvas.',
		focusPagePoint: targets[0] ?? uniqueNumericSnapshots[0].snapshot.bounds.center,
		updates: [],
		creates: creates.slice(0, 4),
		deleteShapeIds: [],
		requiresReview: true,
	}
}

function planTextPass(snapshots: ShapeSnapshot[], fingerprint: string): BoardConciergePass | null {
	const candidates = snapshots
		.filter((snapshot) => snapshot.isTextCarrier && snapshot.plainText)
		.filter((snapshot) => snapshot.plainText.length <= 180)
		.map((snapshot) => {
			const corrected = normalizeText(snapshot.plainText)
			return corrected && corrected !== snapshot.plainText
				? { snapshot, corrected }
				: null
		})
		.filter((value): value is { snapshot: ShapeSnapshot; corrected: string } => value !== null)

	if (candidates.length === 0) return null

	const batch = candidates.slice(0, 4)
	return {
		fingerprint,
		label: 'Polishing the writing',
		detail: 'I am cleaning up easy-to-fix wording so the board reads more clearly.',
		focusPagePoint: batch[0].snapshot.bounds.center,
		updates: batch.map(({ snapshot, corrected }) => createRichTextUpdate(snapshot.shape, corrected)),
		creates: [],
		deleteShapeIds: [],
		requiresReview: false,
	}
}

function getStyleRecipe(snapshot: ShapeSnapshot) {
	if (snapshot.shape.type === 'note') {
		return {
			color: 'yellow',
			font: 'sans',
			labelColor: 'black',
		}
	}

	if (snapshot.shape.type === 'geo') {
		return {
			color: 'blue',
			fill: 'semi',
			font: 'sans',
			labelColor: 'black',
			dash: 'draw',
		}
	}

	if (snapshot.shape.type === 'text') {
		const isHeading =
			snapshot.plainText.length > 0 &&
			snapshot.plainText.length <= 42 &&
			snapshot.plainText.split(/\s+/).length <= 5

		return isHeading
			? {
					color: 'blue',
					font: 'serif',
				}
			: {
					color: 'black',
					font: 'sans',
				}
	}

	return null
}

function planStylePass(snapshots: ShapeSnapshot[], fingerprint: string): BoardConciergePass | null {
	const updates = snapshots
		.filter((snapshot) => snapshot.isTextCarrier && STYLABLE_SHAPE_TYPES.has(snapshot.shape.type))
		.map((snapshot) => {
			const recipe = getStyleRecipe(snapshot)
			if (!recipe) return null

			const props = (snapshot.shape as TLShape & { props?: Record<string, unknown> }).props ?? {}
			const nextProps = Object.entries(recipe).reduce<Record<string, unknown>>((acc, [key, value]) => {
				if (props[key] !== value) {
					acc[key] = value
				}
				return acc
			}, {})

			return Object.keys(nextProps).length > 0
				? {
						id: snapshot.shape.id,
						type: snapshot.shape.type,
						props: nextProps,
					}
				: null
		})
		.filter(Boolean) as Array<Record<string, unknown>>

	if (updates.length === 0) return null

	return {
		fingerprint,
		label: 'Styling the board',
		detail: 'I am giving the canvas a cleaner visual rhythm with clearer colors and typography.',
		focusPagePoint: snapshots[0]?.bounds.center ?? { x: 0, y: 0 },
		updates: updates.slice(0, 8),
		creates: [],
		deleteShapeIds: [],
		requiresReview: false,
	}
}

function looksLikeHeading(snapshot: ShapeSnapshot, minY: number, averageWidth: number) {
	return (
		snapshot.shape.type === 'text' &&
		snapshot.plainText.length > 0 &&
		snapshot.plainText.length <= 48 &&
		snapshot.bounds.y <= minY + 28 &&
		snapshot.bounds.w >= averageWidth * 1.12
	)
}

function planLayoutPass(snapshots: ShapeSnapshot[], fingerprint: string): BoardConciergePass | null {
	const candidates = snapshots.filter((snapshot) => snapshot.isMovable)
	if (candidates.length < 2) return null

	const minY = Math.min(...candidates.map((snapshot) => snapshot.bounds.y))
	const averageWidth =
		candidates.reduce((total, snapshot) => total + snapshot.bounds.w, 0) / candidates.length

	const heading = candidates.find((snapshot) => looksLikeHeading(snapshot, minY, averageWidth))
	const layoutShapes = candidates.filter((snapshot) => snapshot.shape.id !== heading?.shape.id)
	if (layoutShapes.length < 2) return null

	const maxWidth = Math.max(...layoutShapes.map((snapshot) => snapshot.bounds.w))
	const maxHeight = Math.max(...layoutShapes.map((snapshot) => snapshot.bounds.h))
	const columnWidth = clamp(maxWidth + 140, 260, 520)
	const rowHeight = clamp(maxHeight + 110, 150, 320)
	const sortedShapes = [...layoutShapes].sort((a, b) =>
		a.bounds.center.y === b.bounds.center.y
			? a.bounds.center.x - b.bounds.center.x
			: a.bounds.center.y - b.bounds.center.y
	)

	const buildLineUpdates = (
		groups: ShapeSnapshot[][],
		direction: 'horizontal' | 'vertical'
	) => {
		if (groups.length === 0) return []

		const orderedGroups = groups.map((group) =>
			[...group].sort((a, b) =>
				direction === 'horizontal'
					? a.bounds.center.x - b.bounds.center.x
					: a.bounds.center.y - b.bounds.center.y
			)
		)

		const rawPrimaryCenters = orderedGroups.map((group) =>
			average(
				group.map((snapshot) =>
					direction === 'horizontal' ? snapshot.bounds.center.y : snapshot.bounds.center.x
				)
			)
		)
		const primaryAnchor =
			direction === 'horizontal'
				? heading
					? heading.bounds.y + heading.bounds.h + rowHeight / 2
					: undefined
				: heading
					? heading.bounds.center.x - ((orderedGroups.length - 1) * columnWidth) / 2
					: undefined
		const primaryGuides = normalizeGuidePositions(
			rawPrimaryCenters,
			direction === 'horizontal' ? rowHeight : columnWidth,
			primaryAnchor
		)

		const slotCount = Math.max(...orderedGroups.map((group) => group.length))
		const rawSecondaryCenters = Array.from({ length: slotCount }, (_, slotIndex) =>
			average(
				orderedGroups
					.map((group) => group[slotIndex])
					.filter((snapshot): snapshot is ShapeSnapshot => snapshot !== undefined)
					.map((snapshot) =>
						direction === 'horizontal' ? snapshot.bounds.center.x : snapshot.bounds.center.y
					)
			)
		)
		const secondaryAnchor =
			direction === 'horizontal'
				? heading && slotCount > 1
					? heading.bounds.center.x - ((slotCount - 1) * columnWidth) / 2
					: undefined
				: heading
					? heading.bounds.y + heading.bounds.h + rowHeight / 2
					: undefined
		const secondaryGuides = normalizeGuidePositions(
			rawSecondaryCenters,
			direction === 'horizontal' ? columnWidth : rowHeight,
			secondaryAnchor
		)

		return orderedGroups.flatMap((group, groupIndex) => {
			const currentSecondaryValues = group.map((snapshot) =>
				direction === 'horizontal' ? snapshot.bounds.center.x : snapshot.bounds.center.y
			)
			const slotOffset = findBestSlotOffset(currentSecondaryValues, secondaryGuides)

			return group.map((snapshot, itemIndex) => {
				const targetCenterX =
					direction === 'horizontal'
						? secondaryGuides[slotOffset + itemIndex]
						: primaryGuides[groupIndex]
				const targetCenterY =
					direction === 'horizontal'
						? primaryGuides[groupIndex]
						: secondaryGuides[slotOffset + itemIndex]
				const targetX = targetCenterX - snapshot.bounds.w / 2
				const targetY = targetCenterY - snapshot.bounds.h / 2
				const deltaX = targetX - snapshot.bounds.x
				const deltaY = targetY - snapshot.bounds.y

				return {
					id: snapshot.shape.id,
					type: snapshot.shape.type,
					x: round(snapshot.shape.x + deltaX),
					y: round(snapshot.shape.y + deltaY),
					distance: Math.hypot(deltaX, deltaY),
					target: {
						x: targetCenterX,
						y: targetCenterY,
					},
				}
			})
		})
	}

	const rowGroups = clusterByAxis(layoutShapes, 'horizontal')
		.map((group) => [...group].sort((a, b) => a.bounds.center.x - b.bounds.center.x))
		.sort(
			(a, b) =>
				average(a.map((snapshot) => snapshot.bounds.center.y)) -
				average(b.map((snapshot) => snapshot.bounds.center.y))
		)
	const columnGroups = clusterByAxis(layoutShapes, 'vertical')
		.map((group) => [...group].sort((a, b) => a.bounds.center.y - b.bounds.center.y))
		.sort(
			(a, b) =>
				average(a.map((snapshot) => snapshot.bounds.center.x)) -
				average(b.map((snapshot) => snapshot.bounds.center.x))
		)

	const strongestRow = Math.max(...rowGroups.map((group) => group.length))
	const strongestColumn = Math.max(...columnGroups.map((group) => group.length))
	const prefersColumnLayout = strongestColumn >= 3 && strongestColumn > strongestRow

	let updates = prefersColumnLayout ? buildLineUpdates(columnGroups, 'vertical') : []

	if (updates.length === 0) {
		const hasReadableRows = strongestRow >= 2
		if (hasReadableRows) {
			updates = buildLineUpdates(rowGroups, 'horizontal')
		} else {
			const columns =
				layoutShapes.length <= 2 ? layoutShapes.length : layoutShapes.length >= 7 ? 3 : 2
			const compactRows: ShapeSnapshot[][] = []

			for (let index = 0; index < sortedShapes.length; index += columns) {
				compactRows.push(sortedShapes.slice(index, index + columns))
			}

			updates = buildLineUpdates(compactRows, 'horizontal')
		}
	}

	if (updates.length === 0) return null

	const averageDistance =
		updates.reduce((total, update) => total + update.distance, 0) / updates.length

	if (averageDistance < 18) return null

	return {
		fingerprint,
		label: 'Reflowing the layout',
		detail: 'I am snapping the board into straighter lines so related ideas read in clean rows and columns.',
		focusPagePoint:
			updates[0]?.target ??
			(heading
				? { x: heading.bounds.center.x, y: heading.bounds.y + heading.bounds.h + rowHeight / 2 }
				: layoutShapes[0]?.bounds.center ?? { x: 0, y: 0 }),
		updates: updates.map(({ distance, target, ...update }) => update),
		creates: [],
		deleteShapeIds: [],
		requiresReview: false,
	}
}

export function planBoardConciergePass(editor: Editor): BoardConciergePass | null {
	const snapshots = collectSnapshots(editor)
	if (snapshots.length === 0) return null

	const fingerprint = fingerprintBoard(snapshots)
	return (
		planLayoutPass(snapshots, fingerprint) ??
		planEmptyCleanupPass(snapshots, fingerprint) ??
		planDuplicateCleanupPass(snapshots, fingerprint) ??
		planListExpansionPass(snapshots, fingerprint) ??
		planHandwritingNormalizationPass(snapshots, fingerprint) ??
		planAutocompletePass(snapshots, fingerprint) ??
		planTextPass(snapshots, fingerprint) ??
		planStylePass(snapshots, fingerprint)
	)
}

export function getBoardConciergeFingerprint(editor: Editor) {
	return fingerprintBoard(collectSnapshots(editor))
}

export function hasRecognizableSelection(editor: Editor) {
	return editor
		.getSelectedShapeIds()
		.map((shapeId) => editor.getShape(shapeId))
		.some(
			(shape) =>
				Boolean(shape) &&
				shape?.type === 'draw' &&
				isPageId(shape.parentId) &&
				!isBoardConciergePreviewShape(shape)
		)
}

export function hasGenerativeSelection(editor: Editor) {
	const snapshots = collectSnapshots(editor)
	const promptText = getSelectedPromptText(editor, snapshots)
	return promptText.length >= 4
}

export async function planBoardConciergeSelectedGenerationPass(
	editor: Editor,
	fingerprint = getBoardConciergeFingerprint(editor)
): Promise<BoardConciergePass | null> {
	const snapshots = collectSnapshots(editor)
	if (snapshots.length === 0) return null

	const promptSnapshots = getSelectedPromptSnapshots(editor, snapshots)
	if (promptSnapshots.length === 0) return null

	const promptText = promptSnapshots.map((snapshot) => snapshot.plainText).join('\n\n').trim()
	if (promptText.length < 4) return null

	const generated = await generateBoardImage(promptText)
	if (!generated) return null

	const anchorBounds = mergeSnapshotBounds(promptSnapshots)
	const parentId = promptSnapshots[0].shape.parentId
	const imageWidth = generated.width
	const imageHeight = generated.height
	const imageX = anchorBounds.center.x - imageWidth / 2
	const imageY = anchorBounds.y + anchorBounds.h + 88
	const altText = generated.title || promptText.slice(0, 120)
	const noteText = generated.title
		? `${generated.title}\n\n${promptText}`
		: promptText
	const noteWidth = clamp(Math.max(anchorBounds.w, 260), 260, 420)
	const noteX = anchorBounds.center.x - noteWidth / 2
	const noteY = anchorBounds.y + anchorBounds.h + 24

	return {
		fingerprint,
		label: 'Generating a visual',
		detail: 'I turned your selected prompt into visible board content with text first and a visual preview when available.',
		focusPagePoint: {
			x: anchorBounds.center.x,
			y: imageY + imageHeight / 2,
		},
		updates: [],
		creates: [
			createTextShapeFromPrompt(parentId, noteX, noteY, noteText),
			createImageShapeFromUrl(parentId, generated.imageUrl, imageX, imageY, imageWidth, imageHeight, altText),
		],
		deleteShapeIds: [],
		requiresReview: false,
	}
}

export async function planBoardConciergeSelectedVisionPass(
	editor: Editor,
	fingerprint = getBoardConciergeFingerprint(editor)
): Promise<BoardConciergePass | null> {
	const snapshots = collectSnapshots(editor)
	if (snapshots.length === 0) return null

	const selectedIds = new Set(editor.getSelectedShapeIds())
	const selectedDrawSnapshots = snapshots.filter(
		(snapshot) =>
			selectedIds.has(snapshot.shape.id) &&
			snapshot.shape.type === 'draw' &&
			isPageId(snapshot.shape.parentId)
	)

	if (selectedDrawSnapshots.length === 0) return null

	const mergedBounds = mergeSnapshotBounds(selectedDrawSnapshots)
	const exported = await editor.toImageDataUrl(selectedDrawSnapshots.map((snapshot) => snapshot.shape.id))
	if (!exported?.url) return null

	const recognition = await recognizeHandwritingFromImage(exported.url)
	if (!recognition) return null

	return {
		fingerprint,
		label: 'Recognizing selection',
		detail: 'I read the selected handwriting and I am previewing the full typed transcription on the canvas.',
		focusPagePoint: mergedBounds.center,
		updates: [],
		creates: [
			createTextShapeFromBounds(
				selectedDrawSnapshots[0].shape,
				recognition.transcription,
				mergedBounds
			),
		],
		deleteShapeIds: selectedDrawSnapshots.map((snapshot) => snapshot.shape.id),
		requiresReview: true,
	}
}

export async function planBoardConciergeVisionPass(
	editor: Editor,
	fingerprint = getBoardConciergeFingerprint(editor)
): Promise<BoardConciergePass | null> {
	const snapshots = collectSnapshots(editor)
	if (snapshots.length === 0) return null

	const drawSnapshots = snapshots
		.filter((snapshot) => snapshot.shape.type === 'draw')
		.filter((snapshot) => isPageId(snapshot.shape.parentId))
		.filter((snapshot) => snapshot.bounds.w >= 18 && snapshot.bounds.h >= 18)

	if (drawSnapshots.length === 0) return null

	const drawRows = clusterByAxis(drawSnapshots, 'horizontal')
		.map((row) => [...row].sort((a, b) => a.bounds.x - b.bounds.x))
		.flatMap((row) => splitDrawRowIntoPhraseGroups(row))
		.filter((group) => group.length > 0)
		.sort(
			(a, b) =>
				mergeSnapshotBounds(a).center.y - mergeSnapshotBounds(b).center.y ||
				mergeSnapshotBounds(a).x - mergeSnapshotBounds(b).x
		)

	for (const group of drawRows.slice(0, 3)) {
		const mergedBounds = mergeSnapshotBounds(group)
		if (hasTypedTextNearBounds(mergedBounds, snapshots)) continue

		const exported = await editor.toImageDataUrl(group.map((snapshot) => snapshot.shape.id))
		if (!exported?.url) continue

		const recognition = await recognizeHandwritingFromImage(exported.url)
		if (!recognition) continue

		return {
			fingerprint,
			label: 'Converting handwriting',
			detail: 'I recognized a handwritten label and I am previewing a clean typed version on the canvas.',
			focusPagePoint: mergedBounds.center,
			updates: [],
			creates: [createTextShapeFromBounds(group[0].shape, recognition.transcription, mergedBounds)],
			deleteShapeIds: group.map((snapshot) => snapshot.shape.id),
			requiresReview: true,
		}
	}

	return null
}

export function applyBoardConciergePass(editor: Editor, pass: BoardConciergePass) {
	if (pass.updates.length === 0 && pass.creates.length === 0 && pass.deleteShapeIds.length === 0) {
		return false
	}

	editor.markHistoryStoppingPoint(`orbit:${pass.label.toLowerCase()}`)
	if (pass.creates.length > 0) {
		editor.createShapes(pass.creates as never[])
	}
	editor.updateShapes(pass.updates as never[])
	if (pass.deleteShapeIds.length > 0) {
		editor.deleteShapes(pass.deleteShapeIds as never[])
	}
	return true
}

export function createBoardConciergeReview(
	editor: Editor,
	pass: BoardConciergePass
): BoardConciergeReview | null {
	if (!pass.requiresReview || (pass.creates.length === 0 && pass.deleteShapeIds.length === 0)) {
		return null
	}

	const previewShapes = pass.creates.map((shape) => {
		const finalOpacity =
			typeof shape.opacity === 'number' && Number.isFinite(shape.opacity)
				? Number(shape.opacity)
				: 1

		return {
			...shape,
			id: createShapeId(),
			opacity: Math.max(0.24, Math.min(0.42, finalOpacity * 0.38)),
			meta: {
				...(((shape.meta as Record<string, unknown> | undefined) ?? {})),
				orbitPreview: true,
				orbitFinalOpacity: finalOpacity,
			},
		}
	})

	const restoreShapeOpacities = pass.deleteShapeIds
		.map((shapeId) => {
			const shape = editor.getShape(shapeId)
			if (!shape) return null

			return {
				id: shape.id as TLShapeId,
				type: shape.type,
				opacity:
					typeof (shape as TLShape & { opacity?: number }).opacity === 'number'
						? Number((shape as TLShape & { opacity?: number }).opacity)
						: 1,
			}
		})
		.filter(
			(shape): shape is { id: TLShapeId; type: TLShape['type']; opacity: number } => shape !== null
		)

	if (previewShapes.length > 0) {
		editor.createShapes(previewShapes as never[])
	}
	if (restoreShapeOpacities.length > 0) {
		editor.updateShapes(
			restoreShapeOpacities.map((shape) => ({
				id: shape.id,
				type: shape.type,
				opacity: Math.max(0.12, Math.min(0.28, shape.opacity * 0.22)),
			})) as never[]
		)
	}

	return {
		fingerprint: pass.fingerprint,
		label: pass.label,
		detail: pass.detail,
		focusPagePoint: pass.focusPagePoint,
		previewShapeIds: previewShapes.map((shape) => shape.id as TLShapeId),
		finalCreates: pass.creates,
		deleteShapeIds: pass.deleteShapeIds,
		restoreShapeOpacities,
	}
}

export function acceptBoardConciergeReview(editor: Editor, review: BoardConciergeReview) {
	const updates = review.previewShapeIds
		.map((shapeId, index) => {
			const finalShape = review.finalCreates[index]
			const shape = editor.getShape(shapeId)
			if (!shape || !finalShape) return null

			return {
				id: shape.id,
				type: shape.type,
				opacity:
					typeof finalShape.opacity === 'number' && Number.isFinite(finalShape.opacity)
						? Number(finalShape.opacity)
						: 1,
				meta: {},
			}
		})
		.filter(Boolean)

	if (updates.length > 0) {
		editor.markHistoryStoppingPoint('orbit:accept preview')
		editor.updateShapes(updates as never[])
	}
	if (review.deleteShapeIds.length > 0) {
		editor.deleteShapes(review.deleteShapeIds as never[])
	}
}

export function rejectBoardConciergeReview(editor: Editor, review: BoardConciergeReview) {
	if (review.previewShapeIds.length === 0 && review.restoreShapeOpacities.length === 0) return
	editor.markHistoryStoppingPoint('orbit:reject preview')
	if (review.previewShapeIds.length > 0) {
		editor.deleteShapes(review.previewShapeIds as never[])
	}
	if (review.restoreShapeOpacities.length > 0) {
		editor.updateShapes(
			review.restoreShapeOpacities.map((shape) => ({
				id: shape.id,
				type: shape.type,
				opacity: shape.opacity,
			})) as never[]
		)
	}
}
