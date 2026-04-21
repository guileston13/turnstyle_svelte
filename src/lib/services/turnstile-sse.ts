// Turnstile SSE utilities
// Store active SSE connections
const clients = new Set<ReadableStreamDefaultController>();
let lastConnectedAt: number | null = null;
let lastDisconnectedAt: number | null = null;

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
			removeSSEClient(controller);
		}
	});
}

// Add a client to the SSE connections
export function addSSEClient(controller: ReadableStreamDefaultController) {
	clients.add(controller);
	lastConnectedAt = Date.now();
	console.log(`📡 SSE Client connected. Total clients: ${clients.size}`);
}

// Remove a client from SSE connections
export function removeSSEClient(controller: ReadableStreamDefaultController) {
	if (clients.delete(controller)) {
		lastDisconnectedAt = Date.now();
		console.log(`📡 SSE Client disconnected. Total clients: ${clients.size}`);
	}
}

export function getTurnstileConnectionStatus() {
	return {
		connectedClients: clients.size,
		raspiConnected: clients.size > 0,
		lastConnectedAt,
		lastDisconnectedAt
	};
}
