import { useCallback, useEffect, useRef, useState } from 'react'

export interface ImageGenerationOptions {
	model?: string
	aspectRatio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
	imageUrls?: string[]
}

interface GenerationErrorPayload {
	error?: string
	details?: string
}

type ImageGenerationStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'

interface UseImageGenerationReturn {
	isGenerating: boolean
	imageUrl: string | null
	error: string | null
	status: ImageGenerationStatus
	jobId: string | null
	generateImage: (prompt: string, options?: ImageGenerationOptions) => Promise<string | null>
	cancelGeneration: () => Promise<boolean>
	reset: () => void
}

function normalizeStatus(status: unknown): ImageGenerationStatus {
	if (typeof status !== 'string') {
		return 'processing'
	}

	switch (status.trim().toLowerCase()) {
		case 'queued':
		case 'pending':
		case 'submitted':
			return 'queued'
		case 'processing':
		case 'running':
		case 'in_progress':
		case 'in-progress':
			return 'processing'
		case 'completed':
		case 'succeeded':
		case 'success':
		case 'done':
			return 'completed'
		case 'failed':
		case 'error':
			return 'failed'
		case 'cancelled':
		case 'canceled':
			return 'canceled'
		default:
			return 'processing'
	}
}

function extractErrorMessage(payload: GenerationErrorPayload | null, fallback: string) {
	return payload?.details || payload?.error || fallback
}

export function useImageGeneration(): UseImageGenerationReturn {
	const [isGenerating, setIsGenerating] = useState(false)
	const [imageUrl, setImageUrl] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [status, setStatus] = useState<ImageGenerationStatus>('idle')
	const [jobId, setJobId] = useState<string | null>(null)
	const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const activeJobIdRef = useRef<string | null>(null)

	const clearPollTimer = useCallback(() => {
		if (pollTimerRef.current) {
			clearTimeout(pollTimerRef.current)
			pollTimerRef.current = null
		}
	}, [])

	const reset = useCallback(() => {
		clearPollTimer()
		activeJobIdRef.current = null
		setImageUrl(null)
		setError(null)
		setIsGenerating(false)
		setStatus('idle')
		setJobId(null)
	}, [clearPollTimer])

	useEffect(() => {
		return () => {
			clearPollTimer()
		}
	}, [clearPollTimer])

	const cancelGeneration = useCallback(async () => {
		const currentJobId = activeJobIdRef.current
		if (!currentJobId) {
			return false
		}

		try {
			clearPollTimer()

			const res = await fetch(`/api/ai/higgsfield/${currentJobId}/cancel`, {
				method: 'POST',
			})

			if (!res.ok) {
				const payload = (await res.json().catch(() => null)) as GenerationErrorPayload | null
				throw new Error(extractErrorMessage(payload, 'Failed to cancel image generation'))
			}

			const data = await res.json().catch(() => null)
			const nextStatus = normalizeStatus(data?.status ?? 'canceled')

			activeJobIdRef.current = null
			setStatus(nextStatus)
			setIsGenerating(false)

			if (nextStatus === 'completed') {
				const nextImageUrl = data?.resultUrl || data?.imageUrl || null
				setImageUrl(nextImageUrl)
				setError(nextImageUrl ? null : 'Generation completed without an image URL.')
				return true
			}

			setError(null)
			return true
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to cancel image generation')
			return false
		}
	}, [clearPollTimer])

	const generateImage = useCallback(async (
		prompt: string,
		options?: ImageGenerationOptions
	): Promise<string | null> => {
		clearPollTimer()
		activeJobIdRef.current = null
		setIsGenerating(true)
		setError(null)
		setImageUrl(null)
		setStatus('queued')
		setJobId(null)

		try {
			const res = await fetch('/api/ai/higgsfield/image', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt,
					model: options?.model || 'reve',
					aspectRatio: options?.aspectRatio,
					imageUrls: options?.imageUrls,
				}),
			})

			if (!res.ok) {
				const payload = (await res.json().catch(() => null)) as GenerationErrorPayload | null
				throw new Error(extractErrorMessage(payload, 'Failed to start image generation'))
			}

			const data = await res.json()
			const nextJobId = typeof data.jobId === 'string'
				? data.jobId
				: typeof data.requestId === 'string'
					? data.requestId
					: null
			const nextStatus = normalizeStatus(data.status)

			setStatus(nextStatus)
			setJobId(nextJobId)
			activeJobIdRef.current = nextJobId

			const immediateResultUrl = data.resultUrl || data.imageUrl || null
			if (nextStatus === 'completed') {
				setImageUrl(immediateResultUrl)
				setIsGenerating(false)
				if (!immediateResultUrl) {
					setError('Generation completed without an image URL.')
					return null
				}
				return immediateResultUrl
			}

			if (!nextJobId) {
				throw new Error('Image generation started but no request id was returned.')
			}

			return await new Promise<string | null>((resolve) => {
				const poll = async () => {
					try {
						const activeJobId = activeJobIdRef.current
						if (!activeJobId) {
							setIsGenerating(false)
							resolve(null)
							return
						}

						const statusRes = await fetch(`/api/ai/higgsfield/${activeJobId}`)
						if (!statusRes.ok) {
							const payload = (await statusRes.json().catch(() => null)) as GenerationErrorPayload | null
							throw new Error(extractErrorMessage(payload, 'Failed to check generation status'))
						}

						const statusData = await statusRes.json()
						const polledStatus = normalizeStatus(statusData.status)
						const nextImageUrl = statusData.resultUrl || statusData.imageUrl || null

						setStatus(polledStatus)
						setJobId(activeJobId)

						if (nextImageUrl) {
							setImageUrl(nextImageUrl)
						}

						if (polledStatus === 'completed') {
							activeJobIdRef.current = null
							setIsGenerating(false)
							if (!nextImageUrl) {
								setError('Generation completed without an image URL.')
								resolve(null)
								return
							}
							resolve(nextImageUrl)
							return
						}

						if (polledStatus === 'failed') {
							activeJobIdRef.current = null
							setError(statusData.error || 'Generation failed')
							setIsGenerating(false)
							resolve(null)
							return
						}

						if (polledStatus === 'canceled') {
							activeJobIdRef.current = null
							setError(null)
							setIsGenerating(false)
							resolve(null)
							return
						}

						pollTimerRef.current = setTimeout(() => {
							void poll()
						}, 2000)
					} catch (pollError) {
						activeJobIdRef.current = null
						setError(pollError instanceof Error ? pollError.message : 'Failed to check generation status')
						setIsGenerating(false)
						resolve(null)
					}
				}

				pollTimerRef.current = setTimeout(() => {
					void poll()
				}, 1200)
			})
		} catch (err) {
			activeJobIdRef.current = null
			setError(err instanceof Error ? err.message : 'Failed to start image generation')
			setIsGenerating(false)
			setStatus('failed')
			return null
		}
	}, [clearPollTimer])

	return {
		isGenerating,
		imageUrl,
		error,
		status,
		jobId,
		generateImage,
		cancelGeneration,
		reset,
	}
}
