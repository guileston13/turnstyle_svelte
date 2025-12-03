// Server-Sent Events endpoint for turnstile control
import type { RequestHandler } from './$types';

// Store active SSE connections
const clients = new Set<ReadableStreamDefaultController>();

// Broadcast event to all connected clients (or specific device)
export function broadcastTurnstileEvent(
	event: 'unlock' | 'lock' | 'verified' | 'failed',
	data?: { studentId?: string; studentName?: string; device?: string }
) {
	const payload = JSON.stringify({
		event,
		device: data?.device || 'all',
		studentId: data?.studentId,
		studentName: data?.studentName,
		timestamp: Date.now()
	});

	console.log(`📡 Broadcasting SSE: ${payload}`);

	clients.forEach((controller) => {
		try {
			controller.enqueue(`data: ${payload}\n\n`);
		} catch {
			clients.delete(controller);
		}
	});
}

export const GET: RequestHandler = async () => {
	let controllerRef: ReadableStreamDefaultController;
	let heartbeatInterval: ReturnType<typeof setInterval>;

	const stream = new ReadableStream({
		start(controller) {
			controllerRef = controller;
			clients.add(controller);
			console.log(`📡 SSE Client connected. Total clients: ${clients.size}`);

			// Send initial connection confirmation
			controller.enqueue(`data: ${JSON.stringify({ event: 'connected', timestamp: Date.now() })}\n\n`);

			// Heartbeat every 30 seconds to keep connection alive
			heartbeatInterval = setInterval(() => {
				try {
					controller.enqueue(`: heartbeat\n\n`);
				} catch {
					clearInterval(heartbeatInterval);
					clients.delete(controller);
				}
			}, 30000);
		},
		cancel() {
			console.log(`📡 SSE Client disconnected. Total clients: ${clients.size - 1}`);
			clearInterval(heartbeatInterval);
			clients.delete(controllerRef);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'Access-Control-Allow-Origin': '*',
			'X-Accel-Buffering': 'no'
		}
	});
};
