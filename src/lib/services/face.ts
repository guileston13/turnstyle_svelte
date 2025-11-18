// Face detection service with Web Worker support
// Dynamic import to avoid SSR issues
let faceapi: any = null;

async function loadFaceAPI() {
	if (faceapi) return faceapi;
	if (typeof window === 'undefined') {
		throw new Error('Face API can only be used in browser environment');
	}
	const faceapiModule = await import('@vladmandic/face-api');
	faceapi = faceapiModule;
	return faceapi;
}

let modelsLoaded = false;
let loadProgress = 0;

export async function loadModels(onProgress?: (progress: number) => void): Promise<void> {
	if (modelsLoaded) return;

	const faceapiModule = await loadFaceAPI();
	const MODEL_URL = '/models';
	const models = ['tinyFaceDetector', 'faceLandmark68Net', 'faceRecognitionNet'];

	for (let i = 0; i < models.length; i++) {
		const modelName = models[i] as 'tinyFaceDetector' | 'faceRecognitionNet';
		await faceapiModule.nets[modelName].loadFromUri(MODEL_URL);
		loadProgress = ((i + 1) / models.length) * 100;
		if (onProgress) onProgress(loadProgress);
	}

	modelsLoaded = true;
	console.log('✅ Face detection models loaded');
}

export async function detectFace(
	imageElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<any | null> {
	if (!modelsLoaded) {
		throw new Error('Models not loaded. Call loadModels() first.');
	}

	const faceapiModule = await loadFaceAPI();
	const detection = await faceapiModule
		.detectSingleFace(imageElement, new faceapiModule.TinyFaceDetectorOptions())
		.withFaceLandmarks()
		.withFaceDescriptor();

	return detection || null;
}

export async function detectAllFaces(
	imageElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<any[]> {
	if (!modelsLoaded) {
		throw new Error('Models not loaded. Call loadModels() first.');
	}

	const faceapiModule = await loadFaceAPI();
	const detections = await faceapiModule
		.detectAllFaces(imageElement, new faceapiModule.TinyFaceDetectorOptions())
		.withFaceLandmarks()
		.withFaceDescriptors();

	return detections;
}

export async function compareFaces(
	descriptor1: Float32Array,
	descriptor2: Float32Array,
	threshold: number = 0.6
): Promise<{ match: boolean; distance: number; confidence: number }> {
	const faceapiModule = await loadFaceAPI();
	const distance = faceapiModule.euclideanDistance(descriptor1, descriptor2);
	const match = distance < threshold;
	const confidence = Math.max(0, Math.min(1, 1 - distance));

	return { match, distance, confidence };
}

export async function captureFrame(videoElement: HTMLVideoElement): Promise<HTMLCanvasElement> {
	const canvas = document.createElement('canvas');

	// Check if video is ready
	if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
		throw new Error('Video element not ready - no video dimensions');
	}

	if (!videoElement.srcObject) {
		throw new Error('Video element has no source');
	}

	canvas.width = videoElement.videoWidth;
	canvas.height = videoElement.videoHeight;
	const ctx = canvas.getContext('2d');

	if (!ctx) throw new Error('Could not get canvas context');

	ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
	return canvas;
}

export function getModelsLoaded(): boolean {
	return modelsLoaded;
}

export function getLoadProgress(): number {
	return loadProgress;
}
