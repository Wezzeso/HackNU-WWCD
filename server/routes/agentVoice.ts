import { Router } from 'express'
import { broadcastAgentSuggestion, broadcastAgentStatus, broadcastAgentMessage, getAgentRoomHistory, addAgentRoomHistory } from '../websocket/agentSync.js'

const router = Router()

// Analyze text (from voice transcript or manual input) for actionable intents
router.post('/analyze', async (req, res) => {
	try {
		const apiKey = process.env.GEMINI_API_KEY
		if (!apiKey) {
			return res.status(500).json({ error: 'Gemini API key not configured' })
		}

		const { roomId, text, context } = req.body
		if (!roomId || !text) {
			return res.status(400).json({ error: 'roomId and text are required' })
		}

		broadcastAgentStatus(roomId, 'thinking')

		const pHistory = getAgentRoomHistory(roomId)

		const systemPrompt = `You are an AI assistant integrated into a real-time collaboration whiteboard. 
You analyze conversation transcripts and text streams to formulate actionable intents.

Your job is to extract ONLY clear, actionable items and summarize conversation history into bullet points or paragraphs if the user asks for essays, tech task lists, bullet points, diagrams, or general written output.
Return a JSON array of intents.

Each intent object must have:
- "type": one of "calendar", "task", "image", "video", "text", "music"
- "title": short title for the action
- "description": brief description
- "data": relevant data object

For "calendar" type, data must include:
{ "date": "YYYY-MM-DD", "time": "HH:MM", "tag": "deadline" | "celebration" | "simple" }
When the user mentions a birthday, keep the person's name in the title.
For "task" type, data must include: { "taskText": "short description" }
For "image" type, data must include: { "prompt": "image generation prompt" } ONLY DO THIS IF THE USER EXPLICITLY ASKS TO 'GENERATE AN IMAGE' OR 'PICTURE'.
For "video" type, data must include: { "prompt": "video generation prompt" }
For "text" type, data must include: { "text": "The full formatted content (essay, technical checklist, diagram representation, or bullet-point summary of the history) ready to be printed on the canvas." }
For "music" type, data must include: { "action": "pause" | "play" | "skip" | "volume", "value": number (optional, only for volume 0-100) }

Examples:
- "deadline for physics project on 2026-04-10 at 18:00" -> calendar with tag "deadline"
- "summarize what we discussed" -> "text" with a bullet point summary of the conversation history.
- "create an essay about planets" -> "text" with full essay.
- "skip this song" -> "music" with action "skip".
- "set music volume to 50" -> "music" with action "volume", value 50.

Be precise.
RESPOND WITH ONLY VALID JSON. No markdown backticks outside of the text data, no explanation.`

		const currentMessageText = `Analyze the user's latest message:\n\n${text}\n\n${context ? `Canvas Context: ${context}` : ''}`
		
		const body = {
			contents: [
				...pHistory,
				{
					role: 'user',
					parts: [{ text: currentMessageText }],
				},
			],
			systemInstruction: {
				parts: [{ text: systemPrompt }],
			},
			generationConfig: {
				temperature: 0.3,
				maxOutputTokens: 1024,
			},
		}

		const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

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
			console.error('[agent-voice] Gemini API error:', errText)
			broadcastAgentStatus(roomId, 'idle')
			return res.status(response.status).json({ error: 'AI analysis failed' })
		}

		const data = await response.json()
		const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]'

		let intents: Array<{
			type: 'calendar' | 'task' | 'image' | 'video' | 'summary' | 'text' | 'music'
			title: string
			description: string
			data?: Record<string, unknown>
		}> = []

		try {
			const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
			intents = JSON.parse(cleaned)
			if (!Array.isArray(intents)) intents = []
		} catch {
			console.error('[agent-voice] Failed to parse intents:', rawText)
			intents = []
		}

		const suggestions = []
		for (const intent of intents) {
			const normalizedData =
				intent.type === 'calendar' && intent.data
					? {
							...intent.data,
							tag:
								intent.data.tag === 'deadline' ||
								intent.data.tag === 'celebration' ||
								intent.data.tag === 'simple'
									? intent.data.tag
									: 'simple',
						}
					: intent.data
			const suggestion = broadcastAgentSuggestion(roomId, {
				type: intent.type === 'task' ? 'action' : intent.type as any,
				title: intent.title,
				description: intent.description,
				data: normalizedData,
			})
			if (suggestion) suggestions.push(suggestion)
		}

		broadcastAgentStatus(roomId, 'idle')

		// Store history
		addAgentRoomHistory(roomId, 'user', text)
		addAgentRoomHistory(roomId, 'model', rawText)

		res.json({ intents: suggestions })
	} catch (err) {
		console.error('[agent-voice] Error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

// Expand a short text into a full document
router.post('/expand', async (req, res) => {
	try {
		const apiKey = process.env.GEMINI_API_KEY
		if (!apiKey) {
			return res.status(500).json({ error: 'Gemini API key not configured' })
		}

		const { text, roomId } = req.body
		if (!text) {
			return res.status(400).json({ error: 'text is required' })
		}

		if (roomId) broadcastAgentStatus(roomId, 'thinking')

		const systemPrompt = `You are a technical documentation writer. 
Given a short-form description or brief notes, expand them into a comprehensive, well-structured document.

Guidelines:
- Use clear markdown formatting with headings, bullet points, and sections
- Include relevant technical details
- Add implementation considerations
- Keep it practical and actionable
- Target 300-800 words
- Do NOT include a title heading (the user already has the title)`

		const body = {
			contents: [
				{
					role: 'user',
					parts: [{ text: `Expand this into a full document:\n\n${text}` }],
				},
			],
			systemInstruction: {
				parts: [{ text: systemPrompt }],
			},
			generationConfig: {
				temperature: 0.5,
				maxOutputTokens: 2048,
			},
		}

		const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			}
		)

		if (!response.ok) {
			if (roomId) broadcastAgentStatus(roomId, 'idle')
			return res.status(response.status).json({ error: 'AI expansion failed' })
		}

		const data = await response.json()
		const expandedText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

		if (roomId) {
			broadcastAgentMessage(roomId, `📄 Document expanded from: "${text.slice(0, 50)}..."`)
			broadcastAgentStatus(roomId, 'idle')
		}

		res.json({ text: expandedText })
	} catch (err) {
		console.error('[agent-voice] Expand error:', err)
		res.status(500).json({ error: 'Internal server error' })
	}
})

export { router as agentVoiceRoutes }
