// Shared types for the application
export interface Student {
	id: string;
	name: string;
	email: string;
	phone?: string;
	program?: string;
	year?: number;
	faceDescriptor: Float32Array;
	qrCodeData: string;
	consentGiven: boolean;
	consentDate?: Date;
	createdAt: Date;
	updatedAt: Date;
}