import { Router } from 'express'

const router = Router()

const PLATFORM_BASE = 'https://platform.higgsfield.ai'
const IMAGE_ASPECT_RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16'])
const VIDEO_ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1'])

type JobType = 'image' | 'text-to-video' | 'image-to-video'

interface JobRecord {
	status: string
	resultUrl?: string
	error?: string
	prompt: string
	type: JobType
	providerRequestId?: string
	providerStatusUrl?: string
	providerCancelUrl?: string
}

const jobs = new Map<string, JobRecord>()

function getTrimmedEnvValue(...names: string[]) {
	for (const name of names) {
		const rawValue = process.env[name]
		if (typeof rawValue === 'string' && rawValue.trim()) {
			return rawValue.trim()
		}
	}

	return null
}

function getHiggsfieldCredentialState() {
	const combinedCredential = getTrimmedEnvValue('HIGGSFIELD_KEY', 'HF_KEY')
	if (combinedCredential) {
		return {
			mode: 'complete' as const,
			credentialKey: combinedCredential,
		}
	}

	const apiKey = getTrimmedEnvValue('HIGGSFIELD_API_KEY', 'HF_API_KEY')
	const apiSecret = getTrimmedEnvValue('HIGGSFIELD_API_SECRET', 'HF_API_SECRET')

	if (apiKey && apiSecret) {
		return {
			mode: 'complete' as const,
			credentialKey: `${apiKey}:${apiSecret}`,
		}
	}

	if (apiKey && apiKey.includes(':')) {
		return {
			mode: 'complete' as const,
			credentialKey: apiKey,
		}
	}

	if (apiKey || apiSecret) {
		return {
			mode: 'incomplete' as const,
			credentialKey: null,
			message: 'Higgsfield credentials are incomplete. Set HIGGSFIELD_KEY or both HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET.',
		}
	}

	return {
		mode: 'none' as const,
		credentialKey: null,
	}
}

function createHiggsfieldHeaders(credentialKey: string, includeJsonContentType = true) {
	return {
		...(includeJsonContentType ? { 'Content-Type': 'application/json' } : {}),
		'Authorization': `Key ${credentialKey}`,
	}
}

function buildProviderErrorMessage(kind: 'image' | 'video' | 'image-to-video', statusCode: number, details: string) {
	if (statusCode === 401) {
		return {
			error: `Higgsfield ${kind} generation was rejected because the API key is unauthorized.`,
			details,
		}
	}

	return {
		error: `Higgsfield ${kind} generation failed.`,
		details,
	}
}

function isHttpUrl(value: unknown): value is string {
	return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function normalizeProviderStatus(status: unknown) {
	if (typeof status !== 'string') {
		return 'processing'
	}

	switch (status.trim().toLowerCase()) {
		case 'queued':
		case 'pending':
		case 'submitted':
			return 'queued'
		case 'processing':
		case 'running':
		case 'in_progress':
		case 'in-progress':
			return 'processing'
		case 'completed':
		case 'succeeded':
		case 'success':
		case 'done':
			return 'completed'
		case 'failed':
		case 'error':
			return 'failed'
		case 'cancelled':
		case 'canceled':
			return 'canceled'
		default:
			return status.trim().toLowerCase()
	}
}

function isTerminalStatus(status: string) {
	return status === 'completed' || status === 'failed' || status === 'canceled'
}

async function parseProviderResponse(response: Response) {
	const text = await response.text()

	if (!text) {
		return {
			text: '',
			data: null as unknown,
		}
	}

	try {
		return {
			text,
			data: JSON.parse(text) as unknown,
		}
	} catch {
		return {
			text,
			data: text as unknown,
		}
	}
}

function getResponseDetails(text: string, data: unknown) {
	if (text.trim()) {
		return text
	}

	if (typeof data === 'string') {
		return data
	}

	if (data && typeof data === 'object') {
		return JSON.stringify(data)
	}

	return 'No response body returned by provider.'
}

function getObjectValue(value: unknown, key: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined
	}

	return (value as Record<string, unknown>)[key]
}

function getNestedValue(value: unknown, path: string[]) {
	let current = value

	for (const segment of path) {
		if (current == null) {
			return undefined
		}

		if (Array.isArray(current)) {
			const index = Number.parseInt(segment, 10)
			if (!Number.isFinite(index)) {
				return undefined
			}
			current = current[index]
			continue
		}

		if (typeof current !== 'object') {
			return undefined
		}

		current = (current as Record<string, unknown>)[segment]
	}

	return current
}

