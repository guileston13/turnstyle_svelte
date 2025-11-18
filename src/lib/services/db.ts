// MariaDB API wrapper
import type { Student } from './types';

export { type Student } from './types';

let dbInitialized = false;

export async function initDB(): Promise<void> {
	if (dbInitialized) return;
	
	try {
		// Try to call the API to ensure database is initialized
		const response = await fetch('/api/students');
		if (response.ok) {
			dbInitialized = true;
		} else {
			// If API fails, still mark as initialized to allow the UI to work
			console.warn('Database API not ready, but allowing UI to proceed');
			dbInitialized = true;
		}
	} catch (error) {
		console.warn('Database connection failed, but allowing UI to proceed:', error);
		// Don't throw error - allow the UI to work even if database is down
		dbInitialized = true;
	}
}

export async function addStudent(student: Omit<Student, 'createdAt' | 'updatedAt'>): Promise<void> {
	const studentData = {
		...student,
		faceDescriptor: Array.from(student.faceDescriptor)
	};
	
	const response = await fetch('/api/students', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(studentData)
	});
	
	if (!response.ok) {
		throw new Error('Failed to add student');
	}
}

export async function getStudentById(id: string): Promise<Student | undefined> {
	const response = await fetch(`/api/students?id=${encodeURIComponent(id)}`);
	
	if (!response.ok) {
		throw new Error('Failed to get student');
	}
	
	const data = await response.json();
	if (!data) return undefined;
	
	return {
		...data,
		faceDescriptor: new Float32Array(data.faceDescriptor)
	};
}

export async function getStudentByQRCode(qrCode: string): Promise<Student | undefined> {
	const response = await fetch(`/api/students?qr=${encodeURIComponent(qrCode)}`);
	
	if (!response.ok) {
		throw new Error('Failed to get student');
	}
	
	const data = await response.json();
	if (!data) return undefined;
	
	return {
		...data,
		faceDescriptor: new Float32Array(data.faceDescriptor)
	};
}

export async function getAllStudents(): Promise<Student[]> {
	const response = await fetch('/api/students');
	
	if (!response.ok) {
		throw new Error('Failed to get students');
	}
	
	const data = await response.json();
	
	return data.map((student: any) => ({
		...student,
		faceDescriptor: new Float32Array(student.faceDescriptor)
	}));
}

export async function updateStudent(id: string, updates: Partial<Student>): Promise<void> {
	const updateData = {
		...updates,
		faceDescriptor: updates.faceDescriptor ? Array.from(updates.faceDescriptor) : undefined
	};
	
	const response = await fetch(`/api/students?id=${encodeURIComponent(id)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(updateData)
	});
	
	if (!response.ok) {
		throw new Error('Failed to update student');
	}
}

export async function deleteStudent(id: string): Promise<void> {
	const response = await fetch(`/api/students?id=${encodeURIComponent(id)}`, {
		method: 'DELETE'
	});
	
	if (!response.ok) {
		throw new Error('Failed to delete student');
	}
}

export async function clearAllData(): Promise<void> {
	const response = await fetch('/api/students?clearAll=true', {
		method: 'DELETE'
	});
	
	if (!response.ok) {
		throw new Error('Failed to clear data');
	}
}
