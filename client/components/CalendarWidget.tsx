import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getLocalStorageItem, setLocalStorageItem } from '../localStorage'
import { supabase } from '../utils/supabase'
import './CalendarWidget.css'

type PlannerTag = 'deadline' | 'celebration' | 'simple'

interface PlannerEntry {
	id: string
	title: string
	time: string
	note: string
	tag: PlannerTag
}

interface PlannerEventRow {
	id: string
	user_id: string
	event_date: string
	event_time: string
	title: string
	note: string | null
	tag: PlannerTag
}

interface CalendarWidgetProps {
	userId: string
	isOpen: boolean
	onClose: () => void
}

const WEEK_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const EVENT_TAGS: Record<
	PlannerTag,
	{
		label: string
		description: string
		dotColor: string
		badgeClassName: string
		cardClassName: string
		optionClassName: string
	}
> = {
	deadline: {
		label: 'Deadline',
		description: 'Red',
		dotColor: '#dc2626',
		badgeClassName: 'calendar-widget__tag calendar-widget__tag--deadline',
		cardClassName: 'calendar-widget__entry calendar-widget__entry--deadline',
		optionClassName: 'calendar-widget__tag-option calendar-widget__tag-option--deadline',
	},
	celebration: {
		label: 'Birthday / Celebration',
		description: 'Blue',
		dotColor: '#2563eb',
		badgeClassName: 'calendar-widget__tag calendar-widget__tag--celebration',
		cardClassName: 'calendar-widget__entry calendar-widget__entry--celebration',
		optionClassName: 'calendar-widget__tag-option calendar-widget__tag-option--celebration',
	},
	simple: {
		label: 'Simple event',
		description: 'Dark / White',
		dotColor: '#111111',
		badgeClassName: 'calendar-widget__tag calendar-widget__tag--simple',
		cardClassName: 'calendar-widget__entry calendar-widget__entry--simple',
		optionClassName: 'calendar-widget__tag-option calendar-widget__tag-option--simple',
	},
}

