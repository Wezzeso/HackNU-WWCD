import { Router } from 'express'

const router = Router()

router.post('/', async (req, res) => {
	try {
		const apiKey = process.env.GEMINI_API_KEY
		if (!apiKey) {
			return res.status(500).json({ error: 'Gemini API key not configured' })
		}

		const { prompt, context, stream: useStream } = req.body

		const systemPrompt = `You are an AI assistant integrated into a collaborative whiteboard/FigJam-style platform. 
You help teams brainstorm, organize ideas, summarize discussions, and create action items.
When given board context, analyze the current state of the whiteboard and provide insights.
Be concise, creative, and actionable in your responses.
Format responses with markdown when helpful.`

		const body = {
			contents: [
				{
					role: 'user',
					parts: [
						{ text: context ? `Board Context:\n${context}\n\nUser Request: ${prompt}` : prompt }
					]
				}
			],
			systemInstruction: {
				parts: [{ text: systemPrompt }]
			},
			generationConfig: {
				temperature: 0.7,
				maxOutputTokens: 2048,
			}
		}

		if (useStream) {
			// Streaming response
			const response = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				}
			)

			if (!response.ok) {
				const errText = await response.text()
				console.error('[gemini] API error:', errText)
				return res.status(response.status).json({ error: 'Gemini API error' })
			}

			res.set({
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
			})

			const reader = response.body?.getReader()
			if (!reader) {
				return res.status(500).json({ error: 'No response body' })
			}

			const decoder = new TextDecoder()
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				res.write(decoder.decode(value))
			}
			res.end()
		} else {
			// Non-streaming response
			const response = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				}
			)

			if (!response.ok) {
				const errText = await response.text()
				console.error('[gemini] API error:', errText)
				return res.status(response.status).json({ error: 'Gemini API error' })
			}

			const data = await response.json()
			const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

			res.json({ text })
		}
	} catch (err) {
		console.error('[gemini] Error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

export { router as geminiRoutes }
