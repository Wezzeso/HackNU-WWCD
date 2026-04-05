import { Router } from 'express'
import http from 'node:http'
import https from 'node:https'

const router = Router()

interface TokenRequestBody {
	roomId?: string
	userId?: string
	userName?: string
	userColor?: string
}

interface OpenViduConnectionResponse {
	token?: string
}

function normalizeOpenViduUrl(rawUrl?: string) {
	const candidate = rawUrl?.trim() || 'http://localhost:4443'

	try {
		const normalized = new URL(candidate)
		return normalized.toString().replace(/\/+$/, '')
	} catch {
		return candidate.replace(/\/+$/, '')
	}
}

function getOpenViduConfig() {
	return {
		url: normalizeOpenViduUrl(process.env.OPENVIDU_URL),
		secret: process.env.OPENVIDU_SECRET || 'MY_SECRET',
	}
}

function getAuthHeader(secret: string) {
	return `Basic ${Buffer.from(`OPENVIDUAPP:${secret}`).toString('base64')}`
}

function isLocalHttpsOpenVidu(baseUrl: string) {
	const normalized = new URL(baseUrl)
	return (
		normalized.protocol === 'https:' &&
		(normalized.hostname === 'localhost' ||
			normalized.hostname === '127.0.0.1' ||
			normalized.hostname === '::1')
	)
}

function toNodeHeaders(headers?: HeadersInit) {
	if (!headers) {
		return undefined
	}

	if (headers instanceof Headers) {
		return Object.fromEntries(headers.entries())
	}

	if (Array.isArray(headers)) {
		return Object.fromEntries(headers)
	}

	return headers
}

async function requestWithNodeHttp(
	baseUrl: string,
	path: string,
	init: RequestInit
) {
	const url = new URL(path, baseUrl)
	const transport = url.protocol === 'https:' ? https : http

	return await new Promise<Response>((resolve, reject) => {
		const req = transport.request(
			url,
			{
				method: init.method || 'GET',
				headers: toNodeHeaders(init.headers),
				rejectUnauthorized: !isLocalHttpsOpenVidu(baseUrl),
			},
			(res) => {
				const chunks: Buffer[] = []

				res.on('data', (chunk) => {
					chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
				})

				res.on('end', () => {
					const body = Buffer.concat(chunks)
					resolve(
						new Response(body, {
							status: res.statusCode || 500,
							statusText: res.statusMessage || '',
							headers: new Headers(
								Object.entries(res.headers).flatMap<[string, string]>(([key, value]) =>
									value == null
										? []
										: Array.isArray(value)
											? value.map((entry) => [key, entry] as [string, string])
											: [[key, value] as [string, string]]
								)
							),
						})
					)
				})
			}
		)

		req.on('error', reject)

		if (init.body) {
			req.write(init.body instanceof Uint8Array ? init.body : String(init.body))
		}

		req.end()
	})
}

async function fetchOpenVidu(
	baseUrl: string,
	path: string,
	init: RequestInit
) {
	try {
		if (isLocalHttpsOpenVidu(baseUrl)) {
			return await requestWithNodeHttp(baseUrl, path, init)
		}

		return await fetch(`${baseUrl}${path}`, init)
	} catch (error) {
		const cause = error instanceof Error && 'cause' in error ? (error as Error & { cause?: { code?: string } }).cause : undefined
		const code = cause && typeof cause === 'object' ? cause.code : undefined

		if (code === 'ECONNREFUSED') {
			throw new Error(
				`OpenVidu is not reachable at ${baseUrl}. Start the OpenVidu server or update OPENVIDU_URL.`
			)
		}

		if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
			throw new Error(
				`OpenVidu at ${baseUrl} uses a self-signed certificate that Node rejected. For local OpenVidu on localhost:4443, the server route now expects HTTPS and allows the local dev certificate automatically.`
			)
		}

		throw error
	}
}

async function ensureSessionExists(baseUrl: string, secret: string, sessionId: string) {
	const response = await fetchOpenVidu(baseUrl, '/openvidu/api/sessions', {
		method: 'POST',
		headers: {
			Authorization: getAuthHeader(secret),
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			customSessionId: sessionId,
		}),
	})

	if (response.ok || response.status === 409) {
		return
	}

	const details = await response.text().catch(() => '')
	throw new Error(`OpenVidu session creation failed (${response.status}): ${details}`)
}

async function createConnection(
	baseUrl: string,
	secret: string,
	sessionId: string,
	metadata: Record<string, string>
) {
	const response = await fetchOpenVidu(
		baseUrl,
		`/openvidu/api/sessions/${encodeURIComponent(sessionId)}/connection`,
		{
		method: 'POST',
		headers: {
			Authorization: getAuthHeader(secret),
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			type: 'WEBRTC',
			role: 'PUBLISHER',
			data: JSON.stringify(metadata),
		}),
		}
	)

	if (!response.ok) {
		const details = await response.text().catch(() => '')
		throw new Error(`OpenVidu connection creation failed (${response.status}): ${details}`)
	}

	return response.json() as Promise<OpenViduConnectionResponse>
}

router.post('/token', async (req, res) => {
	const body = (req.body ?? {}) as TokenRequestBody
	const roomId = body.roomId?.trim()
	const userId = body.userId?.trim()
	const userName = body.userName?.trim()
	const userColor = body.userColor?.trim() || '#64748b'

	if (!roomId || !userId || !userName) {
		return res.status(400).json({
			error: 'roomId, userId and userName are required.',
		})
	}

	const { url, secret } = getOpenViduConfig()
	const sessionId = `hacknu-${roomId}`

	try {
		await ensureSessionExists(url, secret, sessionId)
		const connection = await createConnection(url, secret, sessionId, {
			userId,
			userName,
			userColor,
		})

		if (!connection.token) {
			return res.status(502).json({
				error: 'OpenVidu did not return a token.',
			})
		}

		return res.status(201).json({
			sessionId,
			token: connection.token,
		})
	} catch (error) {
		console.error('[openvidu] Failed to create token:', error)
		return res.status(502).json({
			error: error instanceof Error ? error.message : 'Failed to create OpenVidu token.',
		})
	}
})

export { router as openviduRoutes }
