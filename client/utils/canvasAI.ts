import { getApiOrigin } from './network'

/**
 * Expand a short text into a full document using Gemini 2.5 Flash
 */
export async function expandDocument(shortText: string, roomId?: string): Promise<string> {
	try {
		const res = await fetch(`${getApiOrigin()}/api/agent/expand`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: shortText, roomId }),
		})

		if (!res.ok) {
			throw new Error('Failed to expand document')
		}

		const data = await res.json()
		return data.text || ''
	} catch (err) {
		console.error('[canvasAI] Failed to expand document:', err)
		return ''
	}
}

/**
 * Generate an image prompt description from canvas context
 */
export async function describeForImageGen(canvasContext: string): Promise<string> {
	try {
		const res = await fetch(`${getApiOrigin()}/api/ai/gemini`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				prompt: `Based on this canvas context, create a detailed image generation prompt (1-2 sentences, visual description only):\n\n${canvasContext}`,
			}),
		})

		if (!res.ok) return canvasContext

		const data = await res.json()
		return data.text || canvasContext
	} catch {
		return canvasContext
	}
}
