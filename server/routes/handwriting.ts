import { Router } from 'express'

const router = Router()

function parseInlineImagePart(dataUrl: string) {
	const match = dataUrl.match(/^data:(.+);base64,(.+)$/)
	if (!match) return null

	return {
		inlineData: {
			mimeType: match[1],
			data: match[2],
		},
	}
}

function cleanModelJson(text: string) {
	const trimmed = text.trim()
	if (!trimmed) return ''
	const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
	const objectMatch = withoutFence.match(/\{[\s\S]*\}/)
	return objectMatch?.[0] ?? withoutFence
}

router.post('/', async (req, res) => {
	try {
		const apiKey = process.env.GEMINI_API_KEY
		if (!apiKey) {
			return res.status(500).json({ error: 'Gemini API key not configured' })
		}

		const { imageDataUrl } = req.body
		if (typeof imageDataUrl !== 'string' || imageDataUrl.length === 0) {
			return res.status(400).json({ error: 'imageDataUrl is required' })
		}

		const imagePart = parseInlineImagePart(imageDataUrl)
		if (!imagePart) {
			return res.status(400).json({ error: 'imageDataUrl must be a valid base64 data URL' })
		}

		const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
		const body = {
			contents: [
				{
					role: 'user',
					parts: [
						{
							text:
								'Look only at the provided whiteboard handwriting image. If it is readable handwritten text, transcribe it as clean plain text. If it is not text or unreadable, say so. Return JSON only with keys isText, transcription, confidence.',
						},
						imagePart,
					],
				},
			],
			generationConfig: {
				temperature: 0.1,
				maxOutputTokens: 120,
				responseMimeType: 'application/json',
			},
		}

		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			}
		)

		if (!response.ok) {
			const errText = await response.text()
			console.error('[handwriting] Gemini API error:', errText)
			return res.status(response.status).json({ error: 'Handwriting recognition failed' })
		}

		const data = await response.json()
		const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
		const parsed = rawText
			? (JSON.parse(cleanModelJson(rawText)) as {
					isText?: boolean
					transcription?: string
					confidence?: number
				})
			: {}

		const transcription =
			typeof parsed.transcription === 'string' ? parsed.transcription.trim() : ''
		const confidence =
			typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
				? parsed.confidence
				: 0

		res.json({
			isText: parsed.isText === true && transcription.length > 0,
			transcription,
			confidence,
		})
	} catch (err) {
		console.error('[handwriting] Error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

export { router as handwritingRoutes }
