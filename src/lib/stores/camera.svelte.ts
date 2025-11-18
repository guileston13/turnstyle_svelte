// Svelte 5 state store for camera management
let stream = $state<MediaStream | null>(null);
let isActive = $state<boolean>(false);
let error = $state<string | null>(null);
let permissionStatus = $state<'prompt' | 'granted' | 'denied'>('prompt');

export const cameraStore = {
	get stream() {
		return stream;
	},
	set stream(value: MediaStream | null) {
		stream = value;
		isActive = value !== null;
	},
	get isActive() {
		return isActive;
	},
	get error() {
		return error;
	},
	set error(value: string | null) {
		error = value;
	},
	get permissionStatus() {
		return permissionStatus;
	},
	set permissionStatus(value: 'prompt' | 'granted' | 'denied') {
		permissionStatus = value;
	},
	stopCamera() {
		if (stream) {
			stream.getTracks().forEach((track) => track.stop());
			stream = null;
			isActive = false;
		}
	},
	reset() {
		this.stopCamera();
		error = null;
		permissionStatus = 'prompt';
	}
};
