import {
	ChevronDown,
	Mic,
	MicOff,
	MonitorUp,
	PhoneOff,
	Sparkles,
	Video,
	VideoOff,
	Volume2,
} from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Track } from 'livekit-client'
import { type CallParticipant, type RemoteTrackEntry, useLiveKitCall } from '../hooks/useLiveKitCall'
import { useVoiceTranscription } from '../hooks/useVoiceTranscription'
import './VoiceVideoPanel.css'

interface VoiceVideoPanelProps {
	roomId: string
	userId: string
	userName: string
	userColor: string
	userAvatar?: string | null
	onTranscript?: (text: string) => void
}

export function VoiceVideoPanel({
	roomId,
	userId,
	userName,
	userColor,
	userAvatar,
	onTranscript,
}: VoiceVideoPanelProps) {
	const {
		participants,
		remoteTracks,
		localVideoTrack,
		localScreenTrack,
		callMode,
		isInCall,
		isJoining,
		isMuted,
		isCameraOff,
		isScreenSharing,
		error,
		status: liveStatus,
		joinCall,
		leaveCall,
		toggleMute,
		toggleCamera,
		toggleScreenShare,
	} = useLiveKitCall(roomId, userId, userName, userColor, userAvatar)

	const handleTranscript = useCallback((text: string) => {
		onTranscript?.(text)
	}, [onTranscript])

	const { isListening, transcript } = useVoiceTranscription(
		roomId,
		isInCall,
		handleTranscript,
	)

	const [isExpanded, setIsExpanded] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!isExpanded) return

		const handlePointerDown = (event: MouseEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) {
				setIsExpanded(false)
			}
		}
		window.addEventListener('mousedown', handlePointerDown)
		return () => window.removeEventListener('mousedown', handlePointerDown)
	}, [isExpanded])

	const visiblePreviewParticipants = participants.slice(0, 4)
	const remainingPreviewCount = Math.max(0, participants.length - visiblePreviewParticipants.length)
	
	const remoteVideoTracks = useMemo(() => 
		remoteTracks.filter(t => t.source === Track.Source.Camera || t.source === Track.Source.ScreenShare),
	[remoteTracks])
	
	const remoteAudioTracks = useMemo(() => 
		remoteTracks.filter(t => t.source === Track.Source.Microphone),
	[remoteTracks])

	const hasRemoteVideo = remoteVideoTracks.length > 0
	const showVideoStage = callMode === 'video' || hasRemoteVideo || localScreenTrack || localVideoTrack
	
	const status = isJoining
		? liveStatus || 'Joining room call...'
		: isInCall
			? callMode === 'video'
				? 'Live in room call with video.'
				: 'Live in room call.'
			: null

	const handleJoinVoice = useCallback(async () => {
		await joinCall('voice', { startMuted: true })
		setIsExpanded(true)
	}, [joinCall])

	const handleJoinVideo = useCallback(async () => {
		await joinCall('video', { startMuted: true })
		setIsExpanded(true)
	}, [joinCall])

	const handleVideoAction = useCallback(async () => {
		if (!isInCall) {
			await handleJoinVideo()
			return
		}

		if (callMode !== 'video') {
			await joinCall('video', { startMuted: isMuted })
			return
		}

		await toggleCamera()
	}, [callMode, handleJoinVideo, isInCall, isMuted, joinCall, toggleCamera])

	return (
		<div className={`voice-chat ${isExpanded ? 'voice-chat--expanded' : ''}`} ref={containerRef}>
			<div className="voice-chat__pill-row">
				<button
					type="button"
					className={`voice-chat__pill ${isExpanded ? 'voice-chat__pill--expanded' : ''}`}
					onClick={() => setIsExpanded((prev) => !prev)}
					aria-expanded={isExpanded}
					aria-label="Open room call"
				>
					<span className="voice-chat__pill-icon">
						<Volume2 size={16} />
					</span>
					<div className="voice-chat__pill-avatars">
						{visiblePreviewParticipants.length > 0 ? (
							visiblePreviewParticipants.map((participant, index) => (
								<ParticipantAvatar
									key={participant.participantId}
									participant={participant}
									className="voice-chat__pill-avatar"
									style={{ zIndex: visiblePreviewParticipants.length - index }}
								/>
							))
						) : (
							<div className="voice-chat__pill-empty">Room call</div>
						)}
					</div>
					<span className="voice-chat__pill-count">
						{remainingPreviewCount > 0 ? `+${remainingPreviewCount}` : participants.length || '0'}
					</span>
					<ChevronDown size={16} className={`voice-chat__pill-chevron ${isExpanded ? 'voice-chat__pill-chevron--open' : ''}`} />
				</button>
				<button
					type="button"
					className={`voice-chat__quick-action ${callMode === 'video' ? 'voice-chat__quick-action--active' : ''}`}
					onClick={() => void handleVideoAction()}
					aria-label={callMode === 'video' ? 'Toggle camera' : 'Start video in room call'}
					title={callMode === 'video' ? 'Toggle camera' : 'Start video in room call'}
				>
					<Video size={16} />
				</button>
			</div>

			<div className="voice-chat__panel" aria-hidden={!isExpanded}>
				<div className="voice-chat__panel-inner">
					<div className="voice-chat__panel-body">
						<div className="voice-chat__participants">
							{participants.length > 0 ? (
								participants.map((participant, index) => (
									<div
										key={participant.participantId}
										className="voice-chat__participant"
										style={{ '--voice-stagger': `${50 + index * 28}ms` } as CSSProperties}
									>
										<ParticipantAvatar participant={participant} className="voice-chat__participant-avatar" />
										{!participant.isMuted && index < 2 ? (
											<span className="voice-chat__participant-badge">
												<Mic size={10} />
											</span>
										) : null}
										<span>{participant.isLocal ? 'You' : participant.userName}</span>
										<span className="voice-chat__participant-meta">
											{participant.isMuted ? 'Muted' : participant.isSpeaking ? 'Speaking' : 'Audio on'}
										</span>
									</div>
								))
							) : (
								<div className="voice-chat__empty">
									No one is in the room call yet.
								</div>
							)}
						</div>

						{isInCall && isListening && (
							<div className="voice-chat__ai-listening">
								<Sparkles size={12} />
								<span>AI is listening</span>
								{transcript ? (
									<div className="voice-chat__transcript">{transcript.slice(-80)}</div>
								) : null}
							</div>
						)}

						{showVideoStage ? (
							<div className="voice-chat__stage">
								<div className="voice-chat__stage-grid">
									{(localVideoTrack || callMode === 'video') && (
										<LocalMediaTile
											track={localVideoTrack}
											participant={participants.find(p => p.isLocal)}
											isMutedCamera={isCameraOff}
											isScreen={false}
										/>
									)}
									{localScreenTrack && (
										<LocalMediaTile
											track={localScreenTrack}
											participant={participants.find(p => p.isLocal)}
											isMutedCamera={false}
											isScreen={true}
										/>
									)}
									{remoteVideoTracks.map((entry) => {
										const peer = participants.find(p => p.participantId === entry.participantId)
										return <PeerMediaTile key={entry.id} trackEntry={entry} participant={peer} />
									})}
								</div>
							</div>
						) : null}

						<div className="voice-chat__footer">
							{isInCall ? (
								<div className="voice-chat__controls">
									<button
										type="button"
										className={`voice-chat__control ${isMuted ? 'voice-chat__control--danger' : ''}`}
										onClick={() => void toggleMute()}
										title={isMuted ? 'Unmute' : 'Mute'}
									>
										{isMuted ? <MicOff size={14} /> : <Mic size={14} />}
									</button>
									<button
										type="button"
										className={`voice-chat__control ${callMode === 'video' && isCameraOff ? 'voice-chat__control--danger' : ''}`}
										onClick={() => void handleVideoAction()}
										title={callMode === 'video' ? (isCameraOff ? 'Turn on camera' : 'Turn off camera') : 'Add video to this call'}
									>
										{callMode === 'video' && isCameraOff ? <VideoOff size={14} /> : <Video size={14} />}
									</button>
									{callMode === 'video' ? (
										<button
											type="button"
											className={`voice-chat__control ${isScreenSharing ? 'voice-chat__control--active' : ''}`}
											onClick={() => void toggleScreenShare()}
											title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
										>
											<MonitorUp size={14} />
										</button>
									) : null}
									<button
										type="button"
										className="voice-chat__leave"
										onClick={leaveCall}
									>
										<PhoneOff size={14} />
										Leave
									</button>
								</div>
							) : (
								<div className="voice-chat__join-actions">
									<button
										type="button"
										className="voice-chat__join"
										onClick={() => void handleJoinVoice()}
										disabled={isJoining}
									>
										{isJoining ? 'Joining...' : 'Join Audio'}
									</button>
									<button
										type="button"
										className="voice-chat__video-launch"
										onClick={() => void handleJoinVideo()}
										disabled={isJoining}
									>
										<Video size={14} />
										Join Video
									</button>
								</div>
							)}
							<div className="voice-chat__hint">
								{callMode
									? 'Audio and video share the same room call.'
									: 'Mic starts muted when you join.'}
							</div>
							{status ? <div className="voice-chat__status">{status}</div> : null}
							{error ? <div className="voice-chat__error">{error}</div> : null}
						</div>
					</div>
				</div>
			</div>

			<div className="voice-chat__hidden-media">
				{remoteAudioTracks.map((entry) => (
					<HiddenAudioTrack key={entry.id} trackEntry={entry} />
				))}
			</div>
		</div>
	)
}

