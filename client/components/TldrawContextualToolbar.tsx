import {
	ArrowShapeArrowheadEndStyle,
	ArrowShapeArrowheadStartStyle,
	ArrowShapeKindStyle,
	DefaultColorStyle,
	DefaultDashStyle,
	DefaultFillStyle,
	DefaultSizeStyle,
	GeoShapeGeoStyle,
	StyleProp,
	TldrawUiToolbar,
	TldrawUiToolbarButton,
	useEditor,
	useValue,
} from 'tldraw'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
	ArrowRight,
	Brush,
	Circle,
	Cloud,
	Diamond,
	Hand,
	Heart,
	MousePointer2,
	Shapes,
	Sparkles,
	Square,
	Stamp,
	Star,
	StickyNote,
	ThumbsDown,
	ThumbsUp,
	Triangle,
} from 'lucide-react'
import { expandDocument } from '../utils/canvasAI'
import {
	REACTION_STAMP_DEFS,
	STAMP_TOOL_ID,
	getCurrentStampReaction,
	setCurrentStampReaction,
	type StampReaction,
} from '../tldraw/stamps'
import './TldrawContextualToolbar.css'

type ToolMode = 'select' | 'hand' | 'arrow' | 'shapes' | 'brush' | 'stickers' | 'stamps'
type ShapeGeo = 'rectangle' | 'ellipse' | 'diamond' | 'triangle' | 'star' | 'cloud'
type ColorName =
	| 'black'
	| 'grey'
	| 'violet'
	| 'red'
	| 'orange'
	| 'yellow'
	| 'green'
	| 'blue'
type SizeName = 's' | 'm' | 'l' | 'xl'
type FillName = 'none' | 'semi' | 'solid'
type DashName = 'draw' | 'dashed' | 'dotted' | 'solid'
type ArrowKindName = 'straight' | 'arc' | 'elbow'
type ArrowheadName = 'none' | 'arrow' | 'triangle' | 'dot'

const SHAPE_GEOS: ShapeGeo[] = ['rectangle', 'ellipse', 'diamond', 'triangle', 'star', 'cloud']
const COLORS: Array<{ value: ColorName; hex: string }> = [
	{ value: 'black', hex: '#1f2937' },
	{ value: 'grey', hex: '#9aa4b2' },
	{ value: 'violet', hex: '#8b5cf6' },
	{ value: 'red', hex: '#ef4444' },
	{ value: 'orange', hex: '#fb923c' },
	{ value: 'yellow', hex: '#fbbf24' },
	{ value: 'green', hex: '#58c26d' },
	{ value: 'blue', hex: '#4ea3ff' },
]
const SIZES: SizeName[] = ['s', 'm', 'l', 'xl']
const FILLS: Array<{ value: FillName; label: string }> = [
	{ value: 'none', label: 'No fill' },
	{ value: 'semi', label: 'Soft fill' },
	{ value: 'solid', label: 'Solid fill' },
]
const DASHES: Array<{ value: DashName; label: string }> = [
	{ value: 'draw', label: 'Sketch' },
	{ value: 'dashed', label: 'Dashed' },
	{ value: 'dotted', label: 'Dotted' },
	{ value: 'solid', label: 'Solid' },
]
const ARROW_KINDS: Array<{ value: ArrowKindName; label: string }> = [
	{ value: 'straight', label: 'Straight' },
	{ value: 'arc', label: 'Arc' },
	{ value: 'elbow', label: 'Elbow' },
]
const ARROWHEADS: Array<{ value: ArrowheadName; label: string }> = [
	{ value: 'none', label: 'None' },
	{ value: 'arrow', label: 'Arrow' },
	{ value: 'triangle', label: 'Triangle' },
	{ value: 'dot', label: 'Dot' },
]

function geoIcon(geo: ShapeGeo) {
	switch (geo) {
		case 'rectangle':
			return <Square size={16} />
		case 'ellipse':
			return <Circle size={16} />
		case 'diamond':
			return <Diamond size={16} />
		case 'triangle':
			return <Triangle size={16} />
		case 'star':
			return <Star size={16} />
		case 'cloud':
			return <Cloud size={16} />
	}
}

function titleCaseSize(size: SizeName) {
	return size.toUpperCase()
}

function reactionIcon(reaction: StampReaction) {
	switch (reaction) {
		case 'like':
			return <ThumbsUp size={16} />
		case 'love':
			return <Heart size={16} />
		case 'hate':
			return <ThumbsDown size={16} />
	}
}

