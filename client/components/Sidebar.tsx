import { ReactNode } from 'react'
import './Sidebar.css'

export type PanelType = 'chat' | 'video' | 'gemini' | 'music' | 'calendar' | 'telegram' | null

interface SidebarProps {
	activePanel: PanelType
	onPanelChange: (panel: PanelType) => void
	chatUnread: number
}

const TOOLS: { id: PanelType; icon: ReactNode; label: string; color: string }[] = [
	{
		id: 'chat',
		label: 'Chat',
		color: 'hsl(217, 80%, 50%)',
		icon: (
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
			</svg>
		),
	},
	{
		id: 'video',
		label: 'Video Call',
		color: 'hsl(142, 70%, 45%)',
		icon: (
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<path d="m22 8-6 4 6 4V8ZM4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
			</svg>
		),
	},
	{
		id: 'gemini',
		label: 'Gemini AI',
		color: 'hsl(260, 80%, 55%)',
		icon: (
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
				<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
			</svg>
		),
	},
	{
		id: 'music',
		label: 'Music',
		color: 'hsl(300, 70%, 50%)',
		icon: (
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<path d="M9 18V5l12-2v13" />
				<circle cx="6" cy="18" r="3" />
				<circle cx="18" cy="16" r="3" />
			</svg>
		),
	},
	{
		id: 'calendar',
		label: 'Calendar',
		color: 'hsl(45, 90%, 50%)',
		icon: (
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<rect x="3" y="4" width="18" height="18" rx="2" />
				<line x1="16" y1="2" x2="16" y2="6" />
				<line x1="8" y1="2" x2="8" y2="6" />
				<line x1="3" y1="10" x2="21" y2="10" />
			</svg>
		),
	},
	{
		id: 'telegram',
		label: 'Telegram',
		color: 'hsl(199, 92%, 56%)',
		icon: (
			<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
				<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
			</svg>
		),
	},
]

export function Sidebar({ activePanel, onPanelChange, chatUnread }: SidebarProps) {
	return (
		<div className="sidebar">
			{TOOLS.map(tool => (
				<button
					key={tool.id}
					className={`sidebar__btn ${activePanel === tool.id ? 'sidebar__btn--active' : ''}`}
					onClick={() => onPanelChange(activePanel === tool.id ? null : tool.id)}
					title={tool.label}
					style={{ '--tool-color': tool.color } as React.CSSProperties}
				>
					{tool.icon}
					{tool.id === 'chat' && chatUnread > 0 && (
						<span className="sidebar__badge">{chatUnread > 9 ? '9+' : chatUnread}</span>
					)}
				</button>
			))}
		</div>
	)
}
