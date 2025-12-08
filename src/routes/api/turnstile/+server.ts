// Server-Sent Events endpoint for turnstile control
import type { RequestHandler } from './$types';
import { addSSEClient, removeSSEClient } from '$lib/services/turnstile-sse';

export const GET: RequestHandler = async () => {
	let controllerRef: ReadableStreamDefaultController;
	let heartbeatInterval: ReturnType<typeof setInterval>;

	const stream = new ReadableStream({
		start(controller) {
			controllerRef = controller;
			addSSEClient(controller);

			// Send initial connection confirmation
			controller.enqueue(`data: ${JSON.stringify({ event: 'connected', timestamp: Date.now() })}\n\n`);

			// Heartbeat every 30 seconds to keep connection alive
			heartbeatInterval = setInterval(() => {
				try {
					controller.enqueue(`: heartbeat\n\n`);
				} catch {
					clearInterval(heartbeatInterval);
					removeSSEClient(controller);
				}
			}, 30000);
		},
		cancel() {
			clearInterval(heartbeatInterval);
			removeSSEClient(controllerRef);
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
