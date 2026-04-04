import { Router } from 'express'

const router = Router()

// In-memory job tracking
const jobs = new Map<string, { status: string; videoUrl?: string; error?: string; prompt: string }>()

router.post('/', async (req, res) => {
	try {
		const apiKey = process.env.HIGGSFIELD_API_KEY
		if (!apiKey) {
			// Demo mode: simulate video generation
			const jobId = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
			jobs.set(jobId, { status: 'processing', prompt: req.body.prompt })

			// Simulate processing (return after 5 seconds)
			setTimeout(() => {
				const job = jobs.get(jobId)
				if (job) {
					job.status = 'completed'
					job.videoUrl = `https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4`
				}
			}, 5000)

			return res.json({ jobId, status: 'processing' })
		}

		const { prompt, duration, style } = req.body

		// Call Higgsfield API
		const response = await fetch('https://api.higgsfield.ai/v1/generate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			body: JSON.stringify({ prompt, duration: duration || 5, style: style || 'default' }),
		})

		if (!response.ok) {
			return res.status(response.status).json({ error: 'Higgsfield API error' })
		}

		const data: any = await response.json()
		const jobId = data.job_id || data.id

		jobs.set(jobId, { status: 'processing', prompt })

		res.json({ jobId, status: 'processing' })
	} catch (err) {
		console.error('[higgsfield] Error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

// Check job status
router.get('/:jobId', async (req, res) => {
	try {
		const { jobId } = req.params
		const localJob = jobs.get(jobId)

		if (localJob) {
			return res.json({
				jobId,
				status: localJob.status,
				videoUrl: localJob.videoUrl,
				error: localJob.error,
			})
		}

		// If not in local cache, check with Higgsfield API
		const apiKey = process.env.HIGGSFIELD_API_KEY
		if (!apiKey) {
			return res.status(404).json({ error: 'Job not found' })
		}

		const response = await fetch(`https://api.higgsfield.ai/v1/jobs/${jobId}`, {
			headers: { 'Authorization': `Bearer ${apiKey}` },
		})

		if (!response.ok) {
			return res.status(response.status).json({ error: 'Job not found' })
		}

		const data: any = await response.json()
		res.json({
			jobId,
			status: data.status,
			videoUrl: data.video_url,
			error: data.error,
		})
	} catch (err) {
		console.error('[higgsfield] Status check error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

export { router as higgsFieldRoutes }
