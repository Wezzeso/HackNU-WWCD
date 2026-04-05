import { Settings2 } from 'lucide-react'
import { useState } from 'react'
import { getLocalStorageItem, setLocalStorageItem } from '../localStorage'

const MODEL_STORAGE_KEY = 'hacknu-model-settings'

export interface ModelConfig {
	enabled: boolean
	llm: string
	image: string
	video: string
}

const DEFAULT_MODELS: ModelConfig = {
	enabled: true,
	llm: 'gemini-2.5-flash',
	image: 'reve',
	video: 'nano-banana-2',
}

const LLM_OPTIONS = [
	{ value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite Preview' },
	{ value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
]

const IMAGE_OPTIONS = [
	{ value: 'reve', label: 'Reve' },
]

const VIDEO_OPTIONS = [
	{ value: 'nano-banana-2', label: 'Nano Banana 2 (Higgsfield)' },
]

export function getModelConfig(): ModelConfig {
	const stored = getLocalStorageItem(MODEL_STORAGE_KEY)
	if (!stored) return DEFAULT_MODELS

	try {
		const parsed = JSON.parse(stored)
		return { ...DEFAULT_MODELS, ...parsed }
	} catch {
		return DEFAULT_MODELS
	}
}

function saveModelConfig(config: ModelConfig) {
	setLocalStorageItem(MODEL_STORAGE_KEY, JSON.stringify(config))
	window.dispatchEvent(new CustomEvent('hacknu:model-config-changed'))
}

interface ModelSettingsProps {
	isOpen: boolean
	onClose: () => void
}

export function ModelSettings({ isOpen, onClose }: ModelSettingsProps) {
	const [config, setConfig] = useState<ModelConfig>(() => getModelConfig())

	const updateConfig = (key: keyof ModelConfig, value: string | boolean) => {
		const next = { ...config, [key]: value }
		setConfig(next)
		saveModelConfig(next)
	}

	if (!isOpen) return null

	return (
		<div className="model-settings-backdrop" onClick={onClose}>
			<div className="model-settings" onClick={(e) => e.stopPropagation()}>
				<div className="model-settings__header">
					<div className="model-settings__header-left">
						<Settings2 size={16} />
						<span>AI Model Settings</span>
					</div>
					<button className="model-settings__close" onClick={onClose} aria-label="Close">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<path d="M18 6L6 18M6 6l12 12" />
						</svg>
					</button>
				</div>

				<div className="model-settings__body">
					<div className="model-settings__group">
						<label className="model-settings__label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
							<input
								type="checkbox"
								checked={config.enabled}
								onChange={(e) => updateConfig('enabled', e.target.checked)}
								style={{ margin: 0, cursor: 'pointer' }}
							/>
							AI Assistant Enabled
						</label>
					</div>

					<div className="model-settings__group" style={{ opacity: config.enabled ? 1 : 0.5, pointerEvents: config.enabled ? 'auto' : 'none' }}>
						<label className="model-settings__label">LLM (Text Generation)</label>
						<select
							className="model-settings__select"
							value={config.llm}
							onChange={(e) => updateConfig('llm', e.target.value)}
						>
							{LLM_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>{opt.label}</option>
							))}
						</select>
					</div>

					<div className="model-settings__group" style={{ opacity: config.enabled ? 1 : 0.5, pointerEvents: config.enabled ? 'auto' : 'none' }}>
						<label className="model-settings__label">Image Generation</label>
						<select
							className="model-settings__select"
							value={config.image}
							onChange={(e) => updateConfig('image', e.target.value)}
						>
							{IMAGE_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>{opt.label}</option>
							))}
						</select>
					</div>

					<div className="model-settings__group" style={{ opacity: config.enabled ? 1 : 0.5, pointerEvents: config.enabled ? 'auto' : 'none' }}>
						<label className="model-settings__label">Video Generation</label>
						<select
							className="model-settings__select"
							value={config.video}
							onChange={(e) => updateConfig('video', e.target.value)}
						>
							{VIDEO_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>{opt.label}</option>
							))}
						</select>
					</div>
				</div>

				<div className="model-settings__footer">
					<span className="model-settings__hint">Changes apply immediately</span>
				</div>
			</div>
		</div>
	)
}
