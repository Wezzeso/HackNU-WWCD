import { createShapeId, type TLCreateShapePartial, type TLShape } from '@tldraw/tlschema'
import type { Editor } from 'tldraw'
import {
	REACTION_STAMP_IDS,
	REACTION_STAMP_SHAPE_TYPE,
	type StampReaction,
} from '../../shared/tldraw/reactionStampSchema'

export const STAMP_TOOL_ID = 'stamp'
export { REACTION_STAMP_IDS, REACTION_STAMP_SHAPE_TYPE }
export type { StampReaction }

export type ReactionStampShape = TLShape<typeof REACTION_STAMP_SHAPE_TYPE>

export const REACTION_STAMP_DEFS: Array<{
	id: StampReaction
	label: string
	emoji: string
	background: string
	border: string
	text: string
}> = [
	{
		id: 'like',
		label: 'Like',
		emoji: '👍',
		background: '#dcfce7',
		border: '#4ade80',
		text: '#166534',
	},
	{
		id: 'love',
		label: 'Love',
		emoji: '❤️',
		background: '#fce7f3',
		border: '#f472b6',
		text: '#9d174d',
	},
	{
		id: 'hate',
		label: 'Hate',
		emoji: '👎',
		background: '#fee2e2',
		border: '#f87171',
		text: '#991b1b',
	},
]

export const REACTION_STAMP_WIDTH = 92
export const REACTION_STAMP_HEIGHT = 38

const STAMP_REACTION_BY_EDITOR = new WeakMap<Editor, StampReaction>()

export function getReactionStampDef(reaction: StampReaction) {
	return REACTION_STAMP_DEFS.find((item) => item.id === reaction) ?? REACTION_STAMP_DEFS[0]
}

export function getCurrentStampReaction(editor: Editor): StampReaction {
	return STAMP_REACTION_BY_EDITOR.get(editor) ?? 'like'
}

export function setCurrentStampReaction(editor: Editor, reaction: StampReaction) {
	STAMP_REACTION_BY_EDITOR.set(editor, reaction)
}

export function isReactionStamp(shape: { type: string } | null | undefined): shape is ReactionStampShape {
	return !!shape && shape.type === REACTION_STAMP_SHAPE_TYPE
}

function getPlacementOffset(editor: Editor, point: { x: number; y: number }) {
	const nearbyStamps = editor.getCurrentPageShapes().filter((shape) => {
		if (!isReactionStamp(shape)) return false
		const dx = shape.x + shape.props.w / 2 - point.x
		const dy = shape.y + shape.props.h / 2 - point.y
		return Math.hypot(dx, dy) < 56
	})

	if (nearbyStamps.length === 0) {
		return { x: 0, y: 0 }
	}

	const angle = nearbyStamps.length * 1.2
	const radius = Math.min(nearbyStamps.length * 8, 24)

	return {
		x: Math.cos(angle) * radius,
		y: Math.sin(angle) * radius,
	}
}

export function createReactionStampShape(
	editor: Editor,
	point: { x: number; y: number }
): TLCreateShapePartial<ReactionStampShape> {
	const reaction = getCurrentStampReaction(editor)
	const { id: ownerId, name: ownerName, color: ownerColor } = editor.user.getUserPreferences()
	const offset = getPlacementOffset(editor, point)

	return {
		id: createShapeId(),
		type: REACTION_STAMP_SHAPE_TYPE,
		x: point.x - REACTION_STAMP_WIDTH / 2 + offset.x,
		y: point.y - REACTION_STAMP_HEIGHT / 2 + offset.y,
		props: {
			w: REACTION_STAMP_WIDTH,
			h: REACTION_STAMP_HEIGHT,
			reaction,
			ownerId,
			ownerName,
			ownerColor,
		},
	}
}