function extractRequestId(data: unknown) {
	const candidates = [
		getObjectValue(data, 'request_id'),
		getObjectValue(data, 'generation_id'),
		getObjectValue(data, 'job_id'),
		getObjectValue(data, 'id'),
	]

	return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
}

function extractResultUrl(data: unknown): string | undefined {
	const directCandidates = [
		['url'],
		['image_url'],
		['video_url'],
		['result_url'],
		['output', 'url'],
		['output', '0', 'url'],
		['output', '0', 'image_url'],
		['output', '0', 'video_url'],
		['result', 'url'],
		['result', 'image_url'],
		['result', 'video_url'],
		['result', 'image', 'url'],
		['result', 'video', 'url'],
		['result', '0', 'url'],
		['images', '0', 'url'],
		['images', '0', 'image_url'],
		['videos', '0', 'url'],
		['videos', '0', 'video_url'],
		['data', 'url'],
		['data', 'image_url'],
		['data', 'video_url'],
	]

	for (const path of directCandidates) {
		const candidate = getNestedValue(data, path)
		if (isHttpUrl(candidate)) {
			return candidate
		}
	}

	const queue: unknown[] = [data]
	const visited = new Set<unknown>()

	while (queue.length > 0) {
		const current = queue.shift()
		if (current == null || visited.has(current)) {
			continue
		}

		visited.add(current)

		if (isHttpUrl(current)) {
			return current
		}

		if (Array.isArray(current)) {
			for (const item of current) {
				queue.push(item)
			}
			continue
		}

		if (typeof current !== 'object') {
			continue
		}

		for (const [key, value] of Object.entries(current)) {
			if (key === 'status_url' || key === 'cancel_url') {
				continue
			}
			queue.push(value)
		}
	}

	return undefined
}

function extractErrorMessage(data: unknown): string | undefined {
	const candidates = [
		getObjectValue(data, 'error'),
		getObjectValue(data, 'message'),
		getObjectValue(data, 'detail'),
		getNestedValue(data, ['result', 'error']),
		getNestedValue(data, ['result', 'message']),
	]

	return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
}

function getProviderStatusUrl(data: unknown, requestId?: string, previousStatusUrl?: string) {
	const candidate = getObjectValue(data, 'status_url')
	if (typeof candidate === 'string' && candidate.trim()) {
		return candidate
	}

	if (previousStatusUrl) {
		return previousStatusUrl
	}

	return requestId ? `${PLATFORM_BASE}/requests/${requestId}/status` : undefined
}

function getProviderCancelUrl(data: unknown, requestId?: string, previousCancelUrl?: string) {
	const candidate = getObjectValue(data, 'cancel_url')
	if (typeof candidate === 'string' && candidate.trim()) {
		return candidate
	}

	if (previousCancelUrl) {
		return previousCancelUrl
	}

	return requestId ? `${PLATFORM_BASE}/requests/${requestId}/cancel` : undefined
}

function createClientJobResponse(jobId: string, job: JobRecord) {
	return {
		jobId,
		status: job.status,
		resultUrl: job.resultUrl,
		imageUrl: job.type === 'image' ? job.resultUrl : undefined,
		videoUrl: job.type !== 'image' ? job.resultUrl : undefined,
		error: job.error,
		type: job.type,
		requestId: job.providerRequestId,
		statusUrl: job.providerStatusUrl,
		cancelUrl: job.providerCancelUrl,
	}
}

function createJobFromProviderPayload(
	type: JobType,
	prompt: string,
	data: unknown,
	previousJob?: JobRecord
) {
	const providerRequestId = extractRequestId(data) ?? previousJob?.providerRequestId
	const resultUrl = extractResultUrl(data) ?? previousJob?.resultUrl
	const normalizedStatus = resultUrl
		? 'completed'
		: normalizeProviderStatus(getObjectValue(data, 'status') ?? previousJob?.status)

	return {
		status: normalizedStatus,
		resultUrl,
		error: extractErrorMessage(data) ?? previousJob?.error,
		prompt,
		type,
		providerRequestId,
		providerStatusUrl: getProviderStatusUrl(data, providerRequestId, previousJob?.providerStatusUrl),
		providerCancelUrl: getProviderCancelUrl(data, providerRequestId, previousJob?.providerCancelUrl),
	} satisfies JobRecord
}

