import { getApiOrigin } from './network'

export type HandwritingRecognitionResult = {
	isText: boolean
	transcription: string
	confidence: number
}

export async function recognizeHandwriting(imageDataUrl: string) {
	try {
		const response = await fetch(`${getApiOrigin()}/api/ai/handwriting`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				imageDataUrl,
			}),
		})

		if (!response.ok) return null

		const data = (await response.json()) as Partial<HandwritingRecognitionResult>
		const transcription =
			typeof data.transcription === 'string' ? data.transcription.trim() : ''
		const confidence =
			typeof data.confidence === 'number' && Number.isFinite(data.confidence)
				? data.confidence
				: 0

		if (data.isText !== true || !transcription) return null
		if (confidence < 0.55) return null
		if (transcription.length > 64) return null

		return {
			isText: true,
			transcription,
			confidence,
		}
	} catch {
		return null
	}
}