export function TldrawContextualToolbar() {
	const editor = useEditor()
	const [currentStampReaction, setStampReaction] = useState<StampReaction>(() =>
		getCurrentStampReaction(editor)
	)
	const [isExpanding, setIsExpanding] = useState(false)

	const currentToolId = useValue('current tool id', () => editor.getCurrentToolId(), [editor])
	const currentGeo = useValue(
		'current geo',
		() => editor.getSharedStyles().getAsKnownValue(GeoShapeGeoStyle) ?? 'rectangle',
		[editor]
	) as ShapeGeo
	const currentColor = useValue(
		'current color',
		() => (editor.getSharedStyles().getAsKnownValue(DefaultColorStyle) ?? 'black') as ColorName,
		[editor]
	)
	const currentSize = useValue(
		'current size',
		() => (editor.getSharedStyles().getAsKnownValue(DefaultSizeStyle) ?? 'm') as SizeName,
		[editor]
	)
	const currentFill = useValue(
		'current fill',
		() => (editor.getSharedStyles().getAsKnownValue(DefaultFillStyle) ?? 'none') as FillName,
		[editor]
	)
	const currentDash = useValue(
		'current dash',
		() => (editor.getSharedStyles().getAsKnownValue(DefaultDashStyle) ?? 'draw') as DashName,
		[editor]
	)
	const currentArrowKind = useValue(
		'current arrow kind',
		() =>
			(editor.getSharedStyles().getAsKnownValue(ArrowShapeKindStyle) ?? 'straight') as ArrowKindName,
		[editor]
	)
	const currentArrowheadEnd = useValue(
		'current arrowhead end',
		() =>
			(editor.getSharedStyles().getAsKnownValue(ArrowShapeArrowheadEndStyle) ??
				'arrow') as ArrowheadName,
		[editor]
	)

	useEffect(() => {
		setStampReaction(getCurrentStampReaction(editor))
	}, [editor])

	const activeMode: ToolMode =
		currentToolId === 'select' ||
		currentToolId === 'hand' ||
		currentToolId === 'arrow' ||
		currentToolId === 'draw' ||
		currentToolId === 'note'
			? ({
					select: 'select',
					hand: 'hand',
					arrow: 'arrow',
					draw: 'brush',
					note: 'stickers',
				}[currentToolId] as ToolMode)
			: currentToolId === STAMP_TOOL_ID
				? 'stamps'
				: currentToolId === 'geo'
					? 'shapes'
					: 'select'

	const applyStyle = <T,>(style: StyleProp<T>, value: T) => {
		editor.run(() => {
			if (editor.isIn('select')) {
				editor.setStyleForSelectedShapes(style, value)
			}
			editor.setStyleForNextShapes(style, value)
			editor.updateInstanceState({ isChangingStyle: true })
		})
	}

	const setToolMode = (mode: ToolMode) => {
		switch (mode) {
			case 'select':
				editor.setCurrentTool('select')
				break
			case 'hand':
				editor.setCurrentTool('hand')
				break
			case 'arrow':
				editor.setCurrentTool('arrow')
				break
			case 'brush':
				editor.setCurrentTool('draw')
				break
			case 'stickers':
				editor.setCurrentTool('note')
				break
			case 'shapes':
				editor.run(() => {
					const nextGeo = SHAPE_GEOS.includes(currentGeo) ? currentGeo : 'rectangle'
					editor.setStyleForNextShapes(GeoShapeGeoStyle, nextGeo)
					editor.setCurrentTool('geo')
				})
				break
			case 'stamps':
				editor.setCurrentTool(STAMP_TOOL_ID)
				break
		}
	}

	const pickGeo = (geo: ShapeGeo) => {
		applyStyle(GeoShapeGeoStyle, geo)
		editor.setCurrentTool('geo')
	}

	const pickStampReaction = (reaction: StampReaction) => {
		setCurrentStampReaction(editor, reaction)
		setStampReaction(reaction)
		editor.setCurrentTool(STAMP_TOOL_ID)
	}

	// Check if selected shapes have short text content suitable for expansion
	const selectedShapes = useValue(
		'selected shapes',
		() => editor.getSelectedShapes(),
		[editor]
	)

	const expandableText = (() => {
		if (activeMode !== 'select' || selectedShapes.length !== 1) return null
		const shape = selectedShapes[0]
		const shapeType = shape.type

		let text = ''
		if (shapeType === 'note' && 'text' in shape.props) {
			text = (shape.props as any).text || ''
		} else if (shapeType === 'text' && 'text' in shape.props) {
			text = (shape.props as any).text || ''
		} else if (shapeType === 'geo' && 'text' in shape.props) {
			text = (shape.props as any).text || ''
		}

		if (text.trim().length > 10 && text.trim().length < 300) {
			return text.trim()
		}
		return null
	})()

	const handleExpandWithAI = async () => {
		if (!expandableText || isExpanding) return

		setIsExpanding(true)
		try {
			const expanded = await expandDocument(expandableText)
			if (expanded) {
				const selectedShape = editor.getSelectedShapes()[0]
				if (!selectedShape) return

				// Create a new note shape next to the selected one with the expanded text
				const bounds = editor.getShapePageBounds(selectedShape)
				if (!bounds) return

				editor.createShape({
					type: 'note',
					x: bounds.maxX + 40,
					y: bounds.y,
					props: {
						text: expanded,
					},
				} as any)
			}
		} catch (err) {
			console.error('[canvasAI] expand failed:', err)
		} finally {
			setIsExpanding(false)
		}
	}

	return (
		<div className="tldraw-contextual-toolbar">
			{activeMode !== 'select' && activeMode !== 'hand' ? (
				<div className="tldraw-contextual-toolbar__stylebar">
					<div className="tldraw-contextual-toolbar__group">
						{activeMode === 'brush' ? (
							<>
								<ToolChip icon={<Brush size={16} />} label="Brush" active />
								<SegmentGroup label="Brush dash styles">
									{DASHES.map((dash) => (
										<SegmentButton
											key={dash.value}
											active={currentDash === dash.value}
											onClick={() => applyStyle(DefaultDashStyle, dash.value)}
											title={dash.label}
										>
											{dash.value === 'draw'
												? '∿'
												: dash.value === 'dashed'
													? '– –'
													: dash.value === 'dotted'
														? '···'
														: '—'}
										</SegmentButton>
									))}
								</SegmentGroup>
							</>
						) : null}

						{activeMode === 'arrow' ? (
							<>
								<ToolChip icon={<ArrowRight size={16} />} label="Arrow" active />
								<SegmentGroup label="Arrow path styles">
									{ARROW_KINDS.map((kind) => (
										<SegmentButton
											key={kind.value}
											active={currentArrowKind === kind.value}
											onClick={() => applyStyle(ArrowShapeKindStyle, kind.value)}
											title={kind.label}
										>
											{kind.label}
										</SegmentButton>
									))}
								</SegmentGroup>
								<SegmentGroup label="Arrow head styles">
									{ARROWHEADS.map((head) => (
										<SegmentButton
											key={head.value}
											active={currentArrowheadEnd === head.value}
											onClick={() => {
												applyStyle(ArrowShapeArrowheadStartStyle, 'none')
												applyStyle(ArrowShapeArrowheadEndStyle, head.value)
											}}
											title={head.label}
										>
											{head.label}
										</SegmentButton>
									))}
								</SegmentGroup>
							</>
						) : null}

						{activeMode === 'shapes' ? (
							<>
								<ToolChip icon={<Shapes size={16} />} label="Shapes" active />
								<SegmentGroup label="Shape presets">
									{SHAPE_GEOS.map((geo) => (
										<SegmentButton
											key={geo}
											active={currentGeo === geo}
											onClick={() => pickGeo(geo)}
											title={geo}
										>
											{geoIcon(geo)}
										</SegmentButton>
									))}
								</SegmentGroup>
							</>
						) : null}

						{activeMode === 'stickers' ? (
							<ToolChip icon={<StickyNote size={16} />} label="Stickers" active />
						) : null}

						{activeMode === 'stamps' ? (
							<>
								<ToolChip icon={<Stamp size={16} />} label="Stamps" active />
								<ToolChip
									icon={<span className="tldraw-contextual-toolbar__glyph">+</span>}
									label="Click board to vote"
								/>
								<SegmentGroup label="Reaction presets">
									{REACTION_STAMP_DEFS.map((reaction) => (
										<SegmentButton
											key={reaction.id}
											active={currentStampReaction === reaction.id}
											onClick={() => pickStampReaction(reaction.id)}
											title={reaction.label}
										>
											{reactionIcon(reaction.id)}
										</SegmentButton>
									))}
								</SegmentGroup>
							</>
						) : null}
					</div>

					{activeMode !== 'stamps' ? (
						<div className="tldraw-contextual-toolbar__group">
							<div className="tldraw-contextual-toolbar__swatches">
								{COLORS.map((color) => (
									<button
										key={color.value}
										type="button"
										className="tldraw-contextual-toolbar__swatch"
										data-active={currentColor === color.value}
										style={{ '--swatch-color': color.hex } as CSSProperties}
										onClick={() => applyStyle(DefaultColorStyle, color.value)}
										title={color.value}
									/>
								))}
							</div>

							{activeMode === 'shapes' || activeMode === 'stickers' ? (
								<SegmentGroup label="Fill styles">
									{FILLS.map((fill) => (
										<SegmentButton
											key={fill.value}
											active={currentFill === fill.value}
											onClick={() => applyStyle(DefaultFillStyle, fill.value)}
											title={fill.label}
										>
											<span
												className={`tldraw-contextual-toolbar__fill tldraw-contextual-toolbar__fill--${fill.value}`}
											/>
										</SegmentButton>
									))}
								</SegmentGroup>
							) : null}

							<SegmentGroup label="Stroke sizes">
								{SIZES.map((size) => (
									<SegmentButton
										key={size}
										active={currentSize === size}
										onClick={() => applyStyle(DefaultSizeStyle, size)}
										title={size}
									>
										{titleCaseSize(size)}
									</SegmentButton>
								))}
							</SegmentGroup>
						</div>
					) : null}
				</div>
			) : null}

			{/* Expand with AI button for select mode with short text */}
			{activeMode === 'select' && expandableText && (
				<div className="tldraw-contextual-toolbar__stylebar">
					<button
						className="tldraw-contextual-toolbar__expand-btn"
						onClick={handleExpandWithAI}
						disabled={isExpanding}
						title="Expand short text into a full document using AI"
					>
						<Sparkles size={14} />
						{isExpanding ? 'Expanding...' : 'Expand with AI'}
					</button>
				</div>
			)}

			<TldrawUiToolbar
				className="tldraw-contextual-toolbar__mainbar"
				label="Main drawing tools"
				orientation="horizontal"
			>
				<MainToolButton
					active={activeMode === 'select'}
					title="Select"
					onClick={() => setToolMode('select')}
					icon={<MousePointer2 size={18} />}
				/>
				<MainToolButton
					active={activeMode === 'hand'}
					title="Hand"
					onClick={() => setToolMode('hand')}
					icon={<Hand size={18} />}
				/>
				<MainToolButton
					active={activeMode === 'arrow'}
					title="Arrow"
					onClick={() => setToolMode('arrow')}
					icon={<ArrowRight size={18} />}
				/>
				<MainToolButton
					active={activeMode === 'shapes'}
					title="Shapes"
					onClick={() => setToolMode('shapes')}
					icon={<Shapes size={18} />}
				/>
				<MainToolButton
					active={activeMode === 'brush'}
					title="Brush"
					onClick={() => setToolMode('brush')}
					icon={<Brush size={18} />}
				/>
				<MainToolButton
					active={activeMode === 'stickers'}
					title="Stickers"
					onClick={() => setToolMode('stickers')}
					icon={<StickyNote size={18} />}
				/>
				<MainToolButton
					active={activeMode === 'stamps'}
					title="Stamps"
					onClick={() => setToolMode('stamps')}
					icon={<Stamp size={18} />}
				/>
			</TldrawUiToolbar>
		</div>
	)
}