function getDemoImageDimensions(aspectRatio: string) {
	switch (aspectRatio) {
		case '16:9':
			return { width: 1152, height: 648 }
		case '1:1':
			return { width: 1024, height: 1024 }
		case '3:4':
			return { width: 768, height: 1024 }
		case '9:16':
			return { width: 648, height: 1152 }
		case '4:3':
		default:
			return { width: 1024, height: 768 }
	}
}

function getPrompt(reqBody: Record<string, unknown>) {
	return typeof reqBody.prompt === 'string' ? reqBody.prompt.trim() : ''
}

function getImageUrls(reqBody: Record<string, unknown>) {
	const rawImageUrls = Array.isArray(reqBody.imageUrls)
		? reqBody.imageUrls
		: Array.isArray(reqBody.image_urls)
			? reqBody.image_urls
			: Array.isArray(reqBody.inputImages)
				? reqBody.inputImages
				: []

	return rawImageUrls.filter(isHttpUrl)
}

function getImageAspectRatio(reqBody: Record<string, unknown>) {
	const candidate = typeof reqBody.aspectRatio === 'string'
		? reqBody.aspectRatio
		: typeof reqBody.aspect_ratio === 'string'
			? reqBody.aspect_ratio
			: '4:3'

	return IMAGE_ASPECT_RATIOS.has(candidate) ? candidate : '4:3'
}

function getVideoAspectRatio(reqBody: Record<string, unknown>) {
	const candidate = typeof reqBody.aspectRatio === 'string'
		? reqBody.aspectRatio
		: typeof reqBody.aspect_ratio === 'string'
			? reqBody.aspect_ratio
			: '16:9'

	return VIDEO_ASPECT_RATIOS.has(candidate) ? candidate : '16:9'
}

function getResolution(reqBody: Record<string, unknown>) {
	return reqBody.resolution === '2k' ? '2k' : '1k'
}

function getPromptUpsampling(reqBody: Record<string, unknown>) {
	if (typeof reqBody.promptUpsampling === 'boolean') {
		return reqBody.promptUpsampling
	}

	if (typeof reqBody.prompt_upsampling === 'boolean') {
		return reqBody.prompt_upsampling
	}

	return true
}

function getSeed(reqBody: Record<string, unknown>) {
	const candidate = typeof reqBody.seed === 'number'
		? reqBody.seed
		: typeof reqBody.seed === 'string'
			? Number.parseInt(reqBody.seed, 10)
			: NaN

	if (!Number.isFinite(candidate)) {
		return undefined
	}

	const normalizedSeed = Math.trunc(candidate)
	return normalizedSeed >= 1 && normalizedSeed <= 1_000_000 ? normalizedSeed : undefined
}

function getProviderKind(jobType: JobType): 'image' | 'video' | 'image-to-video' {
	switch (jobType) {
		case 'image':
			return 'image'
		case 'image-to-video':
			return 'image-to-video'
		default:
			return 'video'
	}
}

