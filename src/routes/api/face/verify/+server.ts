import { handleVerifyStudent } from '../_faceHandler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	return handleVerifyStudent(request);
};
