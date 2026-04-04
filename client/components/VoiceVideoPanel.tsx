import {
	ChevronDown,
	Mic,
	MicOff,
	PhoneOff,
	Volume2,
} from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import {
	type RemoteAudioTrackEntry,
	type VoiceChatParticipant,
	useLiveKitVoiceChat,
} from '../hooks/useLiveKitVoiceChat'
import './VoiceVideoPanel.css'

interface VoiceVideoPanelProps {
	roomId: string
	userId: string
	userName: string
	userColor: string
}

export function VoiceVideoPanel({
	roomId,
	userId,
	userName,
	userColor,
}: VoiceVideoPanelProps) {
	const {
		participants,
		remoteAudioTracks,
		isInVoiceChat,
		isJoining,
		isMuted,
		status,
		error,
		joinVoiceChat,
		leaveVoiceChat,
		toggleMute,
	} = useLiveKitVoiceChat(roomId, userId, userName, userColor)

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

	const liveParticipants = useMemo(
		() => participants,
		[participants]
	)
	const previewParticipants = liveParticipants
	const visiblePreviewParticipants = previewParticipants.slice(0, 4)
	const remainingPreviewCount = Math.max(0, previewParticipants.length - visiblePreviewParticipants.length)

	return (
		<div className={`voice-chat ${isExpanded ? 'voice-chat--expanded' : ''}`} ref={containerRef}>
			<button
				type="button"
				className={`voice-chat__pill ${isExpanded ? 'voice-chat__pill--expanded' : ''}`}
				onClick={() => setIsExpanded((prev) => !prev)}
				aria-expanded={isExpanded}
				aria-label="Open voice chat"
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
						<div className="voice-chat__pill-empty">Voice chat</div>
					)}
				</div>
				<span className="voice-chat__pill-count">
					{remainingPreviewCount > 0 ? `+${remainingPreviewCount}` : previewParticipants.length || '0'}
				</span>
				<ChevronDown size={16} className={`voice-chat__pill-chevron ${isExpanded ? 'voice-chat__pill-chevron--open' : ''}`} />
			</button>

			<div className="voice-chat__panel" aria-hidden={!isExpanded}>
				<div className="voice-chat__panel-inner">
					<div className="voice-chat__panel-body">
						<div className="voice-chat__participants">
							{liveParticipants.length > 0 ? (
								liveParticipants.map((participant, index) => (
									<div
										key={participant.participantId}
										className="voice-chat__participant"
										style={{ '--voice-stagger': `${50 + index * 28}ms` } as CSSProperties}
									>
										<ParticipantAvatar participant={participant} className="voice-chat__participant-avatar" />
										{(participant.isSpeaking || !participant.isMuted) && index < 2 ? (
											<span className="voice-chat__participant-badge">
												<Mic size={10} />
											</span>
										) : null}
										<span>{participant.userId === userId ? 'You' : participant.userName}</span>
									</div>
								))
							) : (
								<div className="voice-chat__empty">
									No one is in voice chat yet.
								</div>
							)}
						</div>

						<div className="voice-chat__footer">
							{isInVoiceChat ? (
								<div className="voice-chat__controls">
									<button
										type="button"
										className={`voice-chat__control ${isMuted ? 'voice-chat__control--danger' : ''}`}
										onClick={() => void toggleMute()}
									>
										{isMuted ? <MicOff size={14} /> : <Mic size={14} />}
									</button>
									<button
										type="button"
										className="voice-chat__leave"
										onClick={() => void leaveVoiceChat()}
									>
										<PhoneOff size={14} />
										Leave
									</button>
								</div>
							) : (
								<button
									type="button"
									className="voice-chat__join"
									onClick={() => void joinVoiceChat({ startMuted: true })}
									disabled={isJoining}
								>
									{isJoining ? 'Joining...' : 'Join Voice'}
								</button>
							)}
							<div className="voice-chat__hint">Mic will be muted initially.</div>
							{status ? <div className="voice-chat__status">{status}</div> : null}
							{error ? <div className="voice-chat__error">{error}</div> : null}
						</div>
					</div>
				</div>
			</div>

			<div className="voice-chat__hidden-media">
				{remoteAudioTracks.map((entry) => (
					<HiddenAudioBridge key={entry.id} audioTrack={entry.track} />
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
	participant: VoiceChatParticipant
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

function HiddenAudioBridge({ audioTrack }: { audioTrack: RemoteAudioTrackEntry['track'] }) {
	const audioRef = useRef<HTMLAudioElement>(null)

	useEffect(() => {
		if (!audioRef.current) return
		audioTrack.attach(audioRef.current)
		return () => {
			audioTrack.detach(audioRef.current!)
		}
	}, [audioTrack])

	return <audio ref={audioRef} autoPlay playsInline />
}
