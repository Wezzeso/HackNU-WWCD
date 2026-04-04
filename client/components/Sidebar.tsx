import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Bot, CalendarDays, MessageSquare, Music4, Send, Video } from 'lucide-react'
import { cn } from '../lib/utils'

export type PanelType = 'chat' | 'video' | 'gemini' | 'music' | 'calendar' | 'telegram' | null
export type ToolPanel = Exclude<PanelType, null>

interface SidebarProps {
	visiblePanels: Partial<Record<ToolPanel, boolean>>
	onPanelChange: (panel: ToolPanel) => void
	chatUnread: number
}

export const PANEL_TOOLS: Array<{
	id: ToolPanel
	label: string
	description: string
	color: string
	icon: LucideIcon
}> = [
	{
		id: 'chat',
		label: 'Chat',
		description: 'Messages and presence',
		color: 'hsl(217, 80%, 50%)',
		icon: MessageSquare,
	},
	{
		id: 'video',
		label: 'Video Call',
		description: 'Camera and screen share',
		color: 'hsl(142, 70%, 45%)',
		icon: Video,
	},
	{
		id: 'gemini',
		label: 'Gemini AI',
		description: 'Board-aware assistant',
		color: 'hsl(260, 80%, 55%)',
		icon: Bot,
	},
	{
		id: 'music',
		label: 'Music',
		description: 'Shared soundtrack',
		color: 'hsl(300, 70%, 50%)',
		icon: Music4,
	},
	{
		id: 'calendar',
		label: 'Calendar',
		description: 'Events and timing',
		color: 'hsl(45, 90%, 50%)',
		icon: CalendarDays,
	},
	{
		id: 'telegram',
		label: 'Telegram',
		description: 'Share room updates',
		color: 'hsl(199, 92%, 56%)',
		icon: Send,
	},
]

export function Sidebar({ visiblePanels, onPanelChange, chatUnread }: SidebarProps) {
	return (
		<div className="pointer-events-none absolute right-3 top-1/2 z-[950] -translate-y-1/2 md:right-4">
			<div className="pointer-events-auto flex flex-col gap-1.5 rounded-[22px] border border-border/70 bg-background/88 p-2 shadow-[0_8px_24px_rgba(15,23,42,0.07)] backdrop-blur-xl">
			{PANEL_TOOLS.map((tool) => {
				const Icon = tool.icon
				const isActive = !!visiblePanels[tool.id]

				return (
					<button
						key={tool.id}
						className={cn(
							'group relative flex h-11 w-11 items-center justify-center rounded-2xl border border-transparent text-muted-foreground transition-all duration-200 hover:border-border hover:bg-card hover:text-foreground',
							isActive && 'border-border/80 bg-card text-foreground'
						)}
						onClick={() => onPanelChange(tool.id)}
						title={tool.label}
						style={
							{
								backgroundColor: isActive
									? `color-mix(in srgb, ${tool.color} 10%, hsl(var(--card)) 90%)`
									: undefined,
							} as CSSProperties
						}
					>
						<span
							className="relative flex size-9 items-center justify-center rounded-xl"
							style={{
								background: `color-mix(in srgb, ${tool.color} 14%, transparent)`,
								color: tool.color,
							}}
						>
							<Icon size={18} strokeWidth={2} />
							{tool.id === 'chat' && chatUnread > 0 ? (
								<span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
									{chatUnread > 9 ? '9+' : chatUnread}
								</span>
							) : null}
						</span>
						<span className="pointer-events-none absolute right-[calc(100%+0.75rem)] hidden whitespace-nowrap rounded-full border border-border/70 bg-background/95 px-2.5 py-1 text-xs font-medium text-foreground shadow-[0_4px_14px_rgba(15,23,42,0.05)] group-hover:block">
							{tool.label}
						</span>
					</button>
				)
			})}
			</div>
		</div>
	)
}
