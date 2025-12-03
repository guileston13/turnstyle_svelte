// Face detection service with Web Worker support
// Dynamic import to avoid SSR issues
let faceapi: any = null;

// Standard dimensions for all face processing
const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 480;

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

/**
 * Center-crop an image to target dimensions without stretching/compressing.
 * If the source is larger than target, it crops from center.
 * Returns a canvas with exactly TARGET_WIDTH x TARGET_HEIGHT dimensions.
 */
export function centerCropToCanvas(
	source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
	applyGrayscale: boolean = false
): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = TARGET_WIDTH;
	canvas.height = TARGET_HEIGHT;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not get canvas context');

	// Get source dimensions
	let srcWidth: number, srcHeight: number;
	if (source instanceof HTMLVideoElement) {
		srcWidth = source.videoWidth;
		srcHeight = source.videoHeight;
	} else if (source instanceof HTMLImageElement) {
		srcWidth = source.naturalWidth || source.width;
		srcHeight = source.naturalHeight || source.height;
	} else {
		srcWidth = source.width;
		srcHeight = source.height;
	}

	// Calculate the scaling factor to fill the target (cover strategy)
	const scale = Math.max(TARGET_WIDTH / srcWidth, TARGET_HEIGHT / srcHeight);
	const scaledWidth = srcWidth * scale;
	const scaledHeight = srcHeight * scale;

	// Calculate crop offsets to center the image
	const offsetX = (scaledWidth - TARGET_WIDTH) / 2;
	const offsetY = (scaledHeight - TARGET_HEIGHT) / 2;

	// Draw the centered, cropped image
	ctx.drawImage(
		source,
		offsetX / scale, offsetY / scale, // Source position (in original coords)
		TARGET_WIDTH / scale, TARGET_HEIGHT / scale, // Source dimensions to extract
		0, 0, // Destination position
		TARGET_WIDTH, TARGET_HEIGHT // Destination dimensions
	);

	// Apply grayscale if requested (for registration to improve TinyFace accuracy)
	if (applyGrayscale) {
		const imageData = ctx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
		const data = imageData.data;
		for (let i = 0; i < data.length; i += 4) {
			const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
			data[i] = gray;     // R
			data[i + 1] = gray; // G
			data[i + 2] = gray; // B
			// Alpha stays the same
		}
		ctx.putImageData(imageData, 0, 0);
	}

	return canvas;
}

export async function detectFace(
	imageElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
	useGrayscale: boolean = false
): Promise<any | null> {
	if (!modelsLoaded) {
		throw new Error('Models not loaded. Call loadModels() first.');
	}

	const faceapiModule = await loadFaceAPI();
	
	// Pre-process: center-crop to 640x480 without distortion
	const processedCanvas = centerCropToCanvas(imageElement, useGrayscale);
	
	const detection = await faceapiModule
		.detectSingleFace(processedCanvas, new faceapiModule.TinyFaceDetectorOptions({
			inputSize: 416, // Smaller input for faster detection
			scoreThreshold: 0.5
		}))
		.withFaceLandmarks()
		.withFaceDescriptor();

	return detection || null;
}

export async function detectAllFaces(
	imageElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
	useGrayscale: boolean = false
): Promise<any[]> {
	if (!modelsLoaded) {
		throw new Error('Models not loaded. Call loadModels() first.');
	}

	const faceapiModule = await loadFaceAPI();
	
	// Pre-process: center-crop to 640x480 without distortion
	const processedCanvas = centerCropToCanvas(imageElement, useGrayscale);
	
	const detections = await faceapiModule
		.detectAllFaces(processedCanvas, new faceapiModule.TinyFaceDetectorOptions({
			inputSize: 416,
			scoreThreshold: 0.5
		}))
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

/**
 * Capture a frame from video, center-cropped to exactly 640x480.
 * No stretching or compression - just crops from center.
 */
export async function captureFrame(
	videoElement: HTMLVideoElement,
	applyGrayscale: boolean = false
): Promise<HTMLCanvasElement> {
	// Check if video is ready
	if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
		throw new Error('Video element not ready - no video dimensions');
	}

	if (!videoElement.srcObject) {
		throw new Error('Video element has no source');
	}

	// Use center-crop to get exactly 640x480 without distortion
	return centerCropToCanvas(videoElement, applyGrayscale);
}

/**
 * Capture a frame and return as base64 JPEG for sending to server.
 * Always outputs 640x480 center-cropped image.
 */
export function captureFrameAsBase64(
	videoElement: HTMLVideoElement,
	applyGrayscale: boolean = false,
	quality: number = 0.92
): string {
	const canvas = centerCropToCanvas(videoElement, applyGrayscale);
	return canvas.toDataURL('image/jpeg', quality);
}

export function getModelsLoaded(): boolean {
	return modelsLoaded;
}

export function getLoadProgress(): number {
	return loadProgress;
}
