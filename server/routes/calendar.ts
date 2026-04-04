import { Router } from 'express'

const router = Router()

// Token storage (in production, store in database per user)
const tokenStore = new Map<string, { access_token: string; refresh_token: string; expiry: number }>()

// Initiate OAuth flow
router.get('/auth', (req, res) => {
	const clientId = process.env.GOOGLE_CLIENT_ID
	if (!clientId) {
		return res.status(500).json({ error: 'Google Calendar not configured' })
	}

	const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/auth/google/callback'
	const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events')

	const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`

	res.json({ authUrl })
})

// Exchange code for tokens
router.post('/auth/callback', async (req, res) => {
	try {
		const { code, userId } = req.body
		const clientId = process.env.GOOGLE_CLIENT_ID
		const clientSecret = process.env.GOOGLE_CLIENT_SECRET
		const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/auth/google/callback'

		const response = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code,
				client_id: clientId!,
				client_secret: clientSecret!,
				redirect_uri: redirectUri,
				grant_type: 'authorization_code',
			}),
		})

		const data: any = await response.json()

		if (data.error) {
			return res.status(400).json({ error: data.error_description || data.error })
		}

		tokenStore.set(userId, {
			access_token: data.access_token,
			refresh_token: data.refresh_token,
			expiry: Date.now() + (data.expires_in * 1000),
		})

		res.json({ success: true })
	} catch (err) {
		console.error('[calendar] Auth error:', err)
		res.status(500).json({ error: 'Auth failed' })
	}
})

// Get events
router.get('/events', async (req, res) => {
	try {
		const userId = req.query.userId as string
		const tokens = tokenStore.get(userId)

		if (!tokens) {
			return res.status(401).json({ error: 'Not authenticated with Google Calendar' })
		}

		// Refresh token if expired
		if (Date.now() > tokens.expiry) {
			await refreshToken(userId, tokens)
		}

		const timeMin = req.query.timeMin || new Date().toISOString()
		const timeMax = req.query.timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

		const response = await fetch(
			`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=20`,
			{
				headers: { 'Authorization': `Bearer ${tokens.access_token}` },
			}
		)

		const data: any = await response.json()

		if (data.error) {
			return res.status(data.error.code).json({ error: data.error.message })
		}

		res.json({
			events: (data.items || []).map((event: any) => ({
				id: event.id,
				title: event.summary,
				description: event.description,
				start: event.start?.dateTime || event.start?.date,
				end: event.end?.dateTime || event.end?.date,
				location: event.location,
				link: event.htmlLink,
				meetLink: event.hangoutLink,
			})),
		})
	} catch (err) {
		console.error('[calendar] Fetch events error:', err)
		res.status(500).json({ error: 'Failed to fetch events' })
	}
})

// Create event
router.post('/events', async (req, res) => {
	try {
		const userId = req.body.userId
		const tokens = tokenStore.get(userId)

		if (!tokens) {
			return res.status(401).json({ error: 'Not authenticated with Google Calendar' })
		}

		if (Date.now() > tokens.expiry) {
			await refreshToken(userId, tokens)
		}

		const response = await fetch(
			'https://www.googleapis.com/calendar/v3/calendars/primary/events',
			{
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${tokens.access_token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					summary: req.body.title,
					description: req.body.description,
					start: { dateTime: req.body.start, timeZone: req.body.timeZone || 'UTC' },
					end: { dateTime: req.body.end, timeZone: req.body.timeZone || 'UTC' },
					location: req.body.location,
				}),
			}
		)

		const data: any = await response.json()
		res.json({ event: { id: data.id, link: data.htmlLink } })
	} catch (err) {
		console.error('[calendar] Create event error:', err)
		res.status(500).json({ error: 'Failed to create event' })
	}
})

async function refreshToken(userId: string, tokens: any) {
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: process.env.GOOGLE_CLIENT_ID!,
			client_secret: process.env.GOOGLE_CLIENT_SECRET!,
			refresh_token: tokens.refresh_token,
			grant_type: 'refresh_token',
		}),
	})
	const data: any = await response.json()
	tokens.access_token = data.access_token
	tokens.expiry = Date.now() + (data.expires_in * 1000)
	tokenStore.set(userId, tokens)
}

export { router as calendarRoutes }
