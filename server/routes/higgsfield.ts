import { Router } from 'express'

const router = Router()

const PLATFORM_BASE = 'https://platform.higgsfield.ai'

// In-memory job tracking
const jobs = new Map<string, {
	status: string
	resultUrl?: string
	error?: string
	prompt: string
	type: 'image' | 'text-to-video' | 'image-to-video'
}>()

// ── Text to Image (Flux 2) ───────────────────────────────────────────
router.post('/image', async (req, res) => {
	try {
		const apiKey = process.env.HIGGSFIELD_API_KEY

		if (!apiKey) {
			// Demo mode
			const jobId = `demo-img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
			jobs.set(jobId, { status: 'processing', prompt: req.body.prompt, type: 'image' })

			setTimeout(() => {
				const job = jobs.get(jobId)
				if (job) {
					job.status = 'completed'
					job.resultUrl = 'https://picsum.photos/seed/' + jobId + '/1024/768'
				}
			}, 4000)

			return res.json({ jobId, status: 'processing', type: 'image' })
		}

		const { prompt, imageUrls, resolution, aspectRatio, seed } = req.body

		const response = await fetch(`${PLATFORM_BASE}/flux-2`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				seed: seed ?? 1,
				prompt,
				image_urls: imageUrls || [''],
				resolution: resolution || '1k',
				aspect_ratio: aspectRatio || '4:3',
				prompt_upsampling: true,
			}),
		})

		if (!response.ok) {
			const errText = await response.text()
			console.error('[higgsfield/image] Flux 2 API error:', response.status, errText)
			return res.status(response.status).json({ error: 'Flux 2 API error', details: errText })
		}

		const data: any = await response.json()
		const jobId = data.generation_id || data.job_id || data.id || `hf-${Date.now()}`

		if (data.url || data.image_url || data.output) {
			// Immediate result
			const url = data.url || data.image_url || data.output?.url || data.output?.[0]?.url
			jobs.set(jobId, { status: 'completed', prompt, type: 'image', resultUrl: url })
			return res.json({ jobId, status: 'completed', type: 'image', resultUrl: url })
		}

		jobs.set(jobId, { status: 'processing', prompt, type: 'image' })
		res.json({ jobId, status: 'processing', type: 'image' })
	} catch (err) {
		console.error('[higgsfield/image] Error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

// ── Text to Video (Kling v3.0 via Higgsfield) ────────────────────────
router.post('/video', async (req, res) => {
	try {
		const apiKey = process.env.HIGGSFIELD_API_KEY

		if (!apiKey) {
			// Demo mode
			const jobId = `demo-vid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
			jobs.set(jobId, { status: 'processing', prompt: req.body.prompt, type: 'text-to-video' })

			setTimeout(() => {
				const job = jobs.get(jobId)
				if (job) {
					job.status = 'completed'
					job.resultUrl = 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4'
				}
			}, 8000)

			return res.json({ jobId, status: 'processing', type: 'text-to-video' })
		}

		const { prompt, duration, aspectRatio, cfgScale, sound, multiShots } = req.body

		const response = await fetch(`${PLATFORM_BASE}/kling-video/v3.0/std/text-to-video`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				sound: sound || 'on',
				prompt,
				duration: duration || 5,
				elements: [''],
				cfg_scale: cfgScale ?? 0.5,
				multi_shots: multiShots ?? false,
				aspect_ratio: aspectRatio || '16:9',
				multi_prompt: [{ prompt: prompt || '', duration: 1 }],
			}),
		})

		if (!response.ok) {
			const errText = await response.text()
			console.error('[higgsfield/video] Text-to-video API error:', response.status, errText)
			return res.status(response.status).json({ error: 'Text-to-video API error', details: errText })
		}

		const data: any = await response.json()
		const jobId = data.generation_id || data.job_id || data.id || `hf-${Date.now()}`

		if (data.url || data.video_url || data.output) {
			const url = data.url || data.video_url || data.output?.url || data.output?.[0]?.url
			jobs.set(jobId, { status: 'completed', prompt, type: 'text-to-video', resultUrl: url })
			return res.json({ jobId, status: 'completed', type: 'text-to-video', resultUrl: url })
		}

		jobs.set(jobId, { status: 'processing', prompt, type: 'text-to-video' })
		res.json({ jobId, status: 'processing', type: 'text-to-video' })
	} catch (err) {
		console.error('[higgsfield/video] Error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

// ── Image to Video (Kling v3.0 via Higgsfield) ───────────────────────
router.post('/image-to-video', async (req, res) => {
	try {
		const apiKey = process.env.HIGGSFIELD_API_KEY

		if (!apiKey) {
			const jobId = `demo-i2v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
			jobs.set(jobId, { status: 'processing', prompt: req.body.prompt || '', type: 'image-to-video' })

			setTimeout(() => {
				const job = jobs.get(jobId)
				if (job) {
					job.status = 'completed'
					job.resultUrl = 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4'
				}
			}, 8000)

			return res.json({ jobId, status: 'processing', type: 'image-to-video' })
		}

		const { prompt, imageUrl, lastImageUrl, duration, cfgScale, sound, multiShots } = req.body

		const response = await fetch(`${PLATFORM_BASE}/kling-video/v3.0/std/image-to-video`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				sound: sound || 'on',
				prompt: prompt || '',
				duration: duration || 5,
				elements: [''],
				cfg_scale: cfgScale ?? 0.5,
				image_url: imageUrl || '',
				multi_shots: multiShots ?? false,
				multi_prompt: [{ prompt: prompt || '', duration: 1 }],
				last_image_url: lastImageUrl || '',
			}),
		})

		if (!response.ok) {
			const errText = await response.text()
			console.error('[higgsfield/i2v] Image-to-video API error:', response.status, errText)
			return res.status(response.status).json({ error: 'Image-to-video API error', details: errText })
		}

		const data: any = await response.json()
		const jobId = data.generation_id || data.job_id || data.id || `hf-${Date.now()}`

		if (data.url || data.video_url || data.output) {
			const url = data.url || data.video_url || data.output?.url || data.output?.[0]?.url
			jobs.set(jobId, { status: 'completed', prompt: prompt || '', type: 'image-to-video', resultUrl: url })
			return res.json({ jobId, status: 'completed', type: 'image-to-video', resultUrl: url })
		}

		jobs.set(jobId, { status: 'processing', prompt: prompt || '', type: 'image-to-video' })
		res.json({ jobId, status: 'processing', type: 'image-to-video' })
	} catch (err) {
		console.error('[higgsfield/i2v] Error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

// ── Legacy POST / (auto-routes by type) ──────────────────────────────
router.post('/', (req, res, next) => {
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

// ── Check job status ─────────────────────────────────────────────────
router.get('/:jobId', async (req, res) => {
	try {
		const { jobId } = req.params
		const localJob = jobs.get(jobId)

		if (localJob) {
			return res.json({
				jobId,
				status: localJob.status,
				resultUrl: localJob.resultUrl,
				imageUrl: localJob.type === 'image' ? localJob.resultUrl : undefined,
				videoUrl: localJob.type !== 'image' ? localJob.resultUrl : undefined,
				error: localJob.error,
				type: localJob.type,
			})
		}

		return res.status(404).json({ error: 'Job not found' })
	} catch (err) {
		console.error('[higgsfield] Status check error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

export { router as higgsFieldRoutes }
