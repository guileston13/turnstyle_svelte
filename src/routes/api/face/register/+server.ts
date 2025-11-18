import { handleRegister } from '../_faceHandler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	return handleRegister(request);
};