function ParticipantAvatar({
	participant,
	className,
	style,
}: {
	participant: CallParticipant
	className: string
	style?: CSSProperties
}) {
	return (
		<div
			className={className}
			style={{ background: participant.userColor, ...style }}
			title={participant.userName}
		>
			{participant.userAvatar ? (
				<img src={participant.userAvatar} alt={participant.userName} className="size-full object-cover rounded-full" />
			) : (
				participant.userName.charAt(0).toUpperCase()
			)}
		</div>
	)
}

function LocalMediaTile({ track, participant, isMutedCamera, isScreen }: { track: Track | null; participant?: CallParticipant; isMutedCamera: boolean; isScreen: boolean }) {
	const videoRef = useRef<HTMLVideoElement>(null)

	useEffect(() => {
		if (videoRef.current && track) {
			track.attach(videoRef.current)
		}
		return () => {
			if (videoRef.current && track) {
				track.detach(videoRef.current)
			}
		}
	}, [track])

	return (
		<div className="voice-chat__tile voice-chat__tile--local">
			<video
				ref={videoRef}
				className={`voice-chat__tile-video ${isMutedCamera && !isScreen ? 'voice-chat__tile-video--hidden' : ''}`}
			/>
			{isMutedCamera && !isScreen ? (
				<div className="voice-chat__tile-avatar" style={{ background: participant?.userColor || '#64748b' }}>
					{participant?.userName?.charAt(0).toUpperCase() || 'Y'}
				</div>
			) : null}
			<div className="voice-chat__tile-name">
				You {isScreen ? '(Screen)' : ''}
			</div>
		</div>
	)
}

