import {
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	Loader2,
	MessageCircleMore,
	MoreHorizontal,
	Plus,
	RefreshCw,
	Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getLocalStorageItem, setLocalStorageItem } from '../localStorage'
import { supabase } from '../utils/supabase'
import './KanbanPanel.css'

type KanbanStatus = 'todo' | 'in_progress' | 'done'
type KanbanPriority = 'low' | 'normal' | 'high'

interface KanbanTaskRow {
	id: string
	room_id: string
	title: string
	description: string | null
	status: KanbanStatus
	priority: KanbanPriority
	task_code: string | null
	due_label: string | null
	comments_count: number | null
	sort_order: number | null
	created_by: string
	created_by_name: string | null
	created_by_color: string | null
	created_at: string
	updated_at: string
}

interface KanbanTask {
	id: string
	title: string
	status: KanbanStatus
	priority: KanbanPriority
	taskCode: string
	dueLabel: string
	commentsCount: number
	sortOrder: number
	createdBy: string
	createdByName: string
	createdByColor: string
	createdAt: string
}

interface KanbanPanelProps {
	roomId: string
	userId: string
	userName: string
	userColor: string
}

const STATUS_COLUMNS: Array<{
	status: KanbanStatus
	label: string
	cardClassName: string
	pillClassName: string
}> = [
	{
		status: 'in_progress',
		label: 'In Progress',
		cardClassName: 'kanban-panel__task-card--progress',
		pillClassName: 'kanban-panel__pill kanban-panel__pill--progress',
	},
	{
		status: 'todo',
		label: 'Not Started',
		cardClassName: 'kanban-panel__task-card--todo',
		pillClassName: 'kanban-panel__pill kanban-panel__pill--todo',
	},
	{
		status: 'done',
		label: 'Done',
		cardClassName: 'kanban-panel__task-card--done',
		pillClassName: 'kanban-panel__pill kanban-panel__pill--done',
	},
]

const WORKFLOW_STATUSES: KanbanStatus[] = ['todo', 'in_progress', 'done']

const PRIORITY_META: Record<
	KanbanPriority,
	{
		label: string
		className: string
	}
> = {
	high: {
		label: 'High',
		className: 'kanban-panel__pill kanban-panel__pill--high',
	},
	normal: {
		label: 'Normal',
		className: 'kanban-panel__pill kanban-panel__pill--normal',
	},
	low: {
		label: 'Low',
		className: 'kanban-panel__pill kanban-panel__pill--low',
	},
}

function mapRowToTask(row: KanbanTaskRow): KanbanTask {
	return {
		id: row.id,
		title: row.title,
		status: row.status,
		priority: row.priority,
		taskCode: row.task_code ?? 'HN-TASK',
		dueLabel: row.due_label?.trim() || 'Today',
		commentsCount: row.comments_count ?? 0,
		sortOrder: row.sort_order ?? 0,
		createdBy: row.created_by,
		createdByName: row.created_by_name?.trim() || 'Team member',
		createdByColor: row.created_by_color?.trim() || '#cbd5e1',
		createdAt: row.created_at,
	}
}

function sortTasks(tasks: KanbanTask[]) {
	return [...tasks].sort((leftTask, rightTask) => {
		if (leftTask.status !== rightTask.status) {
			return getStatusIndex(leftTask.status) - getStatusIndex(rightTask.status)
		}

		if (leftTask.sortOrder !== rightTask.sortOrder) {
			return leftTask.sortOrder - rightTask.sortOrder
		}

		return leftTask.createdAt.localeCompare(rightTask.createdAt)
	})
}

function getStatusIndex(status: KanbanStatus) {
	return WORKFLOW_STATUSES.indexOf(status)
}

function normalizeTasks(rawValue: unknown) {
	if (!Array.isArray(rawValue)) {
		return []
	}

	return sortTasks(
		rawValue
			.map((task) => {
				if (!task || typeof task !== 'object') return null
				const row = task as Partial<KanbanTaskRow>

				if (
					typeof row.id !== 'string' ||
					typeof row.title !== 'string' ||
					typeof row.status !== 'string' ||
					typeof row.priority !== 'string' ||
					typeof row.created_by !== 'string' ||
					typeof row.created_at !== 'string'
				) {
					return null
				}

				if (
					row.status !== 'todo' &&
					row.status !== 'in_progress' &&
					row.status !== 'done'
				) {
					return null
				}

				if (row.priority !== 'low' && row.priority !== 'normal' && row.priority !== 'high') {
					return null
				}

				return mapRowToTask({
					id: row.id,
					room_id: typeof row.room_id === 'string' ? row.room_id : '',
					title: row.title,
					description: typeof row.description === 'string' ? row.description : null,
					status: row.status,
					priority: row.priority,
					task_code: typeof row.task_code === 'string' ? row.task_code : null,
					due_label: typeof row.due_label === 'string' ? row.due_label : null,
					comments_count: typeof row.comments_count === 'number' ? row.comments_count : 0,
					sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
					created_by: row.created_by,
					created_by_name: typeof row.created_by_name === 'string' ? row.created_by_name : null,
					created_by_color: typeof row.created_by_color === 'string' ? row.created_by_color : null,
					created_at: row.created_at,
					updated_at: typeof row.updated_at === 'string' ? row.updated_at : row.created_at,
				})
			})
			.filter((task): task is KanbanTask => task !== null)
	)
}

