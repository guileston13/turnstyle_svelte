import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTurnstileConnectionStatus } from '$lib/services/turnstile-sse';

export const GET: RequestHandler = async () => {
	return json(getTurnstileConnectionStatus(), {
		headers: {
			'Cache-Control': 'no-store'
		}
	});
};
