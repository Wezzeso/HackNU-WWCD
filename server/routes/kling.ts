import { Router } from 'express'

const router = Router()

const jobs = new Map<string, { status: string; videoUrl?: string; error?: string; prompt: string }>()

function generateKlingJwt(accessKey: string, secretKey: string): string {
	// Simple JWT generation for Kling API (HS256)
	const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
	const now = Math.floor(Date.now() / 1000)
	const payload = Buffer.from(JSON.stringify({
		iss: accessKey,
		exp: now + 1800,
		nbf: now - 5,
	})).toString('base64url')

	const crypto = require('crypto')
	const signature = crypto
		.createHmac('sha256', secretKey)
		.update(`${header}.${payload}`)
		.digest('base64url')

	return `${header}.${payload}.${signature}`
}

router.post('/', async (req, res) => {
	try {
		const accessKey = process.env.KLING_ACCESS_KEY
		const secretKey = process.env.KLING_SECRET_KEY

		if (!accessKey || !secretKey) {
			// Demo mode
			const jobId = `kling-demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
			jobs.set(jobId, { status: 'processing', prompt: req.body.prompt })

			setTimeout(() => {
				const job = jobs.get(jobId)
				if (job) {
					job.status = 'completed'
					job.videoUrl = 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4'
				}
			}, 8000)

			return res.json({ jobId, status: 'processing' })
		}

		const { prompt, duration, aspectRatio, model } = req.body
		const selectedModel = model || process.env.KLING_MODEL || 'kling-v1-6'

		const jwt = generateKlingJwt(accessKey, secretKey)

		const response = await fetch('https://api-singapore.klingai.com/v1/videos/text2video', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${jwt}`,
			},
			body: JSON.stringify({
				model_name: selectedModel,
				prompt,
				duration: duration || '5',
				aspect_ratio: aspectRatio || '16:9',
			}),
		})

		if (!response.ok) {
			const errText = await response.text()
			console.error('[kling] API error:', errText)
			return res.status(response.status).json({ error: 'Kling API error' })
		}

		const data: any = await response.json()
		const taskId = data.data?.task_id || data.task_id

		if (taskId) {
			jobs.set(taskId, { status: 'processing', prompt })
		}

		res.json({ jobId: taskId, status: 'processing' })
	} catch (err) {
		console.error('[kling] Error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

router.get('/:taskId', async (req, res) => {
	try {
		const { taskId } = req.params
		const localJob = jobs.get(taskId)

		if (localJob && localJob.status === 'completed') {
			return res.json({
				jobId: taskId,
				status: localJob.status,
				videoUrl: localJob.videoUrl,
				error: localJob.error,
			})
		}

		const accessKey = process.env.KLING_ACCESS_KEY
		const secretKey = process.env.KLING_SECRET_KEY

		if (!accessKey || !secretKey) {
			if (localJob) {
				return res.json({
					jobId: taskId,
					status: localJob.status,
					videoUrl: localJob.videoUrl,
					error: localJob.error,
				})
			}
			return res.status(404).json({ error: 'Job not found' })
		}

		const jwt = generateKlingJwt(accessKey, secretKey)

		const response = await fetch(`https://api-singapore.klingai.com/v1/videos/text2video/${taskId}`, {
			headers: { 'Authorization': `Bearer ${jwt}` },
		})

		if (!response.ok) {
			return res.status(response.status).json({ error: 'Job not found' })
		}

		const data: any = await response.json()
		const taskData = data.data || data

		const status = taskData.task_status === 'succeed' ? 'completed' :
			taskData.task_status === 'failed' ? 'failed' : 'processing'

		const videoUrl = taskData.task_result?.videos?.[0]?.url

		if (localJob) {
			localJob.status = status
			if (videoUrl) localJob.videoUrl = videoUrl
		}

		res.json({
			jobId: taskId,
			status,
			videoUrl,
			error: taskData.task_status_msg,
		})
	} catch (err) {
		console.error('[kling] Status check error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

export { router as klingRoutes }
