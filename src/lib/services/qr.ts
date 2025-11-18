// QR Code scanning service with sanitization
import jsQR from 'jsqr';

export function scanQRCode(
	videoElement: HTMLVideoElement,
	canvasElement: HTMLCanvasElement
): string | null {
	const canvas = canvasElement;
	const ctx = canvas.getContext('2d');

	if (!ctx) return null;

	canvas.width = videoElement.videoWidth;
	canvas.height = videoElement.videoHeight;

	ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const code = jsQR(imageData.data, imageData.width, imageData.height, {
		inversionAttempts: 'dontInvert'
	});

	if (code && code.data) {
		return sanitizeQRData(code.data);
	}

	return null;
}

export function sanitizeQRData(data: string): string {
	// Whitelist: alphanumeric, hyphen, underscore
	const sanitized = data.replace(/[^A-Za-z0-9\-_]/g, '');

	// Validate format: 5-20 characters
	if (sanitized.length < 5 || sanitized.length > 20) {
		throw new Error('Invalid QR code format');
	}

	return sanitized;
}

export function validateStudentID(id: string): boolean {
	const regex = /^[A-Z0-9\-]{5,20}$/;
	return regex.test(id);
}

export function generateQRCodeData(studentId: string, additionalData?: string): string {
	const timestamp = Date.now();
	const hash = btoa(`${studentId}-${timestamp}`).substring(0, 10);
	return additionalData ? `${studentId}-${hash}-${additionalData}` : `${studentId}-${hash}`;
}
