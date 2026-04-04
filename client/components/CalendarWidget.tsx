import { useState, useEffect } from 'react'
import './CalendarWidget.css'

interface CalendarEvent {
	id: string
	title: string
	description?: string
	start: string
	end: string
	location?: string
	link?: string
	meetLink?: string
}

interface CalendarWidgetProps {
	userId: string
	isOpen: boolean
	onClose: () => void
}

export function CalendarWidget({ userId, isOpen, onClose }: CalendarWidgetProps) {
	const [events, setEvents] = useState<CalendarEvent[]>([])
	const [isConnected, setIsConnected] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const [showCreate, setShowCreate] = useState(false)
	const [newEvent, setNewEvent] = useState({ title: '', start: '', end: '', description: '' })

	useEffect(() => {
		if (isOpen && isConnected) {
			fetchEvents()
		}
	}, [isOpen, isConnected])

	const connectCalendar = async () => {
		try {
			const res = await fetch('/api/calendar/auth')
			const data = await res.json()
			if (data.authUrl) {
				window.open(data.authUrl, '_blank', 'width=500,height=600')
				// The callback will set isConnected
			}
		} catch (err) {
			console.error('Calendar auth error:', err)
		}
	}

	const fetchEvents = async () => {
		setIsLoading(true)
		try {
			const res = await fetch(`/api/calendar/events?userId=${userId}`)
			if (res.ok) {
				const data = await res.json()
				setEvents(data.events || [])
				setIsConnected(true)
			} else if (res.status === 401) {
				setIsConnected(false)
			}
		} catch (err) {
			console.error('Fetch events error:', err)
		} finally {
			setIsLoading(false)
		}
	}

	const createEvent = async () => {
		if (!newEvent.title || !newEvent.start || !newEvent.end) return
		try {
			await fetch('/api/calendar/events', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId,
					title: newEvent.title,
					start: new Date(newEvent.start).toISOString(),
					end: new Date(newEvent.end).toISOString(),
					description: newEvent.description,
				}),
			})
			setShowCreate(false)
			setNewEvent({ title: '', start: '', end: '', description: '' })
			fetchEvents()
		} catch (err) {
			console.error('Create event error:', err)
		}
	}

	const formatEventTime = (dateStr: string) => {
		const d = new Date(dateStr)
		const today = new Date()
		const isToday = d.toDateString() === today.toDateString()
		const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		if (isToday) return `Today ${time}`
		return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
	}

	const isEventSoon = (dateStr: string) => {
		const diff = new Date(dateStr).getTime() - Date.now()
		return diff > 0 && diff < 30 * 60 * 1000 // within 30 min
	}

	if (!isOpen) return null

	return (
		<div className="calendar-widget">
			<div className="calendar-widget__header">
				<div className="calendar-widget__header-left">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<rect x="3" y="4" width="18" height="18" rx="2" />
						<line x1="16" y1="2" x2="16" y2="6" />
						<line x1="8" y1="2" x2="8" y2="6" />
						<line x1="3" y1="10" x2="21" y2="10" />
					</svg>
					<span>Calendar</span>
				</div>
				<button className="calendar-widget__close" onClick={onClose}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			{!isConnected ? (
				<div className="calendar-widget__connect">
					<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
						<rect x="3" y="4" width="18" height="18" rx="2" />
						<line x1="16" y1="2" x2="16" y2="6" />
						<line x1="8" y1="2" x2="8" y2="6" />
						<line x1="3" y1="10" x2="21" y2="10" />
					</svg>
					<p>Connect Google Calendar</p>
					<p className="calendar-widget__connect-sub">View and create events from the board</p>
					<button className="calendar-widget__connect-btn" onClick={connectCalendar}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
							<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
							<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
							<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
							<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
						</svg>
						Connect Google Calendar
					</button>
				</div>
			) : (
				<div className="calendar-widget__content">
					<div className="calendar-widget__actions">
						<button className="calendar-widget__refresh" onClick={fetchEvents} disabled={isLoading}>
							{isLoading ? '⟳' : '↻'} Refresh
						</button>
						<button className="calendar-widget__create-btn" onClick={() => setShowCreate(!showCreate)}>
							+ New Event
						</button>
					</div>

					{showCreate && (
						<div className="calendar-widget__create-form">
							<input
								type="text"
								placeholder="Event title"
								value={newEvent.title}
								onChange={(e) => setNewEvent(prev => ({ ...prev, title: e.target.value }))}
							/>
							<input
								type="datetime-local"
								value={newEvent.start}
								onChange={(e) => setNewEvent(prev => ({ ...prev, start: e.target.value }))}
							/>
							<input
								type="datetime-local"
								value={newEvent.end}
								onChange={(e) => setNewEvent(prev => ({ ...prev, end: e.target.value }))}
							/>
							<button onClick={createEvent}>Create</button>
						</div>
					)}

					<div className="calendar-widget__events">
						{events.length === 0 ? (
							<div className="calendar-widget__no-events">No upcoming events</div>
						) : (
							events.map(event => (
								<div key={event.id} className={`calendar-event ${isEventSoon(event.start) ? 'calendar-event--soon' : ''}`}>
									<div className="calendar-event__time">{formatEventTime(event.start)}</div>
									<div className="calendar-event__title">{event.title}</div>
									{event.location && <div className="calendar-event__location">📍 {event.location}</div>}
									{event.meetLink && (
										<a href={event.meetLink} target="_blank" rel="noopener" className="calendar-event__meet">
											📹 Join Meet
										</a>
									)}
								</div>
							))
						)}
					</div>
				</div>
			)}
		</div>
	)
}
