import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'
import './globals.css'
import './index.css'

const Root = lazy(async () => {
	const mod = await import('./pages/Root')
	return { default: mod.Root }
})

const Room = lazy(async () => {
	const mod = await import('./pages/Room')
	return { default: mod.Room }
})

const router = createBrowserRouter([
	{
		path: '/',
		element: <Root />,
		errorElement: <RouteErrorBoundary />,
	},
	{
		path: '/:roomId',
		element: <Room />,
		errorElement: <RouteErrorBoundary />,
	},
])

const app = (
	<Suspense fallback={null}>
		<RouterProvider router={router} future={{ v7_startTransition: true }} />
	</Suspense>
)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	import.meta.env.DEV ? app : <React.StrictMode>{app}</React.StrictMode>
)
