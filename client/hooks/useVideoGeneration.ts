import { useState, useCallback, useRef } from 'react'

interface GenerationErrorPayload {
	error?: string
	details?: string
}

interface UseVideoGenerationReturn {
	isGenerating: boolean
	videoUrl: string | null
	error: string | null
	generateVideo: (prompt: string, options?: { model?: string; duration?: number; imageUrl?: string; resolution?: string }) => Promise<string | null>
	reset: () => void
}

export function useVideoGeneration(): UseVideoGenerationReturn {
	const [isGenerating, setIsGenerating] = useState(false)
	const [videoUrl, setVideoUrl] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const reset = useCallback(() => {
		setVideoUrl(null)
		setError(null)
		setIsGenerating(false)
		if (pollTimerRef.current) {
			clearTimeout(pollTimerRef.current)
			pollTimerRef.current = null
		}
	}, [])

	const generateVideo = useCallback(async (
		prompt: string,
		options?: { model?: string; duration?: number; imageUrl?: string; resolution?: string }
	): Promise<string | null> => {
		setIsGenerating(true)
		setError(null)
		setVideoUrl(null)

		try {
			// Use image-to-video endpoint if imageUrl is provided
			const endpoint = options?.imageUrl
				? '/api/ai/higgsfield/image-to-video'
				: '/api/ai/higgsfield/video'

			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt,
					duration: options?.duration || 5,
					imageUrl: options?.imageUrl,
				}),
			})

			if (!res.ok) {
				const payload = (await res.json().catch(() => null)) as GenerationErrorPayload | null
				const message = payload?.details || payload?.error || 'Failed to start video generation'
				throw new Error(message)
			}

			const data = await res.json()

			// Immediate result
			if (data.status === 'completed' && data.resultUrl) {
				setVideoUrl(data.resultUrl)
				setIsGenerating(false)
				return data.resultUrl
			}

			const jobId = data.jobId

			// Poll for completion
			const pollForResult = (): Promise<string | null> => {
				return new Promise((resolve) => {
					const poll = async () => {
						try {
							const statusRes = await fetch(`/api/ai/higgsfield/${jobId}`)
							const statusData = await statusRes.json()

							if (statusData.status === 'completed') {
								const url = statusData.resultUrl || statusData.videoUrl
								setVideoUrl(url)
								setIsGenerating(false)
								resolve(url)
								return
							}

							if (statusData.status === 'failed') {
								setError(statusData.error || 'Video generation failed')
								setIsGenerating(false)
								resolve(null)
								return
							}

							pollTimerRef.current = setTimeout(poll, 3000)
						} catch {
							setError('Failed to check video generation status')
							setIsGenerating(false)
							resolve(null)
						}
					}

					pollTimerRef.current = setTimeout(poll, 3000)
				})
			}

			return await pollForResult()
		} catch (err: any) {
			setError(err.message)
			setIsGenerating(false)
			return null
		}
	}, [])

	return {
		isGenerating,
		videoUrl,
		error,
		generateVideo,
		reset,
	}
}
