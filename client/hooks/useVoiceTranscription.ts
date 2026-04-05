import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Browser-based speech recognition that captures what the local user says
 * during a LiveKit voice call and sends transcripts to the AI agent for analysis.
 *
 * Uses the Web Speech API (SpeechRecognition).
 */

interface SpeechRecognitionEvent {
	results: SpeechRecognitionResultList
	resultIndex: number
}

interface UseVoiceTranscriptionReturn {
	isListening: boolean
	transcript: string
	error: string | null
	startListening: () => void
	stopListening: () => void
}

export function useVoiceTranscription(
	roomId: string,
	isInVoiceChat: boolean,
	onTranscript: (text: string) => void,
): UseVoiceTranscriptionReturn {
	const [isListening, setIsListening] = useState(false)
	const [transcript, setTranscript] = useState('')
	const [error, setError] = useState<string | null>(null)
	const recognitionRef = useRef<any>(null)
	const bufferRef = useRef<string>('')
	const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const flushBuffer = useCallback(() => {
		const text = bufferRef.current.trim()
		console.log('[voice-transcription] flushBuffer called, buffer length:', text.length, 'text:', text.slice(0, 100))
		if (text.length > 15) {
			console.log('[voice-transcription] ✅ Sending transcript to agent:', text)
			onTranscript(text)
			bufferRef.current = ''
			setTranscript('')
		} else {
			console.log('[voice-transcription] ⏭️ Buffer too short, skipping flush')
		}
	}, [onTranscript])

	const startListening = useCallback(() => {
		console.log('[voice-transcription] startListening called')

		const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

		if (!SpeechRecognition) {
			console.error('[voice-transcription] ❌ SpeechRecognition API not available in this browser')
			setError('Speech recognition not supported in this browser. Use Chrome or Edge.')
			return
		}

		console.log('[voice-transcription] SpeechRecognition API found, creating instance...')

		try {
			const recognition = new SpeechRecognition()
			recognition.continuous = true
			recognition.interimResults = true
			recognition.lang = 'en-US'

			recognition.onstart = () => {
				console.log('[voice-transcription] ✅ Recognition started successfully')
				setIsListening(true)
				setError(null)
			}

			recognition.onaudiostart = () => {
				console.log('[voice-transcription] 🎤 Audio capture started')
			}

			recognition.onspeechstart = () => {
				console.log('[voice-transcription] 🗣️ Speech detected')
			}

			recognition.onspeechend = () => {
				console.log('[voice-transcription] 🔇 Speech ended')
			}

			recognition.onresult = (event: SpeechRecognitionEvent) => {
				let finalTranscript = ''
				let interimTranscript = ''

				for (let i = event.resultIndex; i < event.results.length; i++) {
					const result = event.results[i]
					if (result.isFinal) {
						finalTranscript += result[0].transcript + ' '
					} else {
						interimTranscript += result[0].transcript
					}
				}

				if (finalTranscript) {
					console.log('[voice-transcription] 📝 Final transcript:', finalTranscript.trim())
					bufferRef.current += finalTranscript
					setTranscript(bufferRef.current)

					// Auto-flush after a pause in speech (8 seconds of accumulated text)
					if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
					flushTimerRef.current = setTimeout(flushBuffer, 8000)
				}

				if (interimTranscript) {
					console.log('[voice-transcription] 💬 Interim:', interimTranscript.slice(0, 60))
				}
			}

			recognition.onerror = (event: any) => {
				console.error('[voice-transcription] ❌ Error:', event.error, event.message || '')

				if (event.error === 'no-speech') {
					console.log('[voice-transcription] No speech detected, will auto-restart')
					return
				}
				if (event.error === 'aborted') {
					console.log('[voice-transcription] Recognition aborted')
					return
				}
				if (event.error === 'not-allowed') {
					setError('Microphone access denied. Please allow microphone access.')
					return
				}
				setError(`Speech recognition error: ${event.error}`)
			}

			recognition.onend = () => {
				console.log('[voice-transcription] Recognition ended. isInVoiceChat:', isInVoiceChat, 'recognitionRef:', !!recognitionRef.current)
				// Auto-restart if still in voice chat
				if (isInVoiceChat && recognitionRef.current) {
					console.log('[voice-transcription] 🔄 Auto-restarting recognition...')
					try {
						setTimeout(() => {
							try {
								recognition.start()
								console.log('[voice-transcription] ✅ Restarted successfully')
							} catch (e) {
								console.error('[voice-transcription] ❌ Restart failed:', e)
							}
						}, 500)
					} catch {
						console.error('[voice-transcription] ❌ Failed to schedule restart')
					}
				} else {
					setIsListening(false)
				}
			}

			console.log('[voice-transcription] Calling recognition.start()...')
			recognition.start()
			recognitionRef.current = recognition
		} catch (err) {
			setError('Failed to start speech recognition')
			console.error('[voice-transcription] ❌ Start exception:', err)
		}
	}, [isInVoiceChat, flushBuffer])

	const stopListening = useCallback(() => {
		console.log('[voice-transcription] stopListening called')
		if (recognitionRef.current) {
			recognitionRef.current.onend = null
			recognitionRef.current.stop()
			recognitionRef.current = null
			console.log('[voice-transcription] Recognition stopped')
		}
		setIsListening(false)

		// Flush any remaining buffer
		flushBuffer()

		if (flushTimerRef.current) {
			clearTimeout(flushTimerRef.current)
			flushTimerRef.current = null
		}
	}, [flushBuffer])

	// Auto-start/stop when joining/leaving voice chat
	useEffect(() => {
		console.log('[voice-transcription] useEffect triggered, isInVoiceChat:', isInVoiceChat)
		if (isInVoiceChat) {
			startListening()
		} else {
			stopListening()
		}

		return () => {
			stopListening()
		}
	}, [isInVoiceChat]) // eslint-disable-line react-hooks/exhaustive-deps

	return {
		isListening,
		transcript,
		error,
		startListening,
		stopListening,
	}
}
