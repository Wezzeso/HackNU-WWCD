import { useRef, useEffect } from 'react'
import { useWebRTC } from '../hooks/useWebRTC'
import './VideoCallPanel.css'

interface VideoCallPanelProps {
	roomId: string
	userId: string
	userName: string
	isOpen: boolean
	onClose: () => void
}

export function VideoCallPanel({ roomId, userId, userName, isOpen, onClose }: VideoCallPanelProps) {
	const {
		localStream, peers, isInCall,
		isMuted, isCameraOff, isScreenSharing,
		joinCall, leaveCall, toggleMute, toggleCamera, toggleScreenShare,
	} = useWebRTC(roomId, userId, userName)

	const localVideoRef = useRef<HTMLVideoElement>(null)

	useEffect(() => {
		if (localVideoRef.current && localStream) {
			localVideoRef.current.srcObject = localStream
		}
	}, [localStream])

	if (!isOpen) return null

	const peerEntries = Array.from(peers.entries())
	const totalParticipants = (isInCall ? 1 : 0) + peerEntries.length
	const gridCols = totalParticipants <= 1 ? 1 : totalParticipants <= 4 ? 2 : 3

	return (
		<div className="video-panel">
			<div className="video-panel__header">
				<div className="video-panel__header-left">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="m22 8-6 4 6 4V8ZM4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
					</svg>
					<span>Video Call</span>
					{isInCall && (
						<span className="video-panel__status video-panel__status--live">
							● LIVE
						</span>
					)}
				</div>
				<button className="video-panel__close" onClick={onClose}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div className="video-panel__content">
				{!isInCall ? (
					<div className="video-panel__join">
						<div className="video-panel__join-icon">
							<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
								<path d="m22 8-6 4 6 4V8ZM4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
							</svg>
						</div>
						<p>Ready to start a video call?</p>
						<p className="video-panel__join-sub">Others in this room can join too</p>
						<button className="video-panel__join-btn" onClick={joinCall}>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<path d="m22 8-6 4 6 4V8Z" />
								<rect x="2" y="6" width="14" height="12" rx="2" />
							</svg>
							Join Call
						</button>
					</div>
				) : (
					<>
						<div className="video-panel__grid" style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
							{/* Local video */}
							<div className="video-tile video-tile--local">
								<video
									ref={localVideoRef}
									autoPlay
									muted
									playsInline
									className={`video-tile__video ${isCameraOff ? 'video-tile__video--hidden' : ''}`}
								/>
								{isCameraOff && (
									<div className="video-tile__avatar">
										{userName.charAt(0).toUpperCase()}
									</div>
								)}
								<div className="video-tile__name">
									You {isScreenSharing && '(Screen)'}
								</div>
								{isMuted && (
									<div className="video-tile__muted">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
											<line x1="1" y1="1" x2="23" y2="23" />
											<path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
											<path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.12 1.5-.34 2.18" />
											<line x1="12" y1="19" x2="12" y2="23" />
											<line x1="8" y1="23" x2="16" y2="23" />
										</svg>
									</div>
								)}
							</div>

							{/* Remote videos */}
							{peerEntries.map(([peerId, peer]) => (
								<PeerVideoTile key={peerId} peer={peer} />
							))}
						</div>

						<div className="video-panel__controls">
							<button
								className={`video-control ${isMuted ? 'video-control--danger' : ''}`}
								onClick={toggleMute}
								title={isMuted ? 'Unmute' : 'Mute'}
							>
								{isMuted ? (
									<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<line x1="1" y1="1" x2="23" y2="23" />
										<path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
									</svg>
								) : (
									<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
										<path d="M19 10v2a7 7 0 0 1-14 0v-2" />
										<line x1="12" y1="19" x2="12" y2="23" />
										<line x1="8" y1="23" x2="16" y2="23" />
									</svg>
								)}
							</button>

							<button
								className={`video-control ${isCameraOff ? 'video-control--danger' : ''}`}
								onClick={toggleCamera}
								title={isCameraOff ? 'Turn on camera' : 'Turn off camera'}
							>
								{isCameraOff ? (
									<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<line x1="1" y1="1" x2="23" y2="23" />
										<path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m2-2h8a2 2 0 0 1 2 2v9.34m-11.66 2.66" />
									</svg>
								) : (
									<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
										<path d="m22 8-6 4 6 4V8Z" />
										<rect x="2" y="6" width="14" height="12" rx="2" />
									</svg>
								)}
							</button>

							<button
								className={`video-control ${isScreenSharing ? 'video-control--active' : ''}`}
								onClick={toggleScreenShare}
								title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
							>
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<rect x="2" y="3" width="20" height="14" rx="2" />
									<line x1="8" y1="21" x2="16" y2="21" />
									<line x1="12" y1="17" x2="12" y2="21" />
								</svg>
							</button>

							<button
								className="video-control video-control--end"
								onClick={leaveCall}
								title="Leave call"
							>
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 2.59 3.4z" />
								</svg>
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	)
}

function PeerVideoTile({ peer }: { peer: any }) {
	const videoRef = useRef<HTMLVideoElement>(null)

	useEffect(() => {
		if (videoRef.current && peer.stream) {
			videoRef.current.srcObject = peer.stream
		}
	}, [peer.stream])

	return (
		<div className="video-tile">
			<video
				ref={videoRef}
				autoPlay
				playsInline
				className={`video-tile__video ${!peer.video ? 'video-tile__video--hidden' : ''}`}
			/>
			{!peer.video && (
				<div className="video-tile__avatar">
					{(peer.userName || 'U').charAt(0).toUpperCase()}
				</div>
			)}
			<div className="video-tile__name">
				{peer.userName || 'Peer'} {peer.screenShare && '(Screen)'}
			</div>
			{!peer.audio && (
				<div className="video-tile__muted">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<line x1="1" y1="1" x2="23" y2="23" />
						<path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
					</svg>
				</div>
			)}
		</div>
	)
}
