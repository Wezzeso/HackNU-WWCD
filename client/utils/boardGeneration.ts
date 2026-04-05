import { getApiOrigin } from './network'

export type BoardImageDraft = {
	title: string
	imageUrl: string
	width: number
	height: number
}

type DraftResponse = {
	title: string
	width: number
	height: number
	svg: string
}

function createUploadId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `board-${crypto.randomUUID()}.svg`
	}

	return `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.svg`
}

async function uploadSvg(svg: string) {
	const uploadId = createUploadId()
	const uploadUrl = `${getApiOrigin()}/api/uploads/${uploadId}`
	const response = await fetch(uploadUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'image/svg+xml',
		},
		body: svg,
	})

	if (!response.ok) {
		return null
	}

	return uploadUrl
}

export async function generateBoardImage(prompt: string) {
	try {
		const draftResponse = await fetch(`${getApiOrigin()}/api/ai/board-generate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ prompt }),
		})

		if (!draftResponse.ok) return null

		const draft = (await draftResponse.json()) as Partial<DraftResponse>
		const svg = typeof draft.svg === 'string' ? draft.svg.trim() : ''
		if (!svg || !svg.includes('<svg')) return null
		const width =
			typeof draft.width === 'number' && Number.isFinite(draft.width)
				? draft.width
				: 1200
		const height =
			typeof draft.height === 'number' && Number.isFinite(draft.height)
				? draft.height
				: 900
		const imageUrl = await uploadSvg(svg)
		if (!imageUrl) return null

		return {
			title: typeof draft.title === 'string' ? draft.title.trim() : '',
			imageUrl,
			width,
			height,
		} satisfies BoardImageDraft
	} catch {
		return null
	}
}
