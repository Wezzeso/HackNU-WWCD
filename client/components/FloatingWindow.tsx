import { ReactNode, useEffect, useRef, useState } from 'react'
import { Grip, Minus, X } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { cn } from '../lib/utils'
import './FloatingWindow.css'

interface FloatingWindowProps {
	id: string
	title: string
	subtitle?: string
	accent: string
	visible: boolean
	zIndex: number
	defaultPosition: { x: number; y: number }
	defaultSize: { width: number; height: number }
	minSize?: { width?: number; height?: number }
	onHide: () => void
	onClose: () => void
	onFocus: () => void
	children: ReactNode
}

const MIN_WIDTH = 300
const MIN_HEIGHT = 220

export function FloatingWindow({
	id,
	title,
	subtitle,
	accent,
	visible,
	zIndex,
	defaultPosition,
	defaultSize,
	minSize,
	onHide,
	onClose,
	onFocus,
	children,
}: FloatingWindowProps) {
	const resolvedMinWidth = minSize?.width ?? MIN_WIDTH
	const resolvedMinHeight = minSize?.height ?? MIN_HEIGHT
	const [position, setPosition] = useState(defaultPosition)
	const [size, setSize] = useState(defaultSize)
	const dragState = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)
	const resizeState = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null)

	useEffect(() => {
		const handleMove = (event: PointerEvent) => {
			if (dragState.current) {
				const nextX = dragState.current.x + (event.clientX - dragState.current.startX)
				const nextY = dragState.current.y + (event.clientY - dragState.current.startY)
				setPosition({
					x: Math.max(12, nextX),
					y: Math.max(12, nextY),
				})
			}

			if (resizeState.current) {
				const nextWidth = resizeState.current.width + (event.clientX - resizeState.current.startX)
				const nextHeight = resizeState.current.height + (event.clientY - resizeState.current.startY)
				setSize({
					width: Math.max(resolvedMinWidth, nextWidth),
					height: Math.max(resolvedMinHeight, nextHeight),
				})
			}
		}

		const handleUp = () => {
			dragState.current = null
			resizeState.current = null
		}

		window.addEventListener('pointermove', handleMove)
		window.addEventListener('pointerup', handleUp)
		return () => {
			window.removeEventListener('pointermove', handleMove)
			window.removeEventListener('pointerup', handleUp)
		}
	}, [])

	const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
		onFocus()
		dragState.current = {
			startX: event.clientX,
			startY: event.clientY,
			x: position.x,
			y: position.y,
		}
	}

	const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault()
		event.stopPropagation()
		onFocus()
		resizeState.current = {
			startX: event.clientX,
			startY: event.clientY,
			width: size.width,
			height: size.height,
		}
	}

	return (
		<div
			data-window={id}
			className={cn(
				'floating-window absolute flex min-w-[300px] flex-col bg-transparent transition duration-200',
				visible ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-[0.97] opacity-0'
			)}
			style={{
				left: position.x,
				top: position.y,
				width: size.width,
				height: size.height,
				zIndex,
				['--floating-accent' as string]: accent,
			}}
			onPointerDown={onFocus}
		>
			<Card
				className={cn(
					'floating-window__card relative h-full overflow-hidden rounded-[30px] border border-border/70 bg-card/90 shadow-[0_12px_36px_rgba(2,6,23,0.10)] backdrop-blur-2xl'
				)}
			>
				<div
					className="pointer-events-none absolute inset-x-10 top-0 h-px opacity-90"
					style={{ background: accent }}
				/>
				<CardHeader
					className="floating-window__header flex flex-row items-center gap-3 border-b border-border/40 bg-background/42 px-4 py-4 backdrop-blur-xl"
					onPointerDown={handleDragStart}
				>
					<div
						className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-white/10"
						style={{
							background: `color-mix(in srgb, ${accent} 18%, hsl(var(--card)) 82%)`,
							color: accent,
						}}
					>
						<Grip size={16} />
					</div>
					<div className="floating-window__title-group">
						<CardTitle className="floating-window__title text-base font-semibold tracking-tight">{title}</CardTitle>
						{subtitle ? (
							<CardDescription className="floating-window__subtitle text-xs text-muted-foreground">
								{subtitle}
							</CardDescription>
						) : null}
					</div>
					<div
						className="floating-window__actions ml-auto flex items-center gap-2"
						onPointerDown={(event) => event.stopPropagation()}
					>
						<div
							className="hidden rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] md:inline-flex"
							style={{
								borderColor: `color-mix(in srgb, ${accent} 32%, hsl(var(--border)) 68%)`,
								color: accent,
								background: `color-mix(in srgb, ${accent} 12%, transparent)`,
							}}
						>
							Live
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="floating-window__action h-9 w-9 rounded-full"
							onClick={onHide}
							aria-label="Hide window"
						>
							<Minus size={16} />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="floating-window__action h-9 w-9 rounded-full"
							onClick={onClose}
							aria-label="Close window"
						>
							<X size={16} />
						</Button>
					</div>
				</CardHeader>
				<CardContent className="floating-window__body flex-1 min-h-0 p-0">{children}</CardContent>
				{visible ? (
					<button type="button" className="floating-window__resize-handle" onPointerDown={handleResizeStart} aria-label="Resize window" />
				) : null}
			</Card>
		</div>
	)
}