function PeerMediaTile({ trackEntry, participant }: { trackEntry: RemoteTrackEntry; participant?: CallParticipant }) {
	const videoRef = useRef<HTMLVideoElement>(null)
	const isScreen = trackEntry.source === Track.Source.ScreenShare

	useEffect(() => {
		if (videoRef.current && trackEntry.track) {
			trackEntry.track.attach(videoRef.current)
		}
		return () => {
			if (videoRef.current && trackEntry.track) {
				trackEntry.track.detach(videoRef.current)
			}
		}
	}, [trackEntry.track])

	const userName = participant ? participant.userName : 'Peer'
	const userColor = participant ? participant.userColor : '#64748b'

	return (
		<div className="voice-chat__tile">
			<video
				ref={videoRef}
				className={`voice-chat__tile-video`}
			/>
			<div className="voice-chat__tile-name">
				{userName} {isScreen ? '(Screen)' : ''}
			</div>
		</div>
	)
}

function HiddenAudioTrack({ trackEntry }: { trackEntry: RemoteTrackEntry }) {
	const audioRef = useRef<HTMLAudioElement>(null)

	useEffect(() => {
		if (audioRef.current && trackEntry.track) {
			trackEntry.track.attach(audioRef.current)
		}
		return () => {
			if (audioRef.current && trackEntry.track) {
				trackEntry.track.detach(audioRef.current)
			}
		}
	}, [trackEntry.track])

	return <audio ref={audioRef} />
}
