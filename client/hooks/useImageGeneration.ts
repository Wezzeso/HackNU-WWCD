import { useState, useCallback, useRef } from 'react'

interface UseImageGenerationReturn {
	isGenerating: boolean
	imageUrl: string | null
	error: string | null
	generateImage: (prompt: string, model?: string) => Promise<string | null>
	reset: () => void
}

export function useImageGeneration(): UseImageGenerationReturn {
	const [isGenerating, setIsGenerating] = useState(false)
	const [imageUrl, setImageUrl] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const reset = useCallback(() => {
		setImageUrl(null)
		setError(null)
		setIsGenerating(false)
		if (pollTimerRef.current) {
			clearTimeout(pollTimerRef.current)
			pollTimerRef.current = null
		}
	}, [])

	const generateImage = useCallback(async (prompt: string, model?: string): Promise<string | null> => {
		setIsGenerating(true)
		setError(null)
		setImageUrl(null)

		try {
			const res = await fetch('/api/ai/higgsfield/image', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt,
					model: model || 'flux-2-pro',
				}),
			})

			if (!res.ok) {
				throw new Error('Failed to start image generation')
			}

			const data = await res.json()

			// Immediate result
			if (data.status === 'completed' && data.resultUrl) {
				setImageUrl(data.resultUrl)
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
								const url = statusData.resultUrl || statusData.imageUrl
								setImageUrl(url)
								setIsGenerating(false)
								resolve(url)
								return
							}

							if (statusData.status === 'failed') {
								setError(statusData.error || 'Generation failed')
								setIsGenerating(false)
								resolve(null)
								return
							}

							pollTimerRef.current = setTimeout(poll, 2000)
						} catch {
							setError('Failed to check generation status')
							setIsGenerating(false)
							resolve(null)
						}
					}

					pollTimerRef.current = setTimeout(poll, 2000)
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
		imageUrl,
		error,
		generateImage,
		reset,
	}
}