// ── Text to Image (Reve via Higgsfield) ──────────────────────────────
router.post('/image', async (req, res) => {
	try {
		const credentialState = getHiggsfieldCredentialState()
		const body = (req.body ?? {}) as Record<string, unknown>
		const prompt = getPrompt(body)

		if (!prompt) {
			return res.status(400).json({ error: 'Prompt is required.' })
		}

		const aspectRatio = getImageAspectRatio(body)
		const imageUrls = getImageUrls(body)

		if (credentialState.mode === 'incomplete') {
			return res.status(500).json({ error: credentialState.message })
		}

		if (credentialState.mode === 'none') {
			const jobId = `demo-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
			jobs.set(jobId, { status: 'queued', prompt, type: 'image' })

			setTimeout(() => {
				const job = jobs.get(jobId)
				if (!job) return

				const { width, height } = getDemoImageDimensions(aspectRatio)
				job.status = 'completed'
				job.resultUrl = `https://picsum.photos/seed/${encodeURIComponent(jobId)}/${width}/${height}`
			}, 3200)

			return res.json(createClientJobResponse(jobId, jobs.get(jobId)!))
		}

		const requestBody: Record<string, unknown> = {
			prompt,
			aspect_ratio: aspectRatio,
			input_images: imageUrls,
		}

		const response = await fetch(`${PLATFORM_BASE}/reve`, {
			method: 'POST',
			headers: createHiggsfieldHeaders(credentialState.credentialKey),
			body: JSON.stringify(requestBody),
		})
		const { text, data } = await parseProviderResponse(response)

		if (!response.ok) {
			console.error('[higgsfield/image] Reve API error body:', getResponseDetails(text, data))
			return res
				.status(response.status)
				.json(buildProviderErrorMessage('image', response.status, getResponseDetails(text, data)))
		}

		const job = createJobFromProviderPayload('image', prompt, data)
		const jobId = job.providerRequestId ?? `hf-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

		jobs.set(jobId, job)
		return res.json(createClientJobResponse(jobId, job))
	} catch (err) {
		console.error('[higgsfield/image] Error:', err)
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// ── Text to Video (Kling v3.0 via Higgsfield) ────────────────────────
router.post('/video', async (req, res) => {
	try {
		const credentialState = getHiggsfieldCredentialState()
		const body = (req.body ?? {}) as Record<string, unknown>
		const prompt = getPrompt(body)

		if (credentialState.mode === 'incomplete') {
			return res.status(500).json({ error: credentialState.message })
		}

		if (credentialState.mode === 'none') {
			const jobId = `demo-vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
			jobs.set(jobId, { status: 'queued', prompt, type: 'text-to-video' })

			setTimeout(() => {
				const job = jobs.get(jobId)
				if (!job) return

				job.status = 'completed'
				job.resultUrl = 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4'
			}, 8000)

			return res.json(createClientJobResponse(jobId, jobs.get(jobId)!))
		}

		const duration = typeof body.duration === 'number' ? body.duration : 5
		const cfgScale = typeof body.cfgScale === 'number' ? body.cfgScale : 0.5
		const sound = typeof body.sound === 'string' ? body.sound : 'on'
		const multiShots = typeof body.multiShots === 'boolean' ? body.multiShots : false
		const aspectRatio = getVideoAspectRatio(body)

		const requestBody = {
			sound,
			prompt,
			duration,
			elements: [''],
			cfg_scale: cfgScale,
			multi_shots: multiShots,
			aspect_ratio: aspectRatio,
			multi_prompt: [{ prompt, duration: 1 }],
		}

		const response = await fetch(`${PLATFORM_BASE}/kling-video/v3.0/std/text-to-video`, {
			method: 'POST',
			headers: createHiggsfieldHeaders(credentialState.credentialKey),
			body: JSON.stringify(requestBody),
		})
		const { text, data } = await parseProviderResponse(response)

		if (!response.ok) {
			console.error('[higgsfield/video] Text-to-video API error body:', getResponseDetails(text, data))
			return res
				.status(response.status)
				.json(buildProviderErrorMessage('video', response.status, getResponseDetails(text, data)))
		}

		const job = createJobFromProviderPayload('text-to-video', prompt, data)
		const jobId = job.providerRequestId ?? `hf-vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

		jobs.set(jobId, job)
		return res.json(createClientJobResponse(jobId, job))
	} catch (err) {
		console.error('[higgsfield/video] Error:', err)
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// ── Image to Video (Kling v3.0 via Higgsfield) ───────────────────────
router.post('/image-to-video', async (req, res) => {
	try {
		const credentialState = getHiggsfieldCredentialState()
		const body = (req.body ?? {}) as Record<string, unknown>
		const prompt = getPrompt(body)

		if (credentialState.mode === 'incomplete') {
			return res.status(500).json({ error: credentialState.message })
		}

		if (credentialState.mode === 'none') {
			const jobId = `demo-i2v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
			jobs.set(jobId, { status: 'queued', prompt, type: 'image-to-video' })

			setTimeout(() => {
				const job = jobs.get(jobId)
				if (!job) return

				job.status = 'completed'
				job.resultUrl = 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4'
			}, 8000)

			return res.json(createClientJobResponse(jobId, jobs.get(jobId)!))
		}

		const duration = typeof body.duration === 'number' ? body.duration : 5
		const cfgScale = typeof body.cfgScale === 'number' ? body.cfgScale : 0.5
		const sound = typeof body.sound === 'string' ? body.sound : 'on'
		const multiShots = typeof body.multiShots === 'boolean' ? body.multiShots : false
		const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : ''
		const lastImageUrl = typeof body.lastImageUrl === 'string' ? body.lastImageUrl : ''

		const requestBody = {
			sound,
			prompt,
			duration,
			elements: [''],
			cfg_scale: cfgScale,
			image_url: imageUrl,
			multi_shots: multiShots,
			multi_prompt: [{ prompt, duration: 1 }],
			last_image_url: lastImageUrl,
		}

		const response = await fetch(`${PLATFORM_BASE}/kling-video/v3.0/std/image-to-video`, {
			method: 'POST',
			headers: createHiggsfieldHeaders(credentialState.credentialKey),
			body: JSON.stringify(requestBody),
		})
		const { text, data } = await parseProviderResponse(response)

		if (!response.ok) {
			console.error('[higgsfield/i2v] Image-to-video API error body:', getResponseDetails(text, data))
			return res
				.status(response.status)
				.json(buildProviderErrorMessage('image-to-video', response.status, getResponseDetails(text, data)))
		}

		const job = createJobFromProviderPayload('image-to-video', prompt, data)
		const jobId = job.providerRequestId ?? `hf-i2v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

		jobs.set(jobId, job)
		return res.json(createClientJobResponse(jobId, job))
	} catch (err) {
		console.error('[higgsfield/i2v] Error:', err)
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// ── Legacy POST / (auto-routes by type) ──────────────────────────────
router.post('/', (req, _res, next) => {
	const genType = req.body.type || 'image'
	if (genType === 'image-to-video') {
		req.url = '/image-to-video'
	} else if (genType === 'video') {
		req.url = '/video'
	} else {
		req.url = '/image'
	}
	next()
})

// ── Cancel job ───────────────────────────────────────────────────────
router.post('/:jobId/cancel', async (req, res) => {
	try {
		const { jobId } = req.params
		const localJob = jobs.get(jobId)

		if (!localJob) {
			return res.status(404).json({ error: 'Job not found' })
		}

		if (isTerminalStatus(localJob.status)) {
			return res.json(createClientJobResponse(jobId, localJob))
		}

		const credentialState = getHiggsfieldCredentialState()

		if (credentialState.mode === 'incomplete') {
			return res.status(500).json({ error: credentialState.message })
		}

		if (credentialState.mode === 'none' || !localJob.providerCancelUrl) {
			const canceledJob = {
				...localJob,
				status: 'canceled',
			} satisfies JobRecord

			jobs.set(jobId, canceledJob)
			return res.json(createClientJobResponse(jobId, canceledJob))
		}

		const response = await fetch(localJob.providerCancelUrl, {
			method: 'POST',
			headers: createHiggsfieldHeaders(credentialState.credentialKey),
		})
		const { text, data } = await parseProviderResponse(response)

		if (!response.ok) {
			console.error('[higgsfield/cancel] Provider error body:', getResponseDetails(text, data))
			return res
				.status(response.status)
				.json(buildProviderErrorMessage(getProviderKind(localJob.type), response.status, getResponseDetails(text, data)))
		}

		const nextStatus = normalizeProviderStatus(getObjectValue(data, 'status') ?? 'canceled')
		const canceledJob = {
			...localJob,
			status: nextStatus === 'completed' ? 'completed' : nextStatus === 'failed' ? 'failed' : 'canceled',
			error: extractErrorMessage(data) ?? localJob.error,
		} satisfies JobRecord

		jobs.set(jobId, canceledJob)
		return res.json(createClientJobResponse(jobId, canceledJob))
	} catch (err) {
		console.error('[higgsfield/cancel] Error:', err)
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// ── Check job status ─────────────────────────────────────────────────
router.get('/:jobId', async (req, res) => {
	try {
		const { jobId } = req.params
		const localJob = jobs.get(jobId)
		const credentialState = getHiggsfieldCredentialState()

		if (!localJob) {
			return res.status(404).json({ error: 'Job not found' })
		}

		if (credentialState.mode === 'incomplete') {
			return res.status(500).json({ error: credentialState.message })
		}

		if (isTerminalStatus(localJob.status) || credentialState.mode === 'none' || !localJob.providerStatusUrl) {
			return res.json(createClientJobResponse(jobId, localJob))
		}

		const response = await fetch(localJob.providerStatusUrl, {
			method: 'GET',
			headers: createHiggsfieldHeaders(credentialState.credentialKey, false),
		})
		const { text, data } = await parseProviderResponse(response)

		if (!response.ok) {
			console.error('[higgsfield/status] Provider error body:', getResponseDetails(text, data))
			return res
				.status(response.status)
				.json(
					buildProviderErrorMessage(
						getProviderKind(localJob.type),
						response.status,
						getResponseDetails(text, data)
					)
				)
		}

		const updatedJob = createJobFromProviderPayload(localJob.type, localJob.prompt, data, localJob)
		jobs.set(jobId, updatedJob)

		return res.json(createClientJobResponse(jobId, updatedJob))
	} catch (err) {
		console.error('[higgsfield/status] Error:', err)
		return res.status(500).json({ error: 'Internal server error' })
	}
})

export { router as higgsFieldRoutes }