function formatDateKey(date: Date) {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

function getMonthLabel(date: Date) {
	return date.toLocaleDateString([], { month: 'long', year: 'numeric' })
}

function getReadableDate(date: Date) {
	return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function getCalendarDays(month: Date) {
	const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1)
	const startOffset = (firstOfMonth.getDay() + 6) % 7
	const startDate = new Date(firstOfMonth)
	startDate.setDate(firstOfMonth.getDate() - startOffset)

	return Array.from({ length: 35 }, (_, index) => {
		const date = new Date(startDate)
		date.setDate(startDate.getDate() + index)
		return date
	})
}

function getSortedEntries(entries: PlannerEntry[]) {
	return [...entries].sort((a, b) => a.time.localeCompare(b.time))
}

function mapRowToEntry(row: PlannerEventRow): PlannerEntry {
	return {
		id: row.id,
		title: row.title,
		time: row.event_time.slice(0, 5),
		note: row.note ?? '',
		tag: row.tag,
	}
}

function groupRowsByDate(rows: PlannerEventRow[]) {
	return rows.reduce<Record<string, PlannerEntry[]>>((grouped, row) => {
		const dateKey = row.event_date
		grouped[dateKey] = getSortedEntries([...(grouped[dateKey] ?? []), mapRowToEntry(row)])
		return grouped
	}, {})
}

function normalizeEntriesRecord(rawValue: unknown) {
	if (!rawValue || typeof rawValue !== 'object') {
		return {}
	}

	return Object.fromEntries(
		Object.entries(rawValue as Record<string, unknown>).map(([dateKey, value]) => {
			const entries = Array.isArray(value) ? value : []
			const normalizedEntries = entries
				.map((entry) => {
					if (!entry || typeof entry !== 'object') return null
					const record = entry as Partial<PlannerEntry>
					if (typeof record.title !== 'string' || typeof record.time !== 'string') return null

					const normalizedTag: PlannerTag =
						record.tag === 'deadline' || record.tag === 'celebration' || record.tag === 'simple'
							? record.tag
							: 'simple'

					return {
						id:
							typeof record.id === 'string' && record.id.length > 0
								? record.id
								: `entry-${dateKey}-${record.time}-${record.title}`,
						title: record.title,
						time: record.time,
						note: typeof record.note === 'string' ? record.note : '',
						tag: normalizedTag,
					}
				})
				.filter((entry): entry is PlannerEntry => entry !== null)

			return [dateKey, getSortedEntries(normalizedEntries)]
		})
	)
}

function getDateFromKey(dateKey: string) {
	const [year, month, day] = dateKey.split('-').map(Number)
	return new Date(year, month - 1, day)
}

function getEntryDots(entries: PlannerEntry[]) {
	const seenTags = new Set<PlannerTag>()
	return entries
		.map((entry) => entry.tag)
		.filter((tag) => {
			if (seenTags.has(tag)) return false
			seenTags.add(tag)
			return true
		})
		.slice(0, 3)
}

export function CalendarWidget({ userId, isOpen }: CalendarWidgetProps) {
	const storageKey = `hacknu-planner-${userId}`
	const today = useMemo(() => new Date(), [])
	const [currentMonth, setCurrentMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
	const [selectedDateKey, setSelectedDateKey] = useState(() => formatDateKey(today))
	const [entriesByDate, setEntriesByDate] = useState<Record<string, PlannerEntry[]>>({})
	const [isLoading, setIsLoading] = useState(true)
	const [isSaving, setIsSaving] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [isModalOpen, setIsModalOpen] = useState(false)
	const [draftTitle, setDraftTitle] = useState('')
	const [draftTime, setDraftTime] = useState('10:00')
	const [draftNote, setDraftNote] = useState('')
	const [draftTag, setDraftTag] = useState<PlannerTag>('simple')

	useEffect(() => {
		let isCancelled = false

		const loadEntries = async () => {
			setIsLoading(true)
			setErrorMessage(null)

			const { data, error } = await supabase
				.from('planner_events')
				.select('id, user_id, event_date, event_time, title, note, tag')
				.eq('user_id', userId)
				.order('event_date', { ascending: true })
				.order('event_time', { ascending: true })

			if (!isCancelled) {
				if (error) {
					const cachedEntries = getLocalStorageItem(storageKey)
					if (cachedEntries) {
						try {
							setEntriesByDate(normalizeEntriesRecord(JSON.parse(cachedEntries)))
						} catch {
							setEntriesByDate({})
						}
					} else {
						setEntriesByDate({})
					}
					setErrorMessage('Supabase sync is unavailable right now.')
					setIsLoading(false)
					return
				}

				const groupedEntries = groupRowsByDate((data ?? []) as PlannerEventRow[])
				setEntriesByDate(groupedEntries)
				setIsLoading(false)
			}
		}

		loadEntries()
		return () => {
			isCancelled = true
		}
	}, [storageKey, userId])

	useEffect(() => {
		setLocalStorageItem(storageKey, JSON.stringify(entriesByDate))
	}, [entriesByDate, storageKey])

	useEffect(() => {
		if (!isModalOpen) return

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setIsModalOpen(false)
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [isModalOpen])

	const days = useMemo(() => getCalendarDays(currentMonth), [currentMonth])
	const selectedEntries = entriesByDate[selectedDateKey] ?? []
	const selectedDate = useMemo(() => getDateFromKey(selectedDateKey), [selectedDateKey])
	const isSelectedMonth = (date: Date) => date.getMonth() === currentMonth.getMonth()
	const todayKey = formatDateKey(today)

	const resetDraft = () => {
		setDraftTitle('')
		setDraftTime('10:00')
		setDraftNote('')
		setDraftTag('simple')
	}

	const openDayModal = (dateKey: string) => {
		setSelectedDateKey(dateKey)
		resetDraft()
		setIsModalOpen(true)
	}

	const handleAddEntry = async () => {
		const nextTitle = draftTitle.trim()
		if (!nextTitle || isSaving) return

		setIsSaving(true)
		setErrorMessage(null)

		const { data, error } = await supabase
			.from('planner_events')
			.insert({
				user_id: userId,
				event_date: selectedDateKey,
				event_time: `${draftTime}:00`,
				title: nextTitle,
				note: draftNote.trim() || null,
				tag: draftTag,
			})
			.select('id, user_id, event_date, event_time, title, note, tag')
			.single()

		if (error || !data) {
			setErrorMessage('Could not save this event to Supabase.')
			setIsSaving(false)
			return
		}

		const nextEntry = mapRowToEntry(data as PlannerEventRow)
		setEntriesByDate((prev) => ({
			...prev,
			[selectedDateKey]: getSortedEntries([...(prev[selectedDateKey] ?? []), nextEntry]),
		}))
		resetDraft()
		setIsSaving(false)
	}

	const handleRemoveEntry = async (entryId: string) => {
		if (isSaving) return

		setIsSaving(true)
		setErrorMessage(null)

		const { error } = await supabase
			.from('planner_events')
			.delete()
			.eq('id', entryId)
			.eq('user_id', userId)

		if (error) {
			setErrorMessage('Could not remove this event from Supabase.')
			setIsSaving(false)
			return
		}

		setEntriesByDate((prev) => {
			const nextEntries = (prev[selectedDateKey] ?? []).filter((entry) => entry.id !== entryId)
			const next = { ...prev }
			if (nextEntries.length === 0) {
				delete next[selectedDateKey]
			} else {
				next[selectedDateKey] = nextEntries
			}
			return next
		})
		setIsSaving(false)
	}

	if (!isOpen) return null

	return (
		<>
			<div className="calendar-widget">
				<div className="calendar-widget__shell">
					<div className="calendar-widget__monthbar">
						<button
							type="button"
							className="calendar-widget__nav"
							onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
							aria-label="Previous month"
						>
							<ChevronLeft size={16} />
						</button>
						<div className="calendar-widget__month">{getMonthLabel(currentMonth)}</div>
						<button
							type="button"
							className="calendar-widget__nav"
							onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
							aria-label="Next month"
						>
							<ChevronRight size={16} />
						</button>
					</div>

					<div className="calendar-widget__weekdays">
						{WEEK_DAYS.map((day) => (
							<div key={day} className="calendar-widget__weekday">
								{day}
							</div>
						))}
					</div>

					<div className="calendar-widget__grid">
						{days.map((date) => {
							const dateKey = formatDateKey(date)
							const isToday = dateKey === todayKey
							const isSelected = dateKey === selectedDateKey
							const dayEntries = entriesByDate[dateKey] ?? []
							const entryDots = getEntryDots(dayEntries)

							return (
								<button
									key={dateKey}
									type="button"
									onClick={() => openDayModal(dateKey)}
									className={[
										'calendar-widget__day',
										isSelected ? 'calendar-widget__day--selected' : '',
										!isSelectedMonth(date) ? 'calendar-widget__day--outside' : '',
										isToday ? 'calendar-widget__day--today' : '',
									]
										.filter(Boolean)
										.join(' ')}
								>
									<span>{date.getDate()}</span>
									{entryDots.length > 0 ? (
										<span className="calendar-widget__day-dots" aria-hidden="true">
											{entryDots.map((tag) => (
												<span
													key={tag}
													className="calendar-widget__day-dot"
													style={{ backgroundColor: EVENT_TAGS[tag].dotColor }}
												/>
											))}
										</span>
									) : null}
								</button>
							)
						})}
					</div>
				</div>
			</div>

			{isModalOpen ? (
				<div className="calendar-widget__modal-backdrop" onClick={() => setIsModalOpen(false)}>
					<div
						className="calendar-widget__modal"
						onClick={(event) => event.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-label={`Events for ${getReadableDate(selectedDate)}`}
					>
						<div className="calendar-widget__modal-head">
							<div>
								<div className="calendar-widget__modal-label">Events for</div>
								<div className="calendar-widget__modal-title">{getReadableDate(selectedDate)}</div>
								<div className="calendar-widget__modal-count">
									{isLoading ? 'Loading...' : `${selectedEntries.length} saved`}
								</div>
							</div>
							<button
								type="button"
								className="calendar-widget__modal-close"
								onClick={() => setIsModalOpen(false)}
								aria-label="Close event modal"
							>
								<X size={16} />
							</button>
						</div>

						<div className="calendar-widget__entry-form calendar-widget__entry-form--modal">
							<div className="calendar-widget__entry-row">
								<input
									type="text"
									value={draftTitle}
									onChange={(event) => setDraftTitle(event.target.value)}
									placeholder="Add event title"
									className="calendar-widget__input calendar-widget__input--title"
								/>
								<input
									type="time"
									value={draftTime}
									onChange={(event) => setDraftTime(event.target.value)}
									className="calendar-widget__input calendar-widget__input--time"
								/>
							</div>
							<input
								type="text"
								value={draftNote}
								onChange={(event) => setDraftNote(event.target.value)}
								placeholder="Optional note"
								className="calendar-widget__input"
							/>
							<div className="calendar-widget__tags">
								{(Object.keys(EVENT_TAGS) as PlannerTag[]).map((tag) => (
									<button
										key={tag}
										type="button"
										disabled={isSaving}
										className={`${EVENT_TAGS[tag].optionClassName} ${
											draftTag === tag ? 'calendar-widget__tag-option--active' : ''
										}`}
										onClick={() => setDraftTag(tag)}
									>
										<span
											className="calendar-widget__tag-option-dot"
											style={{ backgroundColor: EVENT_TAGS[tag].dotColor }}
										/>
										<span className="calendar-widget__tag-option-label">{EVENT_TAGS[tag].label}</span>
									</button>
								))}
							</div>
							<button
								type="button"
								className="calendar-widget__add"
								onClick={handleAddEntry}
								disabled={isSaving || isLoading}
							>
								<Plus size={14} />
								{isSaving ? 'Saving...' : 'Add event'}
							</button>
						</div>

						{errorMessage ? <div className="calendar-widget__status">{errorMessage}</div> : null}

						<div className="calendar-widget__modal-list">
							{isLoading ? (
								<div className="calendar-widget__empty">Loading events from Supabase...</div>
							) : selectedEntries.length === 0 ? (
								<div className="calendar-widget__empty">No events for this day yet</div>
							) : (
								selectedEntries.map((entry) => (
									<div key={entry.id} className={EVENT_TAGS[entry.tag].cardClassName}>
										<div className="calendar-widget__entry-main">
											<div className="calendar-widget__entry-topline">
												<div className="calendar-widget__entry-time">{entry.time}</div>
												<span className={EVENT_TAGS[entry.tag].badgeClassName}>{EVENT_TAGS[entry.tag].label}</span>
											</div>
											<div className="calendar-widget__entry-title">{entry.title}</div>
											{entry.note ? <div className="calendar-widget__entry-note">{entry.note}</div> : null}
										</div>
										<button
											type="button"
											className="calendar-widget__entry-remove"
											onClick={() => void handleRemoveEntry(entry.id)}
											aria-label={`Remove ${entry.title}`}
											disabled={isSaving}
										>
											Remove
										</button>
									</div>
								))
							)}
						</div>
					</div>
				</div>
			) : null}
		</>
	)
}
