import { useEffect, useMemo, useState } from 'react'
import { getLocalStorageItem, setLocalStorageItem } from '../localStorage'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'hacknu-theme'

function getSystemTheme(): ResolvedTheme {
	if (typeof window === 'undefined') return 'light'
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useThemePreference() {
	const [theme, setTheme] = useState<ThemePreference>(() => {
		const savedTheme = getLocalStorageItem(STORAGE_KEY)
		return savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system'
			? savedTheme
			: 'system'
	})
	const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme())

	const resolvedTheme = useMemo<ResolvedTheme>(() => {
		return theme === 'system' ? systemTheme : theme
	}, [systemTheme, theme])

	useEffect(() => {
		if (typeof window === 'undefined') return

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
		const handleChange = (event: MediaQueryListEvent) => {
			setSystemTheme(event.matches ? 'dark' : 'light')
		}

		setSystemTheme(mediaQuery.matches ? 'dark' : 'light')
		mediaQuery.addEventListener('change', handleChange)

		return () => mediaQuery.removeEventListener('change', handleChange)
	}, [])

	useEffect(() => {
		const root = document.documentElement
		root.classList.toggle('dark', resolvedTheme === 'dark')
		root.dataset.theme = resolvedTheme
		root.style.colorScheme = resolvedTheme
	}, [resolvedTheme])

	const updateTheme = (nextTheme: ThemePreference) => {
		setTheme(nextTheme)
		setLocalStorageItem(STORAGE_KEY, nextTheme)
	}

	return {
		theme,
		resolvedTheme,
		setTheme: updateTheme,
	}
}
