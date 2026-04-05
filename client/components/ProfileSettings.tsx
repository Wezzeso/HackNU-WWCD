import { Camera, Loader2, X } from 'lucide-react'
import { useState, useRef } from 'react'
import { setLocalStorageItem } from '../localStorage'
import './ProfileSettings.css'

interface ProfileSettingsProps {
	isOpen: boolean
	onClose: () => void
	currentName: string
	currentEmail: string
}

export function ProfileSettings({ isOpen, onClose, currentName, currentEmail }: ProfileSettingsProps) {
	const [name, setName] = useState(currentName)
	const [email, setEmail] = useState(currentEmail)
	const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
	const [isUploading, setIsUploading] = useState(false)
	const fileInputRef = useRef<HTMLInputElement>(null)

	if (!isOpen) return null

	const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (!file) return

		// Use a local preview purely for visual feedback during selection.
		const reader = new FileReader()
		reader.onload = (e) => setAvatarPreview(e.target?.result as string)
		reader.readAsDataURL(file)

		setIsUploading(true)
		try {
			const uploadId = `avatar-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
			const response = await fetch(`/api/uploads/${uploadId}`, {
				method: 'POST',
				headers: {
					'Content-Type': file.type,
				},
				body: file,
			})

			if (!response.ok) {
				throw new Error('Avatar upload failed.')
			}

			// Assign the final path to the preview to be saved on submit.
			setAvatarPreview(`/api/uploads/${uploadId}`)
		} catch (error) {
			console.error(error)
			setAvatarPreview(null)
			alert('Failed to upload image. Please try again.')
		} finally {
			setIsUploading(false)
		}
	}

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()

		if (name.trim()) {
			setLocalStorageItem('user-name', name.trim())
		}
		if (email.trim()) {
			setLocalStorageItem('user-email', email.trim())
		}
		if (avatarPreview && avatarPreview.startsWith('/api/uploads')) {
			setLocalStorageItem('user-avatar', avatarPreview)
		}

		// Because React state bounds are tied heavily locally over multiple sockets, forcing a reload ensures absolute synchronization of the new identity visually and collaboratively.
		window.location.reload()
	}

	return (
		<div className="profile-settings__overlay" onPointerDown={onClose}>
			<div className="profile-settings__modal" onPointerDown={(e) => e.stopPropagation()}>
				<div className="profile-settings__header">
					<h2>Edit Profile</h2>
					<button type="button" onClick={onClose} className="profile-settings__close" aria-label="Close">
						<X size={18} />
					</button>
				</div>

				<form className="profile-settings__body" onSubmit={handleSubmit}>
					<div className="profile-settings__avatar-section">
						<div 
							className="profile-settings__avatar-preview" 
							onClick={() => fileInputRef.current?.click()}
							role="button"
							style={
								avatarPreview 
									? { backgroundImage: `url(${avatarPreview})` } 
									: undefined
							}
						>
							{isUploading ? (
								<div className="profile-settings__avatar-overlay">
									<Loader2 size={24} className="animate-spin" />
								</div>
							) : !avatarPreview ? (
								<div className="profile-settings__avatar-overlay profile-settings__avatar-overlay--empty">
									<Camera size={24} />
									<span>Upload</span>
								</div>
							) : null}
						</div>
						<input 
							type="file" 
							ref={fileInputRef} 
							accept="image/*" 
							className="hidden" 
							style={{ display: 'none' }}
							onChange={(e) => void handleFileSelect(e)}
						/>
						<p className="profile-settings__hint">Square image recommended.</p>
					</div>

					<div className="profile-settings__field">
						<label htmlFor="profile-name">Display Name</label>
						<input 
							id="profile-name" 
							type="text" 
							value={name} 
							onChange={(e) => setName(e.target.value)} 
							placeholder="Alex Johnson"
							required 
						/>
					</div>

					<div className="profile-settings__field">
						<label htmlFor="profile-email">Email Address</label>
						<input 
							id="profile-email" 
							type="email" 
							value={email} 
							onChange={(e) => setEmail(e.target.value)} 
							placeholder="alex@workspace.so"
							required 
						/>
					</div>
					
					<div className="profile-settings__footer">
						<button type="button" className="profile-settings__cancel" onClick={onClose}>
							Cancel
						</button>
						<button type="submit" className="profile-settings__save" disabled={isUploading}>
							Save Changes
						</button>
					</div>
				</form>
			</div>
		</div>
	)
}
