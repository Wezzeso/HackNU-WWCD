import { Router } from 'express'

const router = Router()

type JsonObject = Record<string, unknown>

function cleanModelJson(text: string) {
	const trimmed = text.trim()
	if (!trimmed) return ''
	const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
	const objectMatch = withoutFence.match(/\{[\s\S]*\}/)
	return objectMatch?.[0] ?? withoutFence
}

function cleanText(value: unknown, maxLength: number) {
	return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function clampDimension(value: unknown, fallback: number) {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
	return Math.max(320, Math.min(1800, Math.round(value)))
}

router.post('/', async (req, res) => {
	try {
		const apiKey = process.env.GEMINI_API_KEY
		if (!apiKey) {
			return res.status(500).json({ error: 'Gemini API key not configured' })
		}

		const { prompt } = req.body
		if (typeof prompt !== 'string' || prompt.trim().length < 3) {
			return res.status(400).json({ error: 'prompt is required' })
		}

		const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
		const body = {
			contents: [
				{
					role: 'user',
					parts: [
						{
							text: `Generate useful whiteboard content from this input:\n\n${prompt.trim()}`,
						},
					],
				},
			],
			systemInstruction: {
				parts: [
					{
						text:
							'You convert a whiteboard prompt into a clean standalone SVG infographic. Return JSON only with keys: title, width, height, svg. The svg value must be a complete standalone <svg>...</svg> string with a white or very light background, strong readable typography, and a clear diagram, point list, or structured text layout that answers the prompt. Use only safe inline SVG elements like rect, line, path, circle, text, g, defs, linearGradient. Do not use external images, scripts, foreignObject, markdown, or code fences. Keep all visible text concise and legible.',
					},
				],
			},
			generationConfig: {
				temperature: 0.35,
				maxOutputTokens: 900,
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
			console.error('[board-generate] Gemini API error:', errText)
			return res.status(response.status).json({ error: 'Board generation failed' })
		}

		const data = await response.json()
		const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
		const parsed = rawText ? (JSON.parse(cleanModelJson(rawText)) as JsonObject) : {}
		res.json({
			title: cleanText(parsed.title, 80),
			width: clampDimension(parsed.width, 1200),
			height: clampDimension(parsed.height, 900),
			svg: cleanText(parsed.svg, 24000),
		})
	} catch (err) {
		console.error('[board-generate] Error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

export { router as boardGenerateRoutes }
