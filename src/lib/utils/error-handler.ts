// Centralized error handling
export enum ErrorType {
	CAMERA_DENIED = 'CAMERA_DENIED',
	QR_INVALID = 'QR_INVALID',
	STUDENT_NOT_FOUND = 'STUDENT_NOT_FOUND',
	FACE_NO_MATCH = 'FACE_NO_MATCH',
	MODELS_LOAD_FAILED = 'MODELS_LOAD_FAILED',
	DB_ERROR = 'DB_ERROR',
	VALIDATION_ERROR = 'VALIDATION_ERROR',
	NETWORK_ERROR = 'NETWORK_ERROR',
	ENCRYPTION_ERROR = 'ENCRYPTION_ERROR',
	TIMEOUT = 'TIMEOUT'
}

const ERROR_MESSAGES: Record<ErrorType, string> = {
	[ErrorType.CAMERA_DENIED]: 'Camera access denied. Please enable camera permissions in your browser.',
	[ErrorType.QR_INVALID]: 'Invalid QR code. Please scan a valid student ID QR code.',
	[ErrorType.STUDENT_NOT_FOUND]: 'Student not found in database. Please register first.',
	[ErrorType.FACE_NO_MATCH]: 'Face does not match the registered student. Please try again.',
	[ErrorType.MODELS_LOAD_FAILED]: 'Failed to load AI models. Please refresh the page.',
	[ErrorType.DB_ERROR]: 'Database error occurred. Please try again later.',
	[ErrorType.VALIDATION_ERROR]: 'Invalid input data. Please check your information.',
	[ErrorType.NETWORK_ERROR]: 'Network error. Please check your connection.',
	[ErrorType.ENCRYPTION_ERROR]: 'Encryption error occurred. Please try again.',
	[ErrorType.TIMEOUT]: 'Operation timed out. Please try again.'
};

export function handleError(type: ErrorType, details?: string): string {
	console.error(`[${type}] ${details || ERROR_MESSAGES[type]}`);
	return ERROR_MESSAGES[type];
}

export class AppError extends Error {
	constructor(public type: ErrorType, message?: string) {
		super(message || ERROR_MESSAGES[type]);
		this.name = 'AppError';
	}
}
