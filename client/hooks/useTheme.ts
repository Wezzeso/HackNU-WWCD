import { useEffect } from 'react'

export type ThemePreference = 'light'
export type ResolvedTheme = 'light'

export function useThemePreference() {
	useEffect(() => {
		const root = document.documentElement
		root.classList.remove('dark')
		root.dataset.theme = 'light'
		root.style.colorScheme = 'light'
	}, [])

	return {
		theme: 'light' as const,
		resolvedTheme: 'light' as const,
		setTheme: () => {},
	}
}