function getTaskInitials(name: string) {
	const initials = name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part.charAt(0).toUpperCase())
		.join('')

	return initials || 'TM'
}

export function KanbanPanel({ roomId, userId, userName, userColor }: KanbanPanelProps) {
	const storageKey = `hacknu-kanban-${roomId}`
	const [tasks, setTasks] = useState<KanbanTask[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [isSaving, setIsSaving] = useState(false)
	const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [isComposerOpen, setIsComposerOpen] = useState(false)
	const [refreshVersion, setRefreshVersion] = useState(0)
	const [draftTitle, setDraftTitle] = useState('')
	const [draftStatus, setDraftStatus] = useState<KanbanStatus>('in_progress')
	const [draftPriority, setDraftPriority] = useState<KanbanPriority>('high')
	const [draftDueLabel, setDraftDueLabel] = useState('Today')

	useEffect(() => {
		const handleRefresh = () => {
			setRefreshVersion((currentValue) => currentValue + 1)
		}

		window.addEventListener('hacknu:kanban-refresh', handleRefresh)
		return () => window.removeEventListener('hacknu:kanban-refresh', handleRefresh)
	}, [])

	useEffect(() => {
		let isCancelled = false

		const loadTasks = async () => {
			setIsLoading(true)
			setErrorMessage(null)

			const { data, error } = await supabase
				.from('kanban_tasks')
				.select(
					'id, room_id, title, description, status, priority, task_code, due_label, comments_count, sort_order, created_by, created_by_name, created_by_color, created_at, updated_at'
				)
				.eq('room_id', roomId)
				.order('status', { ascending: true })
				.order('sort_order', { ascending: true })
				.order('created_at', { ascending: true })

			if (isCancelled) return

			if (error) {
				const cachedTasks = getLocalStorageItem(storageKey)
				if (cachedTasks) {
					try {
						setTasks(normalizeTasks(JSON.parse(cachedTasks)))
					} catch {
						setTasks([])
					}
				} else {
					setTasks([])
				}
				setErrorMessage('Kanban sync is unavailable until the Supabase SQL is applied.')
				setIsLoading(false)
				return
			}

			setTasks(sortTasks(((data ?? []) as KanbanTaskRow[]).map(mapRowToTask)))
			setIsLoading(false)
		}

		void loadTasks()

		return () => {
			isCancelled = true
		}
	}, [refreshVersion, roomId, storageKey])

	useEffect(() => {
		setLocalStorageItem(storageKey, JSON.stringify(tasks))
	}, [storageKey, tasks])

	const groupedTasks = useMemo(() => {
		return STATUS_COLUMNS.reduce<Record<KanbanStatus, KanbanTask[]>>(
			(grouped, column) => {
				grouped[column.status] = tasks.filter((task) => task.status === column.status)
				return grouped
			},
			{
				todo: [],
				in_progress: [],
				done: [],
			}
		)
	}, [tasks])

	const totalTaskCount = tasks.length

	const resetDraft = (status: KanbanStatus = 'in_progress') => {
		setDraftTitle('')
		setDraftStatus(status)
		setDraftPriority(status === 'done' ? 'low' : status === 'todo' ? 'normal' : 'high')
		setDraftDueLabel('Today')
	}

	const openComposer = (status: KanbanStatus = 'in_progress') => {
		resetDraft(status)
		setErrorMessage(null)
		setIsComposerOpen(true)
	}

	const handleAddTask = async () => {
		const nextTitle = draftTitle.trim()
		if (!nextTitle || isSaving) return

		const nextSortOrder = groupedTasks[draftStatus].length
		setIsSaving(true)
		setActiveTaskId('creating')
		setErrorMessage(null)

		const { data, error } = await supabase
			.from('kanban_tasks')
			.insert({
				room_id: roomId,
				title: nextTitle,
				status: draftStatus,
				priority: draftPriority,
				due_label: draftDueLabel.trim() || null,
				comments_count: 0,
				sort_order: nextSortOrder,
				created_by: userId,
				created_by_name: userName,
				created_by_color: userColor,
			})
			.select(
				'id, room_id, title, description, status, priority, task_code, due_label, comments_count, sort_order, created_by, created_by_name, created_by_color, created_at, updated_at'
			)
			.single()

		if (error || !data) {
			setErrorMessage('Could not save this task to Supabase yet.')
			setIsSaving(false)
			setActiveTaskId(null)
			return
		}

		setTasks((currentTasks) => sortTasks([...currentTasks, mapRowToTask(data as KanbanTaskRow)]))
		setIsComposerOpen(false)
		resetDraft()
		setIsSaving(false)
		setActiveTaskId(null)
		window.dispatchEvent(new CustomEvent('hacknu:kanban-refresh'))
	}

	const handleMoveTask = async (task: KanbanTask, direction: 'back' | 'forward') => {
		if (isSaving) return

		const currentStatusIndex = getStatusIndex(task.status)
		const nextStatusIndex =
			direction === 'forward'
				? Math.min(WORKFLOW_STATUSES.length - 1, currentStatusIndex + 1)
				: Math.max(0, currentStatusIndex - 1)

		if (nextStatusIndex === currentStatusIndex) return

		const nextStatus = WORKFLOW_STATUSES[nextStatusIndex]
		const nextSortOrder = groupedTasks[nextStatus].length

		setIsSaving(true)
		setActiveTaskId(task.id)
		setErrorMessage(null)

		const { error } = await supabase
			.from('kanban_tasks')
			.update({
				status: nextStatus,
				sort_order: nextSortOrder,
			})
			.eq('id', task.id)

		if (error) {
			setErrorMessage('Could not move this task right now.')
			setIsSaving(false)
			setActiveTaskId(null)
			return
		}

		setTasks((currentTasks) =>
			sortTasks(
				currentTasks.map((currentTask) =>
					currentTask.id === task.id
						? {
								...currentTask,
								status: nextStatus,
								sortOrder: nextSortOrder,
							}
						: currentTask
				)
			)
		)
		setIsSaving(false)
		setActiveTaskId(null)
		window.dispatchEvent(new CustomEvent('hacknu:kanban-refresh'))
	}

	const handleDeleteTask = async (taskId: string) => {
		if (isSaving) return

		setIsSaving(true)
		setActiveTaskId(taskId)
		setErrorMessage(null)

		const { error } = await supabase.from('kanban_tasks').delete().eq('id', taskId)

		if (error) {
			setErrorMessage('Could not delete this task right now.')
			setIsSaving(false)
			setActiveTaskId(null)
			return
		}

		setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId))
		setIsSaving(false)
		setActiveTaskId(null)
		window.dispatchEvent(new CustomEvent('hacknu:kanban-refresh'))
	}

	return (
		<div className="kanban-panel">
			<div className="kanban-panel__frame">
				<div className="kanban-panel__toolbar">
					<button
						type="button"
						className="kanban-panel__icon-button"
						onClick={() => setRefreshVersion((currentValue) => currentValue + 1)}
						aria-label="Refresh kanban"
						title="Refresh"
					>
						<RefreshCw size={15} />
					</button>
					<div className="kanban-panel__toolbar-copy">
						<div className="kanban-panel__toolbar-title">Shared Kanban</div>
						<div className="kanban-panel__toolbar-subtitle">{totalTaskCount} active tasks</div>
					</div>
					<button
						type="button"
						className="kanban-panel__icon-button"
						aria-label="Kanban options"
						title="Kanban options"
						disabled
					>
						<MoreHorizontal size={15} />
					</button>
					<button
						type="button"
						className="kanban-panel__icon-button"
						onClick={() => openComposer()}
						aria-label="Add task"
						title="Add task"
					>
						<Plus size={15} />
					</button>
				</div>

				{errorMessage ? <div className="kanban-panel__status">{errorMessage}</div> : null}

				<div className="kanban-panel__columns">
					{STATUS_COLUMNS.map((column) => (
						<section key={column.status} className="kanban-panel__column">
							<div className="kanban-panel__column-header">
								<div className="kanban-panel__column-title">{column.label}</div>
								<div className="kanban-panel__column-actions">
									<span className="kanban-panel__column-count">{groupedTasks[column.status].length}</span>
									<button
										type="button"
										className="kanban-panel__column-add"
										onClick={() => openComposer(column.status)}
										aria-label={`Add task to ${column.label}`}
										title={`Add task to ${column.label}`}
									>
										<Plus size={14} />
									</button>
								</div>
							</div>

							<div className="kanban-panel__task-list">
								{isLoading ? (
									<div className="kanban-panel__empty">
										<Loader2 size={16} className="kanban-panel__spinner" />
										<span>Loading tasks...</span>
									</div>
								) : groupedTasks[column.status].length > 0 ? (
									groupedTasks[column.status].map((task) => (
										<article
											key={task.id}
											className={`kanban-panel__task-card ${column.cardClassName}`}
										>
											<div className="kanban-panel__task-topline">
												<div className="kanban-panel__pill-row">
													<span className={column.pillClassName}>{column.label}</span>
													<span className={PRIORITY_META[task.priority].className}>
														{PRIORITY_META[task.priority].label}
													</span>
												</div>
												<button
													type="button"
													className="kanban-panel__card-delete"
													onClick={() => void handleDeleteTask(task.id)}
													disabled={isSaving}
													aria-label={`Delete ${task.title}`}
													title="Delete task"
												>
													{activeTaskId === task.id && isSaving ? (
														<Loader2 size={14} className="kanban-panel__spinner" />
													) : (
														<Trash2 size={14} />
													)}
												</button>
											</div>

											<div className="kanban-panel__task-title">{task.title}</div>
											<div className="kanban-panel__task-code">{task.taskCode}</div>

											<div className="kanban-panel__task-footer">
												<div className="kanban-panel__task-meta">
													<div
														className="kanban-panel__avatar"
														style={{ background: task.createdByColor }}
														title={task.createdByName}
													>
														{getTaskInitials(task.createdByName)}
													</div>
													<span className="kanban-panel__task-owner">{task.createdByName}</span>
												</div>
												<div className="kanban-panel__task-badges">
													<span className="kanban-panel__task-chip">
														<CalendarDays size={12} />
														{task.dueLabel}
													</span>
													<span className="kanban-panel__task-chip">
														<MessageCircleMore size={12} />
														{task.commentsCount}
													</span>
												</div>
											</div>

											<div className="kanban-panel__task-actions">
												<button
													type="button"
													className="kanban-panel__move-button"
													onClick={() => void handleMoveTask(task, 'back')}
													disabled={isSaving || getStatusIndex(task.status) === 0}
													aria-label={`Move ${task.title} backward`}
												>
													<ChevronLeft size={14} />
												</button>
												<button
													type="button"
													className="kanban-panel__move-button"
													onClick={() => void handleMoveTask(task, 'forward')}
													disabled={isSaving || getStatusIndex(task.status) === WORKFLOW_STATUSES.length - 1}
													aria-label={`Move ${task.title} forward`}
												>
													<ChevronRight size={14} />
												</button>
											</div>
										</article>
									))
								) : (
									<div className="kanban-panel__empty">
										<span>No tasks yet.</span>
									</div>
								)}
							</div>
						</section>
					))}
				</div>

				<div className="kanban-panel__composer-shell">
					{isComposerOpen ? (
						<div className="kanban-panel__composer">
							<input
								type="text"
								value={draftTitle}
								onChange={(event) => setDraftTitle(event.target.value)}
								className="kanban-panel__input"
								placeholder="Contents layout"
								aria-label="Task title"
							/>
							<div className="kanban-panel__composer-grid">
								<select
									value={draftStatus}
									onChange={(event) => setDraftStatus(event.target.value as KanbanStatus)}
									className="kanban-panel__input"
									aria-label="Task status"
								>
									{WORKFLOW_STATUSES.map((status) => (
										<option key={status} value={status}>
											{STATUS_COLUMNS.find((column) => column.status === status)?.label ?? status}
										</option>
									))}
								</select>
								<select
									value={draftPriority}
									onChange={(event) => setDraftPriority(event.target.value as KanbanPriority)}
									className="kanban-panel__input"
									aria-label="Task priority"
								>
									<option value="high">High</option>
									<option value="normal">Normal</option>
									<option value="low">Low</option>
								</select>
							</div>
							<input
								type="text"
								value={draftDueLabel}
								onChange={(event) => setDraftDueLabel(event.target.value)}
								className="kanban-panel__input"
								placeholder="Today"
								aria-label="Due label"
							/>
							<div className="kanban-panel__composer-actions">
								<button
									type="button"
									className="kanban-panel__secondary-button"
									onClick={() => setIsComposerOpen(false)}
									disabled={isSaving}
								>
									Cancel
								</button>
								<button
									type="button"
									className="kanban-panel__primary-button"
									onClick={() => void handleAddTask()}
									disabled={isSaving || draftTitle.trim().length === 0}
								>
									{activeTaskId === 'creating' && isSaving ? 'Saving...' : 'Create task'}
								</button>
							</div>
						</div>
					) : (
						<button
							type="button"
							className="kanban-panel__add-task"
							onClick={() => openComposer()}
						>
							<Plus size={15} />
							Add Task
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
