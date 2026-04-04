import {
	DEFAULT_EMBED_DEFINITIONS,
	LANGUAGES,
	defaultEditorAssetUrls,
	iconTypes,
	type TLUiAssetUrlOverrides,
} from 'tldraw'

const TLDRAW_CDN_ORIGIN = 'https://cdn.tldraw.com/4.5.7'
const TLDRAW_PROXY_BASE = '/_tldraw'

function getAssetBase() {
	return import.meta.env.DEV ? TLDRAW_PROXY_BASE : TLDRAW_CDN_ORIGIN
}

function remapCdnUrl(url: string) {
	if (!url.startsWith(TLDRAW_CDN_ORIGIN)) return url
	return `${getAssetBase()}${url.slice(TLDRAW_CDN_ORIGIN.length)}`
}

export function getTldrawAssetUrls(): TLUiAssetUrlOverrides {
	return {
		fonts: Object.fromEntries(
			Object.entries(defaultEditorAssetUrls.fonts ?? {}).flatMap(([name, url]) =>
				url ? [[name, remapCdnUrl(url)]] : []
			)
		),
		icons: Object.fromEntries(
			iconTypes.map((name) => [name, `${getAssetBase()}/icons/icon/0_merged.svg#${name}`])
		),
		translations: Object.fromEntries(
			LANGUAGES.map((lang) => [lang.locale, `${getAssetBase()}/translations/${lang.locale}.json`])
		),
		embedIcons: Object.fromEntries(
			DEFAULT_EMBED_DEFINITIONS.map((def) => [def.type, `${getAssetBase()}/embed-icons/${def.type}.png`])
		),
	}
}
