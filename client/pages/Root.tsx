import { Navigate } from 'react-router-dom'
import { getLocalStorageItem, setLocalStorageItem } from '../localStorage'

function createRoomId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `test-room-${crypto.randomUUID()}`
	}

	return `test-room-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const myLocalRoomId = getLocalStorageItem('my-local-room-id') ?? createRoomId()
setLocalStorageItem('my-local-room-id', myLocalRoomId)

export function Root() {
	return <Navigate to={`/${myLocalRoomId}`} replace />
}
