import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Sparkles, DoorOpen, Plus, Link as LinkIcon, ArrowRight } from 'lucide-react'

function createRoomId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `room-${crypto.randomUUID()}`
	}
	return `room-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function Root() {
	const navigate = useNavigate()
	const [joinRoomId, setJoinRoomId] = useState('')

	const handleCreateRoom = () => {
		const newRoomId = createRoomId()
		navigate(`/${newRoomId}`)
	}

	const handleJoinRoom = (e: React.FormEvent) => {
		e.preventDefault()
		if (joinRoomId.trim()) {
			navigate(`/${joinRoomId.trim()}`)
		}
	}

	return (
		<div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 overflow-hidden relative">
			{/* Background gradients */}
			<div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
			<div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent/30 blur-[120px] rounded-full pointer-events-none" />

			<div className="z-10 w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
				<div className="space-y-6">
					<Badge variant="secondary" className="gap-1.5 py-1 px-3">
						<Sparkles className="h-3.5 w-3.5 text-primary" />
						Next-Gen Collaboration
					</Badge>
					<h1 className="text-5xl font-extrabold tracking-tight lg:text-6xl text-foreground">
						Create, Share, and <span className="text-primary">Collaborate In Real-Time.</span>
					</h1>
					<p className="text-xl text-muted-foreground max-w-lg">
						Start a new infinite canvas room or join an existing one to experience seamless collaboration with AI powered assistance.
					</p>
					<div className="flex flex-col sm:flex-row gap-4 pt-4">
						<Button onClick={handleCreateRoom} className="gap-2 h-12 px-8 text-base shadow-lg transition-transform hover:-translate-y-1">
							<Plus className="h-5 w-5" />
							Create New Room
						</Button>
					</div>
				</div>

				<div className="flex justify-center md:justify-end">
					<Card className="w-full max-w-md shadow-2xl border-border/50 bg-card/80 backdrop-blur-xl">
						<CardHeader className="space-y-2">
							<CardTitle className="text-2xl font-bold flex items-center gap-2">
								<DoorOpen className="h-6 w-6 text-primary" />
								Join a Room
							</CardTitle>
							<CardDescription>
								Enter a room ID or paste a link to join your team.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<form onSubmit={handleJoinRoom} className="space-y-4">
								<div className="space-y-2">
									<label htmlFor="roomId" className="text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
										Room ID
									</label>
									<div className="relative">
										<LinkIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
										<Input
											id="roomId"
											placeholder="e.g. room-1234-abcd"
											className="pl-9 h-10 border-border/50 focus-visible:ring-primary/50"
											value={joinRoomId}
											onChange={(e) => setJoinRoomId(e.target.value)}
										/>
									</div>
								</div>
								<Button type="submit" className="w-full gap-2 transition-transform hover:-translate-y-0.5 active:translate-y-0" variant="secondary" disabled={!joinRoomId.trim()}>
									Join Workspace
									<ArrowRight className="h-4 w-4" />
								</Button>
							</form>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	)
}
