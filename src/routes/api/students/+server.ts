// API route for students
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllStudentsMariaDB, addStudentMariaDB, getStudentByIdMariaDB, getStudentByQRCodeMariaDB, updateStudentMariaDB, deleteStudentMariaDB, clearAllDataMariaDB, initializeDatabase } from '$lib/services/mariadb';
import type { Student } from '$lib/services/types';

// Initialize database on first request
let dbInitialized = false;

async function ensureDB() {
	if (!dbInitialized) {
		try {
			console.log('🔄 Initializing database...');
			await initializeDatabase();
			dbInitialized = true;
			console.log('✅ Database initialized successfully');
		} catch (initError) {
			console.error('❌ Database initialization failed:', initError);
			throw initError;
		}
	}
}

export async function GET({ url }: { url: URL }) {
	await ensureDB();

	const id = url.searchParams.get('id');
	const qr = url.searchParams.get('qr');

	try {
		if (id) {
			const student = await getStudentByIdMariaDB(id);
			if (student) {
				// Convert Float32Array to regular array for JSON serialization
				const serializedStudent = {
					...student,
					faceDescriptor: Array.from(student.faceDescriptor)
				};
				return json(serializedStudent);
			}
			return json(null);
		} else if (qr) {
			const student = await getStudentByQRCodeMariaDB(qr);
			if (student) {
				const serializedStudent = {
					...student,
					faceDescriptor: Array.from(student.faceDescriptor)
				};
				return json(serializedStudent);
			}
			return json(null);
		} else {
			const students = await getAllStudentsMariaDB();
			const serializedStudents = students.map(student => ({
				...student,
				faceDescriptor: Array.from(student.faceDescriptor)
			}));
			return json(serializedStudents);
		}
	} catch (error) {
		console.error('GET /api/students error:', error);
		return json({ error: 'Database error' }, { status: 500 });
	}
}

export async function POST({ request }: { request: Request }) {
	await ensureDB();

	try {
		const studentData = await request.json();
		
		// Convert faceDescriptor back to Float32Array
		if (studentData.faceDescriptor) {
			studentData.faceDescriptor = new Float32Array(studentData.faceDescriptor);
		}
		
		await addStudentMariaDB(studentData);
		return json({ success: true });
	} catch (error) {
		console.error('POST /api/students error:', error);
		return json({ error: 'Failed to add student' }, { status: 500 });
	}
}

export async function PUT({ request, url }: { request: Request; url: URL }) {
	await ensureDB();

	const id = url.searchParams.get('id');
	if (!id) {
		return json({ error: 'Student ID required' }, { status: 400 });
	}

	try {
		const updates = await request.json();
		
		// Convert faceDescriptor back to Float32Array if present
		if (updates.faceDescriptor) {
			updates.faceDescriptor = new Float32Array(updates.faceDescriptor);
		}
		
		await updateStudentMariaDB(id, updates);
		return json({ success: true });
	} catch (error) {
		console.error('PUT /api/students error:', error);
		return json({ error: 'Failed to update student' }, { status: 500 });
	}
}

export async function DELETE({ url }: { url: URL }) {
	await ensureDB();

	const id = url.searchParams.get('id');
	const clearAll = url.searchParams.get('clearAll');

	try {
		if (clearAll === 'true') {
			await clearAllDataMariaDB();
			return json({ success: true });
		} else if (id) {
			await deleteStudentMariaDB(id);
			return json({ success: true });
		} else {
			return json({ error: 'ID or clearAll parameter required' }, { status: 400 });
		}
	} catch (error) {
		console.error('DELETE /api/students error:', error);
		return json({ error: 'Failed to delete' }, { status: 500 });
	}
}