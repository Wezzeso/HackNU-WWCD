import { useState, useCallback } from 'react'

interface UseGeminiReturn {
	response: string
	isLoading: boolean
	error: string | null
	askGemini: (prompt: string, context?: string) => Promise<string>
	streamGemini: (prompt: string, context?: string) => Promise<void>
	clearResponse: () => void
}

export function useGemini(): UseGeminiReturn {
	const [response, setResponse] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const askGemini = useCallback(async (prompt: string, context?: string): Promise<string> => {
		setIsLoading(true)
		setError(null)
		try {
			const res = await fetch('/api/ai/gemini', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ prompt, context }),
			})

			if (!res.ok) {
				const errData = await res.json().catch(() => ({}))
				throw new Error(errData.error || 'Failed to get AI response')
			}

			const data = await res.json()
			setResponse(data.text)
			return data.text
		} catch (err: any) {
			setError(err.message)
			return ''
		} finally {
			setIsLoading(false)
		}
	}, [])

	const streamGemini = useCallback(async (prompt: string, context?: string) => {
		setIsLoading(true)
		setError(null)
		setResponse('')

		try {
			const res = await fetch('/api/ai/gemini', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ prompt, context, stream: true }),
			})

			if (!res.ok) {
				throw new Error('Failed to get AI response')
			}

			const reader = res.body?.getReader()
			if (!reader) throw new Error('No response body')

			const decoder = new TextDecoder()
			let accumulated = ''

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				const chunk = decoder.decode(value)
				// Parse SSE format
				const lines = chunk.split('\n')
				for (const line of lines) {
					if (line.startsWith('data: ')) {
						try {
							const jsonStr = line.slice(6)
							if (jsonStr === '[DONE]') continue
							const parsed = JSON.parse(jsonStr)
							const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ''
							accumulated += text
							setResponse(accumulated)
						} catch {
							// Skip invalid JSON
						}
					}
				}
			}
		} catch (err: any) {
			setError(err.message)
		} finally {
			setIsLoading(false)
		}
	}, [])

	const clearResponse = useCallback(() => {
		setResponse('')
		setError(null)
	}, [])

	return {
		response,
		isLoading,
		error,
		askGemini,
		streamGemini,
		clearResponse,
	}
}
