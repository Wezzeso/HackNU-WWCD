import {
	createShapePropsMigrationSequence,
	createTLSchema,
	defaultShapeSchemas,
	type TLBaseShape,
	type RecordProps,
} from '@tldraw/tlschema'
import { T } from '@tldraw/validate'

export const REACTION_STAMP_SHAPE_TYPE = 'reaction-stamp'
export const REACTION_STAMP_IDS = ['like', 'love', 'hate'] as const

export type StampReaction = (typeof REACTION_STAMP_IDS)[number]

export interface ReactionStampProps {
	w: number
	h: number
	reaction: StampReaction
	ownerId: string
	ownerName: string
	ownerColor: string
}

type ReactionStampBaseShape = TLBaseShape<typeof REACTION_STAMP_SHAPE_TYPE, ReactionStampProps>

export const reactionStampShapeProps: RecordProps<ReactionStampBaseShape> = {
	w: T.number,
	h: T.number,
	reaction: T.literalEnum(...REACTION_STAMP_IDS),
	ownerId: T.string,
	ownerName: T.string,
	ownerColor: T.string,
}

export const reactionStampShapeMigrations = createShapePropsMigrationSequence({ sequence: [] })

export const reactionStampTLSchema = createTLSchema({
	shapes: {
		...defaultShapeSchemas,
		[REACTION_STAMP_SHAPE_TYPE]: {
			props: reactionStampShapeProps,
			migrations: reactionStampShapeMigrations,
		},
	},
})
