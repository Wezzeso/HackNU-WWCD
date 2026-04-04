import { HTMLContainer, Rectangle2d, ShapeUtil } from 'tldraw'
import {
	reactionStampShapeMigrations,
	reactionStampShapeProps,
} from '../../shared/tldraw/reactionStampSchema'
import {
	REACTION_STAMP_HEIGHT,
	REACTION_STAMP_SHAPE_TYPE,
	REACTION_STAMP_WIDTH,
	getReactionStampDef,
	type ReactionStampShape,
} from './stamps'

export class ReactionStampShapeUtil extends ShapeUtil<ReactionStampShape> {
	static override type = REACTION_STAMP_SHAPE_TYPE
	static override migrations = reactionStampShapeMigrations
	static override props = reactionStampShapeProps

	override canEdit() {
		return false
	}

	override canResize() {
		return false
	}

	override hideResizeHandles() {
		return true
	}

	override hideRotateHandle() {
		return true
	}

	override hideSelectionBoundsBg() {
		return true
	}

	override hideSelectionBoundsFg() {
		return true
	}

	override isAspectRatioLocked() {
		return true
	}

	override getAriaDescriptor(shape: ReactionStampShape) {
		const stamp = getReactionStampDef(shape.props.reaction)
		return `${stamp.label} stamp by ${shape.props.ownerName}`
	}

	override getDefaultProps(): ReactionStampShape['props'] {
		return {
			w: REACTION_STAMP_WIDTH,
			h: REACTION_STAMP_HEIGHT,
			reaction: 'like',
			ownerId: '',
			ownerName: 'Someone',
			ownerColor: '#4ea3ff',
		}
	}

	override getGeometry(shape: ReactionStampShape) {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		})
	}

	override component(shape: ReactionStampShape) {
		const stamp = getReactionStampDef(shape.props.reaction)

		return (
			<HTMLContainer
				title={`${stamp.label} by ${shape.props.ownerName}`}
				style={{
					width: shape.props.w,
					height: shape.props.h,
					pointerEvents: 'all',
				}}
			>
				<div
					style={{
						position: 'relative',
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						width: '100%',
						height: '100%',
						padding: '0 12px',
						borderRadius: 999,
						border: `2px solid ${stamp.border}`,
						background: stamp.background,
						boxShadow: '0 10px 20px rgba(15, 23, 42, 0.12)',
						color: stamp.text,
						fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
						fontSize: 13,
						fontWeight: 800,
						letterSpacing: '0.02em',
						textTransform: 'uppercase',
						userSelect: 'none',
					}}
				>
					<span style={{ fontSize: 17, lineHeight: 1 }}>{stamp.emoji}</span>
					<span>{stamp.label}</span>
					<span
						style={{
							position: 'absolute',
							right: 6,
							top: 6,
							width: 8,
							height: 8,
							borderRadius: 999,
							background: shape.props.ownerColor,
							boxShadow: '0 0 0 2px rgba(255,255,255,0.9)',
						}}
					/>
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: ReactionStampShape) {
		return (
			<rect
				width={shape.props.w}
				height={shape.props.h}
				rx={shape.props.h / 2}
				ry={shape.props.h / 2}
			/>
		)
	}
}
