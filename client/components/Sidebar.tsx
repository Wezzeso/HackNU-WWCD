import { FileStack, Plus, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ImageGeneratorPanel } from './ImageGeneratorPanel'
import { VoiceVideoPanel } from './VoiceVideoPanel'
import { ModelSettings } from './ModelSettings'
import { KanbanPanel } from './KanbanPanel'
import type { AgentStatus } from '../hooks/useAgentSync'
import './ModelSettings.css'

interface SidebarProps {
	currentRoomId: string
	userId: string
	userName: string
	userColor: string
	activeUsers: Array<{ userId: string; userName: string; color: string }>
	pages: Array<{ id: string; name: string }>
	currentPageId: string | null
	agentStatus?: AgentStatus
	onSelectPage: (pageId: string) => void
	onAddPage: () => void
	onDeletePage: (pageId: string) => void
	onVoiceTranscript?: (text: string) => void
	onPlaceImageOnCanvas?: (imageUrl: string) => void
	autoGenerateImages: boolean
	onAutoGenerateImagesChange: (enabled: boolean) => void
	lastAutoImagePrompt?: string | null
	lastAutoImageSource?: 'audio' | 'text' | null
}

export function Sidebar({
	currentRoomId,
	userId,
	userName,
	userColor,
	activeUsers,
	pages,
	currentPageId,
	agentStatus,
	onSelectPage,
	onAddPage,
	onDeletePage,
	onVoiceTranscript,
	onPlaceImageOnCanvas,
	autoGenerateImages,
	onAutoGenerateImagesChange,
	lastAutoImagePrompt,
	lastAutoImageSource,
}: SidebarProps) {
	const [showModelSettings, setShowModelSettings] = useState(false)
	const [showImageGenerator, setShowImageGenerator] = useState(false)

	return (
		<aside className="flex h-full min-h-0 flex-col overflow-hidden border-r border-border bg-[#fbfbfa] p-3">
			<div className="rounded-xl bg-transparent p-2">
				<div className="flex items-center gap-3">
					<div
						className="flex size-11 items-center justify-center rounded-full text-sm font-bold text-white"
						style={{ background: userColor }}
					>
						{userName.charAt(0).toUpperCase()}
					</div>
					<div className="min-w-0 flex-1">
						<div className="workspace-title truncate text-[15px] font-semibold text-foreground">{userName}</div>
						<div className="text-xs text-muted-foreground">hacknu@workspace.so</div>
					</div>
					<button
						type="button"
						onClick={() => setShowImageGenerator(true)}
						className="rounded-lg border border-border/70 bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-secondary"
					>
						Image AI
					</button>
					<button
						type="button"
						onClick={() => setShowModelSettings(true)}
						className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-white hover:text-foreground"
						aria-label="AI Model Settings"
						title="AI Model Settings"
					>
						<Settings2 size={15} />
					</button>
				</div>
			</div>

			<div className="mt-4 px-2">
				<div className="mb-3 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
					<span>Voice Chat</span>
					<span>{activeUsers.length} online</span>
				</div>
				<VoiceVideoPanel
					roomId={currentRoomId}
					userId={userId}
					userName={userName}
					userColor={userColor}
					onTranscript={onVoiceTranscript}
				/>
			</div>

			<div className="mt-6 min-h-0 flex-none px-2">
				<div className="mb-3 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
					<span>Team Board</span>
					<span>shared</span>
				</div>
				<div className="h-[520px] max-h-[62vh] min-h-[420px]">
					<KanbanPanel
						roomId={currentRoomId}
						userId={userId}
						userName={userName}
						userColor={userColor}
					/>
				</div>
			</div>

			<div className="mt-4 min-h-0 flex-1 px-2">
				<div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
					<span className="flex items-center gap-2">
						<FileStack size={14} />
						Pages
					</span>
					<button
						type="button"
						onClick={onAddPage}
						className="flex size-6 items-center justify-center rounded-md border border-border/70 bg-white text-muted-foreground transition hover:text-foreground"
						aria-label="Add page"
						title="Add page"
					>
						<Plus size={14} />
					</button>
				</div>
				<div className="h-full min-h-0 space-y-2 overflow-y-auto pr-1">
					{pages.map((page) => (
						<div
							key={page.id}
							className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition ${
								currentPageId === page.id
									? 'bg-white shadow-sm ring-1 ring-border/60'
									: 'hover:bg-white/70'
							}`}
						>
							<button
								type="button"
								onClick={() => onSelectPage(page.id)}
								className={`min-w-0 flex-1 text-left ${
									currentPageId === page.id ? 'font-medium text-foreground' : 'text-muted-foreground'
								}`}
							>
								<span className="block truncate">{page.name}</span>
							</button>
							<button
								type="button"
								onClick={(event) => {
									event.stopPropagation()
									onDeletePage(page.id)
								}}
								disabled={pages.length <= 1}
								className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
								aria-label={`Delete ${page.name}`}
								title={pages.length <= 1 ? 'At least one page is required' : `Delete ${page.name}`}
							>
								<Trash2 size={13} />
							</button>
						</div>
					))}
				</div>
			</div>

			<ModelSettings isOpen={showModelSettings} onClose={() => setShowModelSettings(false)} />
			<ImageGeneratorPanel
				isOpen={showImageGenerator}
				onClose={() => setShowImageGenerator(false)}
				onPlaceImageOnCanvas={onPlaceImageOnCanvas}
				autoGenerateEnabled={autoGenerateImages}
				onAutoGenerateChange={onAutoGenerateImagesChange}
				lastAutoPrompt={lastAutoImagePrompt}
				lastAutoSource={lastAutoImageSource}
			/>
		</aside>
	)
}
