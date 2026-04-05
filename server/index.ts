import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import cors from 'cors'
import dotenv from 'dotenv'
import { URL } from 'url'
import { setupTldrawSync } from './websocket/tldrawSync.js'
import { setupChatSync } from './websocket/chatSync.js'
import { setupMusicSync } from './websocket/musicSync.js'
import { setupSignaling } from './websocket/signaling.js'
import { setupAgentSync } from './websocket/agentSync.js'
import { assetRoutes } from './routes/assets.js'
import { boardGenerateRoutes } from './routes/boardGenerate.js'
import { geminiRoutes } from './routes/gemini.js'
import { geminiImageRoutes } from './routes/geminiImage.js'
import { handwritingRoutes } from './routes/handwriting.js'
import { higgsFieldRoutes } from './routes/higgsfield.js'
import { calendarRoutes } from './routes/calendar.js'
import { telegramRoutes } from './routes/telegram.js'
import { unfurlRoutes } from './routes/unfurl.js'
import { livekitRoutes } from './routes/livekit.js'
import { agentVoiceRoutes } from './routes/agentVoice.js'

dotenv.config()

const app = express()
const server = createServer(app)

// Middleware
app.use(cors())
app.use(express.json({ limit: '50mb' }))

// REST API Routes
app.use('/api/uploads', assetRoutes)
app.use('/api/ai/board-generate', boardGenerateRoutes)
app.use('/api/ai/gemini', geminiRoutes)
app.use('/api/ai/gemini-image', geminiImageRoutes)
app.use('/api/ai/handwriting', handwritingRoutes)
app.use('/api/ai/higgsfield', higgsFieldRoutes)
app.use('/api/calendar', calendarRoutes)
app.use('/api/telegram', telegramRoutes)
app.use('/api/unfurl', unfurlRoutes)
app.use('/api/livekit', livekitRoutes)
app.use('/api/agent', agentVoiceRoutes)

// Health check
app.get('/api/health', (_req, res) => {
	res.json({ status: 'ok', timestamp: Date.now() })
})

// WebSocket Server
const wss = new WebSocketServer({ noServer: true })

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
	const url = new URL(request.url || '', `http://${request.headers.host}`)
	const pathname = url.pathname

	// Route WebSocket connections based on path
	if (pathname.startsWith('/api/connect/')) {
		// Tldraw sync
		wss.handleUpgrade(request, socket, head, (ws) => {
			const roomId = pathname.split('/api/connect/')[1]
			setupTldrawSync(ws, roomId, url.searchParams)
		})
	} else if (pathname.startsWith('/api/chat/')) {
		// Chat sync
		wss.handleUpgrade(request, socket, head, (ws) => {
			const roomId = pathname.split('/api/chat/')[1]
			setupChatSync(ws, roomId)
		})
	} else if (pathname.startsWith('/api/music/')) {
		// Music sync
		wss.handleUpgrade(request, socket, head, (ws) => {
			const roomId = pathname.split('/api/music/')[1]
			setupMusicSync(ws, roomId)
		})
	} else if (pathname.startsWith('/api/signal/')) {
		// WebRTC signaling
		wss.handleUpgrade(request, socket, head, (ws) => {
			const roomId = pathname.split('/api/signal/')[1]
			setupSignaling(ws, roomId)
		})
	} else if (pathname.startsWith('/api/agent-ws/')) {
		// Agent sync
		wss.handleUpgrade(request, socket, head, (ws) => {
			const roomId = pathname.split('/api/agent-ws/')[1]
			setupAgentSync(ws, roomId)
		})
	} else {
		socket.destroy()
	}
})

// Serve static uploads
app.use('/uploads', express.static('uploads'))

// In production, serve the built client
if (process.env.NODE_ENV === 'production') {
	app.use(express.static('dist/client'))
	app.get('*', (_req, res) => {
		res.sendFile('index.html', { root: 'dist/client' })
	})
}

const PORT = parseInt(process.env.PORT || '3001', 10)
server.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`)
})

export { server }
