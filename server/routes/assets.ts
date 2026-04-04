import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

const router = Router()

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
	fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

// Upload an asset
router.post('/:uploadId', async (req, res) => {
	try {
		const { uploadId } = req.params
		const safeName = uploadId.replace(/[^a-zA-Z0-9._-]+/g, '_')
		const filePath = path.join(UPLOADS_DIR, safeName)

		if (fs.existsSync(filePath)) {
			return res.status(409).json({ error: 'Upload already exists' })
		}

		const contentType = req.headers['content-type'] || ''
		if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
			return res.status(400).json({ error: 'Invalid content type' })
		}

		const chunks: Buffer[] = []
		req.on('data', (chunk: Buffer) => chunks.push(chunk))
		req.on('end', () => {
			const buffer = Buffer.concat(chunks)
			fs.writeFileSync(filePath, buffer)

			// Store content type metadata
			fs.writeFileSync(filePath + '.meta', JSON.stringify({ contentType }))

			res.json({ ok: true })
		})
	} catch (err) {
		console.error('[assets] Upload error:', err)
		res.status(500).json({ error: 'Upload failed' })
	}
})

// Download an asset
router.get('/:uploadId', (req, res) => {
	try {
		const { uploadId } = req.params
		const safeName = uploadId.replace(/[^a-zA-Z0-9._-]+/g, '_')
		const filePath = path.join(UPLOADS_DIR, safeName)

		if (!fs.existsSync(filePath)) {
			return res.status(404).json({ error: 'Not found' })
		}

		// Read content type from metadata
		const metaPath = filePath + '.meta'
		let contentType = 'application/octet-stream'
		if (fs.existsSync(metaPath)) {
			const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
			contentType = meta.contentType
		}

		res.set({
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=31536000, immutable',
			'Access-Control-Allow-Origin': '*',
			'Content-Security-Policy': "default-src 'none'",
			'X-Content-Type-Options': 'nosniff',
		})

		const stream = fs.createReadStream(filePath)
		stream.pipe(res)
	} catch (err) {
		console.error('[assets] Download error:', err)
		res.status(500).json({ error: 'Download failed' })
	}
})

export { router as assetRoutes }
