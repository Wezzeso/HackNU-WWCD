function getBackendOrigin() {
	if (import.meta.env.DEV) {
		return __BACKEND_ORIGIN__ || window.location.origin
	}

	if (__BACKEND_ORIGIN__) {
		return __BACKEND_ORIGIN__
	}

	return window.location.origin
}

export function getApiOrigin() {
	return getBackendOrigin()
}

export function getWsOrigin() {
	return getBackendOrigin().replace(/^http/, 'ws')
}

export function getWsUrl(path: string) {
	return `${getWsOrigin()}${path}`
}

export async function resolveRealtimeOrigin() {
	return getBackendOrigin()
}

export async function resolveWsUrl(path: string) {
	return getWsUrl(path)
}
