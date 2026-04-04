import { useState, useRef, useEffect, useCallback } from 'react'
import { useMusicSync, type Track } from '../hooks/useMusicSync'
import './MusicPlayer.css'

interface MusicPlayerProps {
	roomId: string
	userId: string
	userName: string
	isOpen: boolean
	onClose: () => void
}

export function MusicPlayer({ roomId, userId, userName, isOpen, onClose }: MusicPlayerProps) {
	const { state, addTrack, togglePlayPause, skip, setVolume, removeTrack, isConnected } = useMusicSync(roomId, userId, userName)
	const [searchQuery, setSearchQuery] = useState('')
	const [showQueue, setShowQueue] = useState(false)
	const [youtubeUrl, setYoutubeUrl] = useState('')
	const playerRef = useRef<HTMLIFrameElement>(null)

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

		addTrack(youtubeUrl, ytId, undefined, `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`)
		setYoutubeUrl('')
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			handleAddTrack()
		}
	}

	if (!isOpen) return null

	return (
		<div className="music-player">
			<div className="music-player__header">
				<div className="music-player__header-left">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M9 18V5l12-2v13" />
						<circle cx="6" cy="18" r="3" />
						<circle cx="18" cy="16" r="3" />
					</svg>
					<span>Music</span>
					{isConnected && <span className="music-player__connected">●</span>}
				</div>
				<button className="music-player__close" onClick={onClose}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			{/* Now Playing */}
			<div className="music-player__now-playing">
				{state.currentTrack ? (
					<>
						<div className="music-player__thumbnail">
							{state.currentTrack.thumbnail ? (
								<img src={state.currentTrack.thumbnail} alt="" />
							) : (
								<div className="music-player__thumbnail-placeholder">🎵</div>
							)}
							{state.isPlaying && (
								<div className="music-player__visualizer">
									<span /><span /><span /><span />
								</div>
							)}
						</div>
						<div className="music-player__info">
							<div className="music-player__title">{state.currentTrack.title || 'Playing...'}</div>
							<div className="music-player__added-by">Added by {state.currentTrack.addedByName}</div>
						</div>
					</>
				) : (
					<div className="music-player__empty">
						<span>🎵</span>
						<p>No track playing</p>
					</div>
				)}
			</div>

			{/* YouTube Player (hidden, for audio) */}
			{state.currentTrack && (
				<iframe
					ref={playerRef}
					className="music-player__iframe"
					src={`https://www.youtube.com/embed/${state.currentTrack.youtubeId}?autoplay=${state.isPlaying ? 1 : 0}&enablejsapi=1`}
					allow="autoplay"
					title="YouTube Player"
				/>
			)}

			{/* Controls */}
			<div className="music-player__controls">
				<button className="music-control" onClick={() => togglePlayPause()} disabled={!state.currentTrack}>
					{state.isPlaying ? (
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
							<rect x="6" y="4" width="4" height="16" />
							<rect x="14" y="4" width="4" height="16" />
						</svg>
					) : (
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
							<polygon points="5,3 19,12 5,21" />
						</svg>
					)}
				</button>

				<button className="music-control" onClick={skip} disabled={!state.currentTrack} title="Vote to skip">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
						<polygon points="5,4 15,12 5,20" />
						<line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" />
					</svg>
				</button>

				<div className="music-player__volume">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
						<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
					</svg>
					<input
						type="range"
						min="0"
						max="100"
						value={state.volume}
						onChange={(e) => setVolume(parseInt(e.target.value))}
						className="music-player__volume-slider"
					/>
				</div>
			</div>

			{/* Add Track */}
			<div className="music-player__add">
				<input
					type="text"
					value={youtubeUrl}
					onChange={(e) => setYoutubeUrl(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Paste YouTube URL..."
					className="music-player__add-input"
				/>
				<button className="music-player__add-btn" onClick={handleAddTrack} disabled={!youtubeUrl.trim()}>
					+
				</button>
			</div>

			{/* Queue */}
			<div className="music-player__queue-header" onClick={() => setShowQueue(!showQueue)}>
				<span>Queue ({state.queue.length})</span>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
					style={{ transform: showQueue ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
					<path d="M6 9l6 6 6-6" />
				</svg>
			</div>

			{showQueue && (
				<div className="music-player__queue">
					{state.queue.length === 0 ? (
						<div className="music-player__queue-empty">Queue is empty</div>
					) : (
						state.queue.map((track, i) => (
							<div key={track.id} className="music-player__queue-item">
								<span className="music-player__queue-number">{i + 1}</span>
								<div className="music-player__queue-info">
									<span className="music-player__queue-title">{track.title || track.youtubeId}</span>
									<span className="music-player__queue-by">{track.addedByName}</span>
								</div>
								{track.addedBy === userId && (
									<button className="music-player__queue-remove" onClick={() => removeTrack(track.id)}>✕</button>
								)}
							</div>
						))
					)}
				</div>
			)}
		</div>
	)
}
