import react from '@vitejs/plugin-react-swc'
import { defineConfig, loadEnv } from 'vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '')
	const serverPort = env.PORT || '3001'
	const backendOrigin = mode === 'development'
		? env.VITE_SERVER_URL || `http://localhost:${serverPort}`
		: ''

	return {
		define: {
			__BACKEND_ORIGIN__: JSON.stringify(backendOrigin),
		},
		plugins: [react()],
		server: {
			host: true,
			proxy: {
				'/api': {
					target: `http://localhost:${serverPort}`,
					changeOrigin: true,
					ws: true,
				},
				'/_tldraw': {
					target: 'https://cdn.tldraw.com/4.5.7',
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/_tldraw/, ''),
				},
			},
		},
	}
})
