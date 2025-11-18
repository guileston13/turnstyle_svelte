// API route for student store operations
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addStudentToStore, getAllStudentsFromStore, getStudentFromStore } from '$lib/services/mariadb';

// Initialize database on first request
let dbInitialized = false;

async function ensureDB() {
	if (!dbInitialized) {
		try {
			// Import and initialize database
			const { initializeDatabase } = await import('$lib/services/mariadb');
			await initializeDatabase();
			dbInitialized = true;
		} catch (initError) {
			console.error('❌ Database initialization failed:', initError);
			throw initError;
		}
	}
}

export async function GET({ url }: { url: URL }) {
	await ensureDB();

	const id = url.searchParams.get('id');

	try {
		if (id) {
			const student = await getStudentFromStore(id);
			return json(student || null);
		} else {
			const students = await getAllStudentsFromStore();
			return json(students);
		}
	} catch (error) {
		console.error('GET /api/student-store error:', error);
		return json({ error: 'Database error' }, { status: 500 });
	}
}

export async function POST({ request }: { request: Request }) {
	await ensureDB();

	try {
		const studentData = await request.json();

		if (!studentData.id || !studentData.name || !studentData.email) {
			return json({ error: 'Missing required fields: id, name, email' }, { status: 400 });
		}

		await addStudentToStore({
			id: studentData.id,
			name: studentData.name,
			email: studentData.email,
			phone: studentData.phone,
			program: studentData.program,
			year: studentData.year
		});

		return json({ success: true, message: 'Student added to store successfully' });
	} catch (error) {
		console.error('POST /api/student-store error:', error);
		return json({ error: 'Failed to add student to store' }, { status: 500 });
	}
}