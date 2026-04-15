import { hasLiveVideoTrack } from './camera';

// Face detection service - optimized for speed with WASM backend
// WASM is faster than WebGL for face detection
let faceapi: any = null;
let faceapiPromise: Promise<any> | null = null;

// Standard dimensions for all face processing
const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 480;
const MODEL_URL = '/models';
const MODEL_NAMES = ['tinyFaceDetector', 'faceLandmark68Net', 'faceRecognitionNet'] as const;

async function loadFaceAPI() {
	if (faceapi) return faceapi;
	if (faceapiPromise) return faceapiPromise;
	if (typeof window === 'undefined') {
		throw new Error('Face API can only be used in browser environment');
	}

	faceapiPromise = (async () => {
		const faceapiModule = await import('@vladmandic/face-api');

		if (faceapiModule.tf) {
			try {
				const { setWasmPaths } = await import('@tensorflow/tfjs-backend-wasm');
				setWasmPaths('/');

				await faceapiModule.tf.setBackend('wasm');
				await faceapiModule.tf.ready();
				console.log('Face API loaded, TF backend:', faceapiModule.tf.getBackend());
			} catch (err) {
				console.warn('WASM backend failed:', err);
			}
		}

		faceapi = faceapiModule;
		return faceapiModule;
	})();

	try {
		return await faceapiPromise;
	} catch (error) {
		faceapiPromise = null;
		throw error;
	}
}

let modelsLoaded = false;
let loadProgress = 0;
let modelsPromise: Promise<void> | null = null;
const progressListeners = new Set<(progress: number) => void>();

function emitProgress(progress: number) {
	loadProgress = progress;
	for (const listener of progressListeners) {
		listener(progress);
	}
}

export async function loadModels(onProgress?: (progress: number) => void): Promise<void> {
	if (onProgress) {
		progressListeners.add(onProgress);
		onProgress(loadProgress);
	}

	if (modelsLoaded) {
		emitProgress(100);
		if (onProgress) progressListeners.delete(onProgress);
		return;
	}

	if (!modelsPromise) {
		modelsPromise = (async () => {
			const modelLoadStart = Date.now();
			const faceapiModule = await loadFaceAPI();
			let completed = 0;

			await Promise.all(
				MODEL_NAMES.map(async (modelName) => {
					await faceapiModule.nets[modelName].loadFromUri(MODEL_URL);
					completed += 1;
					emitProgress((completed / MODEL_NAMES.length) * 100);
				})
			);

			modelsLoaded = true;
			emitProgress(100);
			console.log(`Face detection models loaded in ${Date.now() - modelLoadStart}ms`);
		})().catch((error) => {
			modelsPromise = null;
			modelsLoaded = false;
			emitProgress(0);
			throw error;
		});
	}

	try {
		await modelsPromise;
	} finally {
		if (onProgress) {
			progressListeners.delete(onProgress);
		}
	}
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

	if (!srcWidth || !srcHeight) {
		throw new Error('Camera frame is not ready yet.');
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
		offsetX / scale,
		offsetY / scale,
		TARGET_WIDTH / scale,
		TARGET_HEIGHT / scale,
		0,
		0,
		TARGET_WIDTH,
		TARGET_HEIGHT
	);

	// Apply grayscale if requested (for registration to improve TinyFace accuracy)
	if (applyGrayscale) {
		const imageData = ctx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
		const data = imageData.data;
		for (let i = 0; i < data.length; i += 4) {
			const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
			data[i] = gray;
			data[i + 1] = gray;
			data[i + 2] = gray;
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
		.detectSingleFace(
			processedCanvas,
			new faceapiModule.TinyFaceDetectorOptions({
				inputSize: 320,
				scoreThreshold: 0.5
			})
		)
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
		.detectAllFaces(
			processedCanvas,
			new faceapiModule.TinyFaceDetectorOptions({
				inputSize: 416,
				scoreThreshold: 0.5
			})
		)
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
	const stream = videoElement.srcObject;

	if (!(stream instanceof MediaStream)) {
		throw new Error('Video element has no active camera stream.');
	}

	if (!hasLiveVideoTrack(stream)) {
		throw new Error('Camera stream ended. Please check the physical connection and try again.');
	}

	// Check if video is ready
	if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
		throw new Error('Video element not ready - no video dimensions');
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
	const stream = videoElement.srcObject;

	if (!(stream instanceof MediaStream)) {
		throw new Error('Video element has no active camera stream.');
	}

	if (!hasLiveVideoTrack(stream)) {
		throw new Error('Camera stream ended. Please check the physical connection and try again.');
	}

	const canvas = centerCropToCanvas(videoElement, applyGrayscale);
	return canvas.toDataURL('image/jpeg', quality);
}

export function getModelsLoaded(): boolean {
	return modelsLoaded;
}

export function getLoadProgress(): number {
	return loadProgress;
}
