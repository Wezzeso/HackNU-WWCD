import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const router = Router()

/**
 * POST /api/ai/gemini-image
 * Generate an image using Gemini's native image generation (gemini-2.0-flash-preview-image-generation).
 * The response is saved to disk and a URL is returned.
 */
router.post('/', async (req, res) => {
	try {
		const apiKey = process.env.GEMINI_API_KEY
		if (!apiKey) {
			return res.status(500).json({ error: 'Gemini API key not configured' })
		}

		const { prompt, contextImageUrls } = req.body
		if (!prompt || typeof prompt !== 'string') {
			return res.status(400).json({ error: 'prompt is required' })
		}

		const parts: any[] = []

		if (Array.isArray(contextImageUrls) && contextImageUrls.length > 0) {
			for (const url of contextImageUrls) {
				try {
					let buffer: Buffer
					let mimeType = 'image/jpeg'

					if (url.startsWith('data:image/')) {
						const matches = url.match(/^data:(image\/\w+);base64,(.+)$/)
						if (matches) {
							mimeType = matches[1]
							buffer = Buffer.from(matches[2], 'base64')
						} else {
							continue
						}
					} else if (url.startsWith('/api/uploads/') || url.startsWith('/uploads/')) {
						const filename = path.basename(url)
						const uploadsDir = path.resolve('uploads')
						const filePath = path.join(uploadsDir, filename)
						if (fs.existsSync(filePath)) {
							buffer = fs.readFileSync(filePath)
							if (filename.endsWith('.png')) mimeType = 'image/png'
							else if (filename.endsWith('.webp')) mimeType = 'image/webp'
						} else {
							continue
						}
					} else if (url.startsWith('http://') || url.startsWith('https://')) {
						const res = await fetch(url)
						if (!res.ok) continue
						const arrayBuffer = await res.arrayBuffer()
						buffer = Buffer.from(arrayBuffer)
						mimeType = res.headers.get('content-type') || 'image/jpeg'
					} else {
						continue
					}

					parts.push({
						inlineData: {
							mimeType,
							data: buffer.toString('base64'),
						},
					})
				} catch (err) {
					console.error('[gemini-image] Failed to parse context image:', err)
				}
			}
		}

		parts.push({ text: prompt })

		const body = {
			contents: [
				{ parts },
			],
			generationConfig: {
				responseModalities: ['TEXT', 'IMAGE'],
			},
		}

		console.log(`[gemini-image] Generating image with prompt: "${prompt.slice(0, 100)}"`)

		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			}
		)

		if (!response.ok) {
			const errText = await response.text()
			console.error('[gemini-image] API error:', errText)
			return res.status(response.status).json({ error: 'Gemini image generation failed', details: errText })
		}

		const data = await response.json()

		// The response contains parts - look for inline_data (image) parts
		const candidates = data.candidates || []
		let imageBase64: string | null = null
		let imageMimeType: string = 'image/png'
		let textResponse: string = ''

		for (const candidate of candidates) {
			const parts = candidate?.content?.parts || []
			for (const part of parts) {
				if (part.inlineData) {
					imageBase64 = part.inlineData.data
					imageMimeType = part.inlineData.mimeType || 'image/png'
				}
				if (part.text) {
					textResponse += part.text
				}
			}
		}

		if (!imageBase64) {
			console.error('[gemini-image] No image data in response. Text response:', textResponse)
			return res.status(500).json({
				error: 'No image generated',
				text: textResponse || 'The model did not return an image.',
			})
		}

		// Save the image to disk
		const uploadsDir = path.resolve('uploads')
		if (!fs.existsSync(uploadsDir)) {
			fs.mkdirSync(uploadsDir, { recursive: true })
		}

		const ext = imageMimeType.includes('jpeg') || imageMimeType.includes('jpg') ? 'jpg' : 'png'
		const filename = `gemini-img-${crypto.randomUUID()}.${ext}`
		const filePath = path.join(uploadsDir, filename)

		const imageBuffer = Buffer.from(imageBase64, 'base64')
		fs.writeFileSync(filePath, imageBuffer)
		fs.writeFileSync(filePath + '.meta', JSON.stringify({ contentType: imageMimeType }))

		const imageUrl = `/api/uploads/${filename}`
		console.log(`[gemini-image] Image saved: ${imageUrl} (${imageBuffer.length} bytes)`)

		res.json({
			imageUrl,
			text: textResponse,
			status: 'completed',
		})
	} catch (err) {
		console.error('[gemini-image] Error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

export { router as geminiImageRoutes }
