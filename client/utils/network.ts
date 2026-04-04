function getBackendOrigin() {
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

