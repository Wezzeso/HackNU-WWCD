import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'

function getErrorCopy(error: unknown) {
	if (isRouteErrorResponse(error)) {
		return {
			title: `${error.status} ${error.statusText}`.trim(),
			description:
				typeof error.data === 'string'
					? error.data
					: 'The page could not be loaded. Try refreshing or going back to the workspace home.',
		}
	}

	if (error instanceof Error) {
		return {
			title: 'Something went wrong',
			description: error.message,
		}
	}

	return {
		title: 'Something went wrong',
		description: 'The page could not be loaded. Try refreshing and open the room again.',
	}
}

export function RouteErrorBoundary() {
	const error = useRouteError()
	const { title, description } = getErrorCopy(error)

	return (
		<div
			style={{
				minHeight: '100vh',
				display: 'grid',
				placeItems: 'center',
				padding: '24px',
				background:
					'radial-gradient(circle at top, rgba(34, 197, 94, 0.18), transparent 40%), #050816',
				color: '#f8fafc',
			}}
		>
			<div
				style={{
					width: 'min(100%, 560px)',
					borderRadius: '24px',
					padding: '32px',
					background: 'rgba(15, 23, 42, 0.88)',
					border: '1px solid rgba(148, 163, 184, 0.24)',
					boxShadow: '0 24px 80px rgba(15, 23, 42, 0.45)',
				}}
			>
				<p
					style={{
						margin: 0,
						fontSize: '12px',
						letterSpacing: '0.18em',
						textTransform: 'uppercase',
						color: '#86efac',
					}}
				>
					Workspace issue
				</p>
				<h1 style={{ margin: '12px 0 0', fontSize: '32px', lineHeight: 1.1 }}>{title}</h1>
				<p style={{ margin: '16px 0 0', color: '#cbd5e1', lineHeight: 1.6 }}>{description}</p>
				<div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '24px' }}>
					<button
						type="button"
						onClick={() => window.location.reload()}
						style={{
							border: 0,
							borderRadius: '999px',
							padding: '12px 18px',
							background: '#22c55e',
							color: '#052e16',
							fontWeight: 700,
							cursor: 'pointer',
						}}
					>
						Refresh app
					</button>
					<Link
						to="/"
						style={{
							borderRadius: '999px',
							padding: '12px 18px',
							border: '1px solid rgba(148, 163, 184, 0.3)',
							color: '#f8fafc',
							textDecoration: 'none',
							fontWeight: 600,
						}}
					>
						Go to home
					</Link>
				</div>
			</div>
		</div>
	)
}
