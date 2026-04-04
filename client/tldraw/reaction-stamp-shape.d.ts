import '@tldraw/tlschema'
import type { ReactionStampProps } from '../../shared/tldraw/reactionStampSchema'

declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'reaction-stamp': ReactionStampProps
	}
}

export {}
