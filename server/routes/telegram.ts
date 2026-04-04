import { Router } from 'express'

const router = Router()

// Set webhook
router.post('/set-webhook', async (req, res) => {
	try {
		const token = process.env.TELEGRAM_BOT_TOKEN
		if (!token) {
			return res.status(500).json({ error: 'Telegram bot token not configured' })
		}

		const { webhookUrl } = req.body
		const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: webhookUrl }),
		})

		const data = await response.json()
		res.json(data)
	} catch (err) {
		console.error('[telegram] Set webhook error:', err)
		res.status(500).json({ error: 'Failed to set webhook' })
	}
})

// Webhook handler
router.post('/webhook', async (req, res) => {
	try {
		const token = process.env.TELEGRAM_BOT_TOKEN
		if (!token) {
			return res.status(200).send('ok')
		}

		const update = req.body

		if (update.message) {
			const chatId = update.message.chat.id
			const text = update.message.text || ''
			const userName = update.message.from?.first_name || 'User'

			// Command handling
			if (text.startsWith('/start')) {
				await sendMessage(token, chatId,
					`👋 Welcome to HackNU Board Bot!\n\n` +
					`Commands:\n` +
					`/newroom - Create a new collaboration room\n` +
					`/join <roomId> - Get link to a room\n` +
					`/help - Show this help message`
				)
			} else if (text.startsWith('/newroom')) {
				const roomId = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
				const baseUrl = process.env.APP_URL || 'http://localhost:5173'
				await sendMessage(token, chatId,
					`🎨 New room created!\n\n` +
					`Room ID: ${roomId}\n` +
					`Link: ${baseUrl}/${roomId}\n\n` +
					`Share this link with your team to start collaborating!`
				)
			} else if (text.startsWith('/join')) {
				const parts = text.split(' ')
				if (parts.length < 2) {
					await sendMessage(token, chatId, '❌ Please provide a room ID: /join <roomId>')
				} else {
					const roomId = parts[1]
					const baseUrl = process.env.APP_URL || 'http://localhost:5173'
					await sendMessage(token, chatId,
						`🔗 Join room: ${baseUrl}/${roomId}`
					)
				}
			} else if (text.startsWith('/help')) {
				await sendMessage(token, chatId,
					`📋 HackNU Board Bot Commands:\n\n` +
					`/newroom - Create a new collaboration room\n` +
					`/join <roomId> - Get link to an existing room\n` +
					`/help - Show this help message`
				)
			}
		}

		res.status(200).send('ok')
	} catch (err) {
		console.error('[telegram] Webhook error:', err)
		res.status(200).send('ok')
	}
})

// Send board snapshot to Telegram
router.post('/share', async (req, res) => {
	try {
		const token = process.env.TELEGRAM_BOT_TOKEN
		if (!token) {
			return res.status(500).json({ error: 'Telegram bot token not configured' })
		}

		const { chatId, roomId, imageData, message } = req.body

		if (imageData) {
			// Send image (board snapshot)
			const imageBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64')

			const formData = new FormData()
			formData.append('chat_id', chatId)
			formData.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'board.png')
			if (message) {
				formData.append('caption', message)
			}

			const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
				method: 'POST',
				body: formData,
			})
			const data = await response.json()
			res.json(data)
		} else {
			// Send text message with room link
			const baseUrl = process.env.APP_URL || 'http://localhost:5173'
			const text = message || `🎨 Check out this board: ${baseUrl}/${roomId}`
			await sendMessage(token, chatId, text)
			res.json({ ok: true })
		}
	} catch (err) {
		console.error('[telegram] Share error:', err)
		res.status(500).json({ error: 'Failed to share' })
	}
})

// Get bot info
router.get('/me', async (req, res) => {
	try {
		const token = process.env.TELEGRAM_BOT_TOKEN
		if (!token) {
			return res.status(500).json({ error: 'Telegram bot token not configured' })
		}

		const response = await fetch(`https://api.telegram.org/bot${token}/getMe`)
		const data = await response.json()
		res.json(data)
	} catch (err) {
		res.status(500).json({ error: 'Failed to get bot info' })
	}
})

async function sendMessage(token: string, chatId: number | string, text: string) {
	await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			chat_id: chatId,
			text,
			parse_mode: 'Markdown',
		}),
	})
}

export { router as telegramRoutes }
