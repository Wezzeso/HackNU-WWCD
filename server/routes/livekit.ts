import { TrackSource } from '@livekit/protocol'
import { type Response, Router } from 'express'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'

const router = Router()

const DEFAULT_USER_COLOR = '#64748b'

interface TokenRequestBody {
	roomId?: string
	participantIdentity?: string
	participantName?: string
	participantMetadata?: unknown
}

function getMissingLiveKitConfig() {
	const requiredVars = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const
	return requiredVars.filter((key) => !process.env[key])
}

function normalizeUrl(url: string, protocol: 'http:' | 'https:' | 'ws:' | 'wss:') {
	const normalized = new URL(url)
	normalized.protocol = protocol
	normalized.pathname = normalized.pathname.replace(/\/+$/, '')
	return normalized.toString().replace(/\/$/, '')
}

function getLiveKitConfig() {
	const missing = getMissingLiveKitConfig()
	if (missing.length > 0) {
		return {
			missing,
			config: null,
		} as const
	}

	const baseUrl = process.env.LIVEKIT_URL!

	return {
		missing: [] as string[],
		config: {
			clientUrl: normalizeUrl(
				baseUrl,
				baseUrl.startsWith('ws') ? (baseUrl.startsWith('wss') ? 'wss:' : 'ws:') : baseUrl.startsWith('https') ? 'wss:' : 'ws:'
			),
			serviceUrl: normalizeUrl(
				baseUrl,
				baseUrl.startsWith('ws') ? (baseUrl.startsWith('wss') ? 'https:' : 'http:') : baseUrl.startsWith('https') ? 'https:' : 'http:'
			),
			apiKey: process.env.LIVEKIT_API_KEY!,
			apiSecret: process.env.LIVEKIT_API_SECRET!,
		},
	} as const
}

function createRoomServiceClient() {
	const { config } = getLiveKitConfig()
	if (!config) {
		throw new Error('LiveKit is not configured.')
	}

	return new RoomServiceClient(config.serviceUrl, config.apiKey, config.apiSecret)
}

function buildVoiceRoomName(roomId: string) {
	return `voice-chat-${roomId}`
}

function parseParticipantMetadata(metadata?: string) {
	if (!metadata) {
		return {}
	}

	try {
		return JSON.parse(metadata) as {
			userId?: string
			userName?: string
			userColor?: string
			userAvatar?: string
		}
	} catch {
		return {}
	}
}

function serializeParticipantMetadata(metadata: unknown) {
	if (typeof metadata === 'string') {
		return metadata
	}

	if (metadata && typeof metadata === 'object') {
		return JSON.stringify(metadata)
	}

	return JSON.stringify({})
}

function sendMissingConfigError(res: Response, missing: string[]) {
	return res.status(503).json({
		error: `LiveKit is not configured. Missing: ${missing.join(', ')}`,
	})
}

router.post('/token', async (req, res) => {
	const { missing, config } = getLiveKitConfig()
	if (!config) {
		return sendMissingConfigError(res, missing)
	}

	const body = (req.body ?? {}) as TokenRequestBody
	const roomId = body.roomId?.trim()
	const participantIdentity = body.participantIdentity?.trim()
	const participantName = body.participantName?.trim()

	if (!roomId || !participantIdentity || !participantName) {
		return res.status(400).json({
			error: 'roomId, participantIdentity, and participantName are required.',
		})
	}

	try {
		const accessToken = new AccessToken(config.apiKey, config.apiSecret, {
			identity: participantIdentity,
			name: participantName,
			metadata: serializeParticipantMetadata(body.participantMetadata),
		})

		accessToken.addGrant({
			roomJoin: true,
			room: buildVoiceRoomName(roomId),
			canPublish: true,
			canSubscribe: true,
		})

		const participantToken = await accessToken.toJwt()

		return res.status(201).json({
			serverUrl: config.clientUrl,
			participantToken,
		})
	} catch (error) {
		console.error('[livekit] Failed to create participant token:', error)
		return res.status(500).json({
			error: 'Failed to create LiveKit participant token.',
		})
	}
})

router.get('/participants/:roomId', async (req, res) => {
	const { missing } = getLiveKitConfig()
	if (missing.length > 0) {
		return sendMissingConfigError(res, missing)
	}

	const roomId = req.params.roomId?.trim()
	if (!roomId) {
		return res.status(400).json({ error: 'roomId is required.' })
	}

	try {
		const roomServiceClient = createRoomServiceClient()
		const participants = await roomServiceClient.listParticipants(buildVoiceRoomName(roomId))

		return res.json({
			participants: participants
				.map((participant) => {
					const metadata = parseParticipantMetadata(participant.metadata)
					const microphoneTrack = participant.tracks.find(
						(track) => track.source === TrackSource.MICROPHONE
					)

					return {
						participantId: participant.identity,
						userId: metadata.userId || participant.identity,
						userName: participant.name || metadata.userName || participant.identity,
						userColor: metadata.userColor || DEFAULT_USER_COLOR,
						userAvatar: metadata.userAvatar || null,
						isMuted: microphoneTrack ? microphoneTrack.muted : true,
						joinedAtMs: Number(participant.joinedAtMs || participant.joinedAt || 0n),
					}
				})
				.sort((left, right) => left.joinedAtMs - right.joinedAtMs),
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (/not found|does not exist|no such room/i.test(message)) {
			return res.json({ participants: [] })
		}

		console.error('[livekit] Failed to list participants:', error)
		return res.status(502).json({
			error: 'Failed to load LiveKit participants.',
		})
	}
})

export { router as livekitRoutes }
