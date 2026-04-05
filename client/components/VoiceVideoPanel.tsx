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
import { type OpenViduParticipant, useOpenViduCall } from '../hooks/useOpenViduCall'
import { useVoiceTranscription } from '../hooks/useVoiceTranscription'
import './VoiceVideoPanel.css'

interface VoiceVideoPanelProps {
	roomId: string
	userId: string
	userName: string
	userColor: string
	onTranscript?: (text: string) => void
}

export function VoiceVideoPanel({
	roomId,
	userId,
	userName,
	userColor,
	onTranscript,
}: VoiceVideoPanelProps) {
	const {
		localStream,
		subscribers,
		participants,
		callMode,
		isInCall,
		isJoining,
		isMuted,
		isCameraOff,
		isScreenSharing,
		error,
		joinCall,
		leaveCall,
		toggleMute,
		toggleCamera,
		toggleScreenShare,
	} = useOpenViduCall(roomId, userId, userName, userColor)

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
	const localVideoRef = useRef<HTMLVideoElement>(null)

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

	useEffect(() => {
		if (!localVideoRef.current) return
		localVideoRef.current.srcObject = localStream
	}, [localStream])

	const callParticipants = useMemo(
		() => participants ?? [],
		[participants]
	)
	const visiblePreviewParticipants = callParticipants.slice(0, 4)
	const remainingPreviewCount = Math.max(0, callParticipants.length - visiblePreviewParticipants.length)
	const hasRemoteVideo = subscribers.some((subscriber) => subscriber.stream.videoActive || subscriber.stream.typeOfVideo === 'SCREEN')
	const showVideoStage = callMode === 'video' || hasRemoteVideo || isScreenSharing
	const status = isJoining
		? 'Joining room call...'
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
									key={participant.connectionId}
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
						{remainingPreviewCount > 0 ? `+${remainingPreviewCount}` : callParticipants.length || '0'}
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
							{callParticipants.length > 0 ? (
								callParticipants.map((participant, index) => (
									<div
										key={participant.connectionId}
										className="voice-chat__participant"
										style={{ '--voice-stagger': `${50 + index * 28}ms` } as CSSProperties}
									>
										<ParticipantAvatar participant={participant} className="voice-chat__participant-avatar" />
										{participant.audioActive && index < 2 ? (
											<span className="voice-chat__participant-badge">
												<Mic size={10} />
											</span>
										) : null}
										<span>{participant.isLocal ? 'You' : participant.userName}</span>
										<span className="voice-chat__participant-meta">
											{participant.videoActive || participant.screenShare ? 'Video on' : participant.audioActive ? 'Audio only' : 'Muted'}
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
									<div className="voice-chat__tile voice-chat__tile--local">
										<video
											ref={localVideoRef}
											autoPlay
											muted
											playsInline
											className={`voice-chat__tile-video ${callMode !== 'video' || (isCameraOff && !isScreenSharing) ? 'voice-chat__tile-video--hidden' : ''}`}
										/>
										{callMode !== 'video' || (isCameraOff && !isScreenSharing) ? (
											<div className="voice-chat__tile-avatar" style={{ background: userColor }}>
												{userName.charAt(0).toUpperCase()}
											</div>
										) : null}
										<div className="voice-chat__tile-name">
											You {isScreenSharing ? '(Screen)' : ''}
										</div>
									</div>
									{subscribers.map((subscriber) => (
										<PeerMediaTile key={subscriber.stream.streamId} subscriber={subscriber} />
									))}
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
				{subscribers.map((subscriber) => (
					<HiddenPeerAudio key={subscriber.stream.streamId} subscriber={subscriber} />
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
	participant: OpenViduParticipant
	className: string
	style?: CSSProperties
}) {
	return (
		<div
			className={className}
			style={{ background: participant.userColor, ...style }}
			title={participant.userName}
		>
			{participant.userName.charAt(0).toUpperCase()}
		</div>
	)
}

function PeerMediaTile({ subscriber }: { subscriber: { stream: { getMediaStream: () => MediaStream; videoActive: boolean; typeOfVideo?: string; connection: { data: string } } } }) {
	const videoRef = useRef<HTMLVideoElement>(null)
	const meta = useMemo(() => parseSubscriberMeta(subscriber.stream.connection.data), [subscriber])

	useEffect(() => {
		if (!videoRef.current) return
		videoRef.current.srcObject = subscriber.stream.getMediaStream()
	}, [subscriber])

	return (
		<div className="voice-chat__tile">
			<video
				ref={videoRef}
				autoPlay
				playsInline
				className={`voice-chat__tile-video ${!subscriber.stream.videoActive && subscriber.stream.typeOfVideo !== 'SCREEN' ? 'voice-chat__tile-video--hidden' : ''}`}
			/>
			{!subscriber.stream.videoActive && subscriber.stream.typeOfVideo !== 'SCREEN' ? (
				<div className="voice-chat__tile-avatar" style={{ background: meta.userColor }}>
					{meta.userName.charAt(0).toUpperCase()}
				</div>
			) : null}
			<div className="voice-chat__tile-name">
				{meta.userName} {subscriber.stream.typeOfVideo === 'SCREEN' ? '(Screen)' : ''}
			</div>
		</div>
	)
}

function HiddenPeerAudio({ subscriber }: { subscriber: { stream: { getMediaStream: () => MediaStream } } }) {
	const audioRef = useRef<HTMLAudioElement>(null)

	useEffect(() => {
		if (!audioRef.current) return
		audioRef.current.srcObject = subscriber.stream.getMediaStream()
	}, [subscriber])

	return <audio ref={audioRef} autoPlay playsInline />
}

function parseSubscriberMeta(data: string) {
	const chunks = data.split('%/%').reverse()
	for (const chunk of chunks) {
		try {
			const parsed = JSON.parse(chunk) as { userName?: string; userColor?: string }
			return {
				userName: parsed.userName || 'Peer',
				userColor: parsed.userColor || '#64748b',
			}
		} catch {
			// Ignore non-JSON parts.
		}
	}

	return {
		userName: 'Peer',
		userColor: '#64748b',
	}
}
