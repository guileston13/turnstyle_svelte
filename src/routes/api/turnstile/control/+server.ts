// Endpoint to trigger turnstile unlock/lock
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { broadcastTurnstileEvent } from '../+server';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { action, studentId, studentName, device } = await request.json();

		if (action === 'unlock') {
			console.log(`🔓 TURNSTILE UNLOCK - Student: ${studentName || studentId} | Device: ${device || 'all'}`);
			broadcastTurnstileEvent('unlock', { studentId, studentName, device });
			return json({ success: true, action: 'unlock', studentId, studentName });
		}

		if (action === 'lock') {
			console.log(`🔒 TURNSTILE LOCK | Device: ${device || 'all'}`);
			broadcastTurnstileEvent('lock', { device });
			return json({ success: true, action: 'lock' });
		}

		if (action === 'verified') {
			console.log(`✅ VERIFIED - Student: ${studentName || studentId} | Device: ${device || 'all'}`);
			broadcastTurnstileEvent('verified', { studentId, studentName, device });
			return json({ success: true, action: 'verified', studentId, studentName });
		}

		if (action === 'failed') {
			console.log(`❌ FAILED - Device: ${device || 'all'}`);
			broadcastTurnstileEvent('failed', { device });
			return json({ success: true, action: 'failed' });
		}

		return json({ success: false, error: 'Invalid action' }, { status: 400 });
	} catch (err) {
		console.error('❌ Turnstile control error:', err);
		return json({ success: false, error: String(err) }, { status: 500 });
	}
};
