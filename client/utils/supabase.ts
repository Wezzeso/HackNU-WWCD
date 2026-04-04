import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export async function getUser() {
	const { data: { user } } = await supabase.auth.getUser()
	return user
}

export async function signInWithGoogle() {
	const { data, error } = await supabase.auth.signInWithOAuth({
		provider: 'google',
		options: {
			redirectTo: window.location.origin,
		},
	})
	if (error) throw error
	return data
}

export async function signInWithGithub() {
	const { data, error } = await supabase.auth.signInWithOAuth({
		provider: 'github',
		options: {
			redirectTo: window.location.origin,
		},
	})
	if (error) throw error
	return data
}

export async function signOut() {
	const { error } = await supabase.auth.signOut()
	if (error) throw error
}

export function getUserDisplayName(user: any): string {
	return user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Anonymous'
}

export function getUserAvatar(user: any): string | null {
	return user?.user_metadata?.avatar_url || null
}

export function getUserColor(userId: string): string {
	// Generate a consistent color from userId
	let hash = 0
	for (let i = 0; i < userId.length; i++) {
		hash = userId.charCodeAt(i) + ((hash << 5) - hash)
	}
	const hue = Math.abs(hash % 360)
	return `hsl(${hue}, 70%, 50%)`
}
