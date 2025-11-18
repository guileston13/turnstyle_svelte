// Input validation and sanitization utilities
export function sanitizeInput(input: string): string {
	return input.trim().replace(/[<>]/g, '');
}

export function validateEmail(email: string): boolean {
	const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return regex.test(email);
}

export function validatePhone(phone: string): boolean {
	const regex = /^\+?[\d\s\-()]{10,20}$/;
	return regex.test(phone);
}

export function validateStudentID(id: string): boolean {
	const regex = /^[A-Z0-9\-]{5,20}$/;
	return regex.test(id);
}

export function escapeHTML(str: string): string {
	const div = document.createElement('div');
	div.textContent = str;
	return div.innerHTML;
}

export function validateName(name: string): boolean {
	return name.length >= 2 && name.length <= 100 && /^[a-zA-Z\s\-'.]+$/.test(name);
}

export function validateProgram(program: string): boolean {
	return program.length >= 2 && program.length <= 100;
}

export function validateYear(year: number): boolean {
	const currentYear = new Date().getFullYear();
	return year >= 1900 && year <= currentYear + 10;
}
