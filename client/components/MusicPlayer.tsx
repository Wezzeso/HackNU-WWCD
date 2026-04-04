import { ExternalLink, ListMusic, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getLocalStorageItem, setLocalStorageItem } from '../localStorage'
import { useMusicSync } from '../hooks/useMusicSync'
import './MusicPlayer.css'

interface MusicPlayerProps {
	roomId: string
	userId: string
	userName: string
	isOpen: boolean
	onClose: () => void
}

const FALLBACK_DURATION = 180
const DEFAULT_VOLUME = 72

function formatTime(seconds: number) {
	const safe = Math.max(0, Math.floor(seconds))
	const minutes = Math.floor(safe / 60)
	const remainder = safe % 60
	return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function getTrackDisplayTitle(title: string | undefined, youtubeId: string | undefined) {
	if (!title || title.startsWith('http')) {
		return youtubeId ? `Track ${youtubeId.slice(0, 6)}` : 'Shared track'
	}
	return title
}

export function MusicPlayer({ roomId, userId, userName, isOpen }: MusicPlayerProps) {
	const { state, addTrack, togglePlayPause, seek, skip, removeTrack } = useMusicSync(roomId, userId, userName)
	const [showQueue, setShowQueue] = useState(false)
	const [showVolumePopover, setShowVolumePopover] = useState(false)
	const [youtubeUrl, setYoutubeUrl] = useState('')
	const [elapsed, setElapsed] = useState(state.position)
	const [previewPosition, setPreviewPosition] = useState<number | null>(null)
	const [localVolume, setLocalVolume] = useState(DEFAULT_VOLUME)
	const [isMuted, setIsMuted] = useState(false)
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const queueRef = useRef<HTMLDivElement>(null)
	const lastVolumeBeforeMuteRef = useRef(DEFAULT_VOLUME)
	const volumeStorageKey = `hacknu-music-volume-${userId}`
	const muteStorageKey = `hacknu-music-muted-${userId}`

	useEffect(() => {
		setElapsed(state.position)
	}, [state.position, state.currentTrack?.id])

	useEffect(() => {
		if (!state.isPlaying) return

		const interval = window.setInterval(() => {
			setElapsed((prev) => prev + 1)
		}, 1000)

		return () => window.clearInterval(interval)
	}, [state.isPlaying])

	useEffect(() => {
		if (!showQueue) return

		const handlePointerDown = (event: MouseEvent) => {
			if (!queueRef.current?.contains(event.target as Node)) {
				setShowQueue(false)
			}
		}

		window.addEventListener('mousedown', handlePointerDown)
		return () => window.removeEventListener('mousedown', handlePointerDown)
	}, [showQueue])

	useEffect(() => {
		const savedVolume = Number(getLocalStorageItem(volumeStorageKey))
		const savedMuted = getLocalStorageItem(muteStorageKey) === 'true'
		if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 100) {
			setLocalVolume(savedVolume)
			if (savedVolume > 0) {
				lastVolumeBeforeMuteRef.current = savedVolume
			}
		}
		setIsMuted(savedMuted)
	}, [muteStorageKey, volumeStorageKey])

	useEffect(() => {
		setLocalStorageItem(volumeStorageKey, String(localVolume))
	}, [localVolume, volumeStorageKey])

	useEffect(() => {
		setLocalStorageItem(muteStorageKey, String(isMuted))
	}, [isMuted, muteStorageKey])

	const sendPlayerCommand = (func: string, args: unknown[] = []) => {
		const target = iframeRef.current?.contentWindow
		if (!target) return

		target.postMessage(
			JSON.stringify({
				event: 'command',
				func,
				args,
			}),
			'*'
		)
	}

	useEffect(() => {
		if (!state.currentTrack) return

		const effectiveVolume = isMuted ? 0 : localVolume
		const timer = window.setTimeout(() => {
			if (effectiveVolume <= 0) {
				sendPlayerCommand('mute')
			} else {
				sendPlayerCommand('unMute')
				sendPlayerCommand('setVolume', [effectiveVolume])
			}
		}, 500)

		return () => window.clearTimeout(timer)
	}, [isMuted, localVolume, state.currentTrack?.id])

	const extractYoutubeId = (url: string): string | null => {
		const patterns = [
			/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?#]+)/,
			/^([a-zA-Z0-9_-]{11})$/,
		]
		for (const pattern of patterns) {
			const match = url.match(pattern)
			if (match) return match[1]
		}
		return null
	}

	const handleAddTrack = () => {
		const ytId = extractYoutubeId(youtubeUrl)
		if (!ytId) return

		addTrack(`Track ${ytId.slice(0, 6)}`, ytId, undefined, `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`)
		setYoutubeUrl('')
	}

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'Enter') {
			handleAddTrack()
		}
	}

	const handleVolumeChange = (nextVolume: number) => {
		const clamped = Math.max(0, Math.min(100, nextVolume))
		setLocalVolume(clamped)

		if (clamped > 0) {
			lastVolumeBeforeMuteRef.current = clamped
		}

		setIsMuted(clamped === 0)
	}

	const handleMuteToggle = () => {
		if (isMuted || localVolume === 0) {
			const restoredVolume = Math.max(lastVolumeBeforeMuteRef.current, 1)
			setLocalVolume(restoredVolume)
			setIsMuted(false)
			return
		}

		lastVolumeBeforeMuteRef.current = localVolume
		setIsMuted(true)
	}

	const handleSeekChange = (nextPosition: number) => {
		const clamped = Math.max(0, Math.min(totalDuration, nextPosition))
		setPreviewPosition(clamped)
	}

	const handleSeekCommit = (nextPosition?: number) => {
		const targetPosition = Math.max(0, Math.min(totalDuration, nextPosition ?? previewPosition ?? elapsed))
		setPreviewPosition(null)
		setElapsed(targetPosition)
		sendPlayerCommand('seekTo', [targetPosition, true])
		seek(targetPosition)
	}

	const totalDuration = state.currentTrack?.duration ?? FALLBACK_DURATION
	const displayedPosition = previewPosition ?? elapsed
	const progress = Math.max(0, Math.min(100, (displayedPosition / totalDuration) * 100))
	const remaining = Math.max(0, totalDuration - displayedPosition)
	const currentTitle = getTrackDisplayTitle(state.currentTrack?.title, state.currentTrack?.youtubeId)
	const youtubeLink = state.currentTrack ? `https://www.youtube.com/watch?v=${state.currentTrack.youtubeId}` : null
	const hasTrack = !!state.currentTrack
	const displayedVolume = isMuted ? 0 : localVolume

	if (!isOpen) return null

	return (
		<div className={`music-player ${hasTrack ? 'music-player--active' : 'music-player--empty-state'}`}>
			<div className="music-player__body" ref={queueRef}>
				{hasTrack ? (
					<div className="music-player__compact-card">
						<div className="music-player__toolbar">
							<div className="music-player__toolbar-group">
								<button type="button" className="music-player__toolbar-button" aria-label="Shuffle">
									<Shuffle size={14} />
								</button>
								<button type="button" className="music-player__toolbar-button" aria-label="Repeat">
									<Repeat2 size={14} />
								</button>
							</div>

							<div className="music-player__transport">
								<button type="button" className="music-player__transport-button" disabled aria-label="Previous track">
									<SkipBack size={16} />
								</button>
								<button
									type="button"
									className="music-player__transport-button music-player__transport-button--primary"
									onClick={() => togglePlayPause()}
									disabled={!state.currentTrack}
									aria-label={state.isPlaying ? 'Pause' : 'Play'}
								>
									{state.isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
								</button>
								<button type="button" className="music-player__transport-button" onClick={skip} disabled={!state.currentTrack} aria-label="Next track">
									<SkipForward size={16} />
								</button>
							</div>

							<div
								className={`music-player__volume-control ${showVolumePopover ? 'music-player__volume-control--open' : ''}`}
								onMouseEnter={() => setShowVolumePopover(true)}
								onMouseLeave={() => setShowVolumePopover(false)}
							>
								<div className="music-player__toolbar-volume">
									<span className="music-player__volume-value">{displayedVolume}%</span>
									<button
										type="button"
										className="music-player__volume-button"
										onClick={handleMuteToggle}
										aria-label={isMuted ? 'Unmute' : 'Mute'}
									>
										{isMuted || displayedVolume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
									</button>
								</div>

								<div className="music-player__volume-popover">
									<div className="music-player__volume-popover-label">Volume</div>
									<input
										type="range"
										min="0"
										max="100"
										value={displayedVolume}
										onChange={(event) => handleVolumeChange(parseInt(event.target.value, 10))}
										className="music-player__volume-slider music-player__volume-slider--popover"
									/>
								</div>
							</div>
						</div>

						<div className="music-player__track-row">
							<div className="music-player__cover-thumb">
								{state.currentTrack?.thumbnail ? <img src={state.currentTrack.thumbnail} alt={currentTitle} /> : <div className="music-player__cover-placeholder">♪</div>}
							</div>

							<div className="music-player__track-main">
								<div className="music-player__track-title">{currentTitle}</div>
								<div className="music-player__track-subtitle">
									{state.currentTrack ? `${state.currentTrack.addedByName} · ${state.currentTrack.youtubeId}` : 'Shared room soundtrack'}
								</div>

								<div className="music-player__progress-row">
									<span>{formatTime(displayedPosition)}</span>
									<div className="music-player__progress" style={{ ['--music-progress' as string]: `${progress}%` }}>
										<div className="music-player__progress-fill" style={{ width: `${progress}%` }} />
										<input
											type="range"
											min="0"
											max={totalDuration}
											step="1"
											value={displayedPosition}
											onChange={(event) => handleSeekChange(parseInt(event.target.value, 10))}
											onPointerUp={() => handleSeekCommit()}
											onBlur={() => handleSeekCommit()}
											onKeyUp={(event) => {
												if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End' || event.key === 'PageUp' || event.key === 'PageDown') {
													handleSeekCommit(parseInt((event.currentTarget as HTMLInputElement).value, 10))
												}
											}}
											className="music-player__progress-slider"
											aria-label="Seek song position"
										/>
									</div>
									<span>{state.currentTrack ? `-${formatTime(remaining)}` : '--:--'}</span>
								</div>
							</div>

							<div className="music-player__side-actions">
								<button
									type="button"
									className={`music-player__queue-toggle ${showQueue ? 'music-player__queue-toggle--active' : ''}`}
									onClick={() => setShowQueue((prev) => !prev)}
									aria-label="Show queue"
								>
									<ListMusic size={18} />
								</button>
								<a
									className={`music-player__open-link ${youtubeLink ? '' : 'music-player__open-link--disabled'}`}
									href={youtubeLink ?? undefined}
									target="_blank"
									rel="noreferrer"
									aria-label="Open on YouTube"
									onClick={(event) => {
										if (!youtubeLink) event.preventDefault()
									}}
								>
									<ExternalLink size={14} />
								</a>
							</div>
						</div>
					</div>
				) : (
					<div className="music-player__empty-card">
						<div className="music-player__empty-icon">♪</div>
						<div className="music-player__empty-content">
							<div className="music-player__empty-title">No video selected</div>
							<div className="music-player__empty-copy">
								Paste a YouTube link below to load the compact player.
							</div>
						</div>
					</div>
				)}

				{state.currentTrack && (
					<iframe
						ref={iframeRef}
						className="music-player__iframe"
						src={`https://www.youtube.com/embed/${state.currentTrack.youtubeId}?autoplay=${state.isPlaying ? 1 : 0}&enablejsapi=1&playsinline=1&origin=${encodeURIComponent(window.location.origin)}`}
						allow="autoplay"
						title="YouTube Player"
					/>
				)}

				<div className="music-player__add">
					<input
						type="text"
						value={youtubeUrl}
						onChange={(event) => setYoutubeUrl(event.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Paste YouTube URL"
						className="music-player__add-input"
					/>
					<button type="button" className="music-player__add-btn" onClick={handleAddTrack} disabled={!youtubeUrl.trim()}>
						Add
					</button>
				</div>

				{showQueue ? (
					<div className="music-player__queue-viewer">
						<div className="music-player__queue-header">
							<div className="music-player__queue-heading">Queue</div>
							<div className="music-player__queue-actions">
								{youtubeLink ? (
									<a className="music-player__queue-open" href={youtubeLink} target="_blank" rel="noreferrer" aria-label="Open on YouTube">
										<ExternalLink size={13} />
									</a>
								) : null}
								<button type="button" className="music-player__queue-close" onClick={() => setShowQueue(false)} aria-label="Close queue">
									<X size={14} />
								</button>
							</div>
						</div>

						<div className="music-player__queue">
							{state.queue.length === 0 ? (
								<div className="music-player__queue-empty">Queue is empty</div>
							) : (
								state.queue.slice(0, 4).map((track) => (
									<div key={track.id} className="music-player__queue-item">
										<div className="music-player__queue-art">
											{track.thumbnail ? <img src={track.thumbnail} alt="" /> : <span>♪</span>}
										</div>
										<div className="music-player__queue-info">
											<span className="music-player__queue-title">{getTrackDisplayTitle(track.title, track.youtubeId)}</span>
											<span className="music-player__queue-by">{track.addedByName}</span>
										</div>
										{track.addedBy === userId ? (
											<button type="button" className="music-player__queue-remove" onClick={() => removeTrack(track.id)}>
												Remove
											</button>
										) : null}
									</div>
								))
							)}
						</div>
					</div>
				) : null}
			</div>
		</div>
	)
}