function MainToolButton({
	icon,
	title,
	active,
	onClick,
}: {
	icon: ReactNode
	title: string
	active: boolean
	onClick: () => void
}) {
	return (
		<TldrawUiToolbarButton
			className="tldraw-contextual-toolbar__mainbutton"
			data-active={active}
			isActive={active}
			onClick={onClick}
			onTouchStart={(event) => {
				event.preventDefault()
				onClick()
			}}
			title={title}
			aria-label={title}
			type="tool"
		>
			{icon}
		</TldrawUiToolbarButton>
	)
}

function ToolChip({
	icon,
	label,
	active,
}: {
	icon: ReactNode
	label: string
	active?: boolean
}) {
	return (
		<div className="tldraw-contextual-toolbar__chip" data-active={active}>
			{icon}
			<span>{label}</span>
		</div>
	)
}

function SegmentGroup({
	children,
	label = 'Tool options',
}: {
	children: ReactNode
	label?: string
}) {
	return (
		<TldrawUiToolbar
			className="tldraw-contextual-toolbar__segment-group"
			label={label}
			orientation="horizontal"
		>
			{children}
		</TldrawUiToolbar>
	)
}

function SegmentButton({
	children,
	active,
	onClick,
	title,
}: {
	children: ReactNode
	active: boolean
	onClick: () => void
	title: string
}) {
	return (
		<TldrawUiToolbarButton
			className="tldraw-contextual-toolbar__segment"
			data-active={active}
			isActive={active}
			onClick={onClick}
			onTouchStart={(event) => {
				event.preventDefault()
				onClick()
			}}
			title={title}
			aria-label={title}
			type="icon"
		>
			{children}
		</TldrawUiToolbarButton>
	)
}
