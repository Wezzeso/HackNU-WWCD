import { useEffect, useMemo, useRef, useState } from 'react'
import { useImageGeneration } from '../hooks/useImageGeneration'
import './ImageGeneratorPanel.css'

interface ImageGeneratorPanelProps {
	isOpen: boolean
	onClose: () => void
	onPlaceImageOnCanvas?: (imageUrl: string) => void
	autoGenerateEnabled: boolean
	onAutoGenerateChange: (enabled: boolean) => void
	lastAutoPrompt?: string | null
	lastAutoSource?: 'audio' | 'text' | null
}

const ASPECT_RATIO_OPTIONS = [
	{ value: '16:9', label: '16:9 Landscape' },
	{ value: '4:3', label: '4:3 Default' },
	{ value: '1:1', label: '1:1 Square' },
	{ value: '3:4', label: '3:4 Portrait' },
	{ value: '9:16', label: '9:16 Story' },
] as const

function parseReferenceUrls(value: string) {
	return value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => /^https?:\/\//i.test(line))
}

function getStatusLabel(status: string) {
	switch (status) {
		case 'queued':
			return 'Queued'
		case 'processing':
			return 'Generating'
		case 'completed':
			return 'Complete'
		case 'failed':
			return 'Failed'
		case 'canceled':
			return 'Canceled'
		default:
			return 'Ready'
	}
}

export function ImageGeneratorPanel({
	isOpen,
	onClose,
	onPlaceImageOnCanvas,
	autoGenerateEnabled,
	onAutoGenerateChange,
	lastAutoPrompt,
	lastAutoSource,
}: ImageGeneratorPanelProps) {
	const promptRef = useRef<HTMLTextAreaElement>(null)
	const [prompt, setPrompt] = useState('')
	const [aspectRatio, setAspectRatio] = useState<'16:9' | '4:3' | '1:1' | '3:4' | '9:16'>('4:3')
	const [referenceUrls, setReferenceUrls] = useState('')
	const {
		isGenerating,
		imageUrl,
		error,
		status,
		jobId,
		generateImage,
		cancelGeneration,
		reset,
	} = useImageGeneration()

	useEffect(() => {
		if (!isOpen) {
			return
		}

		const timer = window.setTimeout(() => {
			promptRef.current?.focus()
		}, 40)

		return () => window.clearTimeout(timer)
	}, [isOpen])

	const isWorking = isGenerating || status === 'queued' || status === 'processing'
	const statusLabel = getStatusLabel(status)
	const normalizedReferenceUrls = useMemo(() => parseReferenceUrls(referenceUrls), [referenceUrls])

	const handleGenerate = async () => {
		const trimmedPrompt = prompt.trim()
		if (!trimmedPrompt || isWorking) {
			return
		}

		await generateImage(trimmedPrompt, {
			aspectRatio,
			imageUrls: normalizedReferenceUrls,
		})
	}

	const handleClose = async () => {
		if (isWorking) {
			await cancelGeneration()
		}
		onClose()
	}

	if (!isOpen) {
		return null
	}

	return (
		<div className="image-generator-backdrop" onClick={() => void handleClose()}>
			<div className="image-generator" onClick={(event) => event.stopPropagation()}>
				<div className="image-generator__header">
						<div>
						<div className="image-generator__eyebrow">Higgsfield Reve</div>
						<h2 className="image-generator__title">Image Generator AI</h2>
						<p className="image-generator__subtitle">
							Create images with Reve from text prompts or optional references. When auto mode is on, finalized voice transcripts and sent chat messages will generate images automatically.
						</p>
					</div>
					<button
						type="button"
						className="image-generator__close"
						onClick={() => void handleClose()}
						aria-label="Close image generator"
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<path d="M18 6L6 18M6 6l12 12" />
						</svg>
					</button>
				</div>

				<div className="image-generator__body">
					<form
						className="image-generator__form"
						onSubmit={(event) => {
							event.preventDefault()
							void handleGenerate()
						}}
					>
						<label className="image-generator__field">
							<span className="image-generator__label">Prompt</span>
							<textarea
								ref={promptRef}
								value={prompt}
								onChange={(event) => setPrompt(event.target.value)}
								placeholder="Describe the image you want to generate..."
								className="image-generator__textarea"
								rows={6}
							/>
						</label>

						<label className="image-generator__toggle image-generator__toggle--feature">
							<input
								type="checkbox"
								checked={autoGenerateEnabled}
								onChange={(event) => onAutoGenerateChange(event.target.checked)}
							/>
							<span className="image-generator__toggle-copy">
								<span className="image-generator__label">Auto Generate From Audio + Text</span>
								<span className="image-generator__hint">
									Use each finalized voice transcript and each sent chat message as a Reve prompt, then place the result on the board automatically.
								</span>
							</span>
						</label>

						<div className="image-generator__grid">
							<label className="image-generator__field">
								<span className="image-generator__label">Aspect Ratio</span>
								<select
									className="image-generator__select"
									value={aspectRatio}
									onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)}
								>
									{ASPECT_RATIO_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</label>
						</div>

						<label className="image-generator__field">
							<span className="image-generator__label">Reference Image URLs</span>
							<textarea
								value={referenceUrls}
								onChange={(event) => setReferenceUrls(event.target.value)}
								placeholder="Optional: paste one HTTPS image URL per line"
								className="image-generator__textarea image-generator__textarea--compact"
								rows={4}
							/>
							<span className="image-generator__hint">
								{normalizedReferenceUrls.length > 0
									? `${normalizedReferenceUrls.length} valid reference image URL${normalizedReferenceUrls.length === 1 ? '' : 's'} ready to send.`
									: 'Reference images are optional. Reve works best with a small set of strong visual references.'}
							</span>
						</label>

						<div className="image-generator__actions">
							<button
								type="submit"
								className="image-generator__primary"
								disabled={!prompt.trim() || isWorking}
							>
								{isWorking ? 'Generating...' : 'Generate Image'}
							</button>

							{isWorking ? (
								<button
									type="button"
									className="image-generator__secondary"
									onClick={() => void cancelGeneration()}
								>
									Cancel
								</button>
							) : null}

							<button
								type="button"
								className="image-generator__ghost"
								onClick={reset}
								disabled={isWorking && !imageUrl && !error}
							>
								Clear Result
							</button>
						</div>
					</form>

					<section className="image-generator__preview">
						<div className="image-generator__status-row">
							<span className={`image-generator__status image-generator__status--${status}`}>
								{statusLabel}
							</span>
							{autoGenerateEnabled ? (
								<span className="image-generator__auto-badge">Auto input mode on</span>
							) : null}
							{jobId ? (
								<span className="image-generator__request-id" title={jobId}>
									Request: {jobId}
								</span>
							) : null}
						</div>

						{error ? (
							<div className="image-generator__error">{error}</div>
						) : null}

						{lastAutoPrompt ? (
							<div className="image-generator__auto-card">
								<div className="image-generator__label">Latest Auto Prompt</div>
								<p>
									<strong>{lastAutoSource === 'audio' ? 'Audio' : 'Text'}:</strong> {lastAutoPrompt}
								</p>
							</div>
						) : null}

						<div className={`image-generator__preview-card ${isWorking ? 'image-generator__preview-card--loading' : ''}`}>
							{imageUrl ? (
								<img src={imageUrl} alt="AI generated result" className="image-generator__image" />
							) : (
								<div className="image-generator__empty">
									<div className="image-generator__empty-art" />
									<h3>Ready to generate</h3>
									<p>
										Enter a prompt manually, or leave auto mode on and let audio transcripts plus chat prompts generate images directly into the board workflow.
									</p>
								</div>
							)}
						</div>

						<div className="image-generator__preview-actions">
							<button
								type="button"
								className="image-generator__secondary"
								onClick={() => imageUrl && onPlaceImageOnCanvas?.(imageUrl)}
								disabled={!imageUrl}
							>
								Add To Board
							</button>
							<a
								className={`image-generator__link ${imageUrl ? '' : 'image-generator__link--disabled'}`}
								href={imageUrl ?? undefined}
								target="_blank"
								rel="noreferrer"
								onClick={(event) => {
									if (!imageUrl) {
										event.preventDefault()
									}
								}}
							>
								Open Full Size
							</a>
						</div>
					</section>
				</div>
			</div>
		</div>
	)
}
