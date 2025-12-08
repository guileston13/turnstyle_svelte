// Svelte 5 state store for student data
import type { Student } from '../services/db';

let currentStudent = $state<Student | null>(null);
let verificationStatus = $state<'idle' | 'qr_scanning' | 'recognizing' | 'recognized' | 'face_matching' | 'success' | 'failed'>('idle');
let errorMessage = $state<string | null>(null);
let confidenceScore = $state<number>(0);

export const studentStore = {
	get currentStudent() {
		return currentStudent;
	},
	set currentStudent(value: Student | null) {
		currentStudent = value;
	},
	get verificationStatus() {
		return verificationStatus;
	},
	set verificationStatus(value: 'idle' | 'qr_scanning' | 'recognizing' | 'recognized' | 'face_matching' | 'success' | 'failed') {
		verificationStatus = value;
	},
	get errorMessage() {
		return errorMessage;
	},
	set errorMessage(value: string | null) {
		errorMessage = value;
	},
	get confidenceScore() {
		return confidenceScore;
	},
	set confidenceScore(value: number) {
		confidenceScore = value;
	},
	reset() {
		currentStudent = null;
		verificationStatus = 'idle';
		errorMessage = null;
		confidenceScore = 0;
	}
};
