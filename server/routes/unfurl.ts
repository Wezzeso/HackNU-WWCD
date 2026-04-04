import { Router } from 'express'

const router = Router()

// Basic URL unfurling for bookmark previews
router.get('/', async (req, res) => {
	try {
		const url = req.query.url as string
		if (!url) {
			return res.status(400).json({ error: 'Missing url parameter' })
		}

		const response = await fetch(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; HackNU-Bot/1.0)',
			},
			signal: AbortSignal.timeout(5000),
		})

		const html = await response.text()

		// Extract meta tags
		const getMetaContent = (name: string): string => {
			const patterns = [
				new RegExp(`<meta[^>]*property=["']og:${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
				new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${name}["']`, 'i'),
				new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
				new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i'),
			]
			for (const pattern of patterns) {
				const match = html.match(pattern)
				if (match) return match[1]
			}
			return ''
		}

		const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)

		const result = {
			title: getMetaContent('title') || (titleMatch ? titleMatch[1] : ''),
			description: getMetaContent('description'),
			image: getMetaContent('image'),
			favicon: '',
		}

		// Try to get favicon
		const faviconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']*)["']/i)
		if (faviconMatch) {
			let favicon = faviconMatch[1]
			if (favicon.startsWith('//')) favicon = 'https:' + favicon
			else if (favicon.startsWith('/')) {
				const urlObj = new URL(url)
				favicon = urlObj.origin + favicon
			}
			result.favicon = favicon
		} else {
			const urlObj = new URL(url)
			result.favicon = urlObj.origin + '/favicon.ico'
		}

		// Resolve relative image URLs
		if (result.image && !result.image.startsWith('http')) {
			if (result.image.startsWith('//')) {
				result.image = 'https:' + result.image
			} else if (result.image.startsWith('/')) {
				const urlObj = new URL(url)
				result.image = urlObj.origin + result.image
			}
		}

		res.json(result)
	} catch (err) {
		console.error('[unfurl] Error:', err)
		res.json({ title: '', description: '', image: '', favicon: '' })
	}
})

export { router as unfurlRoutes }
