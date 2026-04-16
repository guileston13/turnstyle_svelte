<<<<<<< HEAD
// Shared browser camera helpers for consistent startup and disconnect handling.

export const CAMERA_DISCONNECTED_MESSAGE =
	'Camera connection lost. Please check the physical connection and try again.';

export const DEFAULT_CAMERA_ATTEMPTS: MediaStreamConstraints[] = [
	{
		audio: false,
		video: {
			facingMode: 'user',
			width: { ideal: 1280 },
			height: { ideal: 720 }
		}
	},
	{
		audio: false,
		video: {
			facingMode: 'user',
			width: { ideal: 640 },
			height: { ideal: 480 }
		}
	},
	{
		audio: false,
		video: {
			facingMode: 'user'
		}
	},
	{
		audio: false,
		video: true
	}
];

export function getCameraErrorMessage(error: unknown, fallback = 'Unable to access camera.'): string {
	if (error instanceof DOMException) {
		switch (error.name) {
			case 'NotAllowedError':
			case 'PermissionDeniedError':
				return 'Camera access was denied. Please allow camera access in your browser.';
			case 'NotFoundError':
			case 'DevicesNotFoundError':
				return 'No camera was found. Please check the physical connection and try again.';
			case 'NotReadableError':
			case 'TrackStartError':
				return 'Camera is busy or unavailable. Reconnect it, then try again.';
			case 'OverconstrainedError':
			case 'ConstraintNotSatisfiedError':
				return 'This camera does not support the requested settings. Please try again.';
			case 'AbortError':
				return 'Camera startup was interrupted. Please try again.';
			case 'SecurityError':
				return 'Browser security blocked camera access. Please use HTTPS or localhost.';
			default:
				return error.message || fallback;
		}
	}

	if (error instanceof Error) {
		return error.message || fallback;
	}

	if (typeof error === 'string' && error.trim()) {
		return error;
	}

	return fallback;
}

export function hasLiveVideoTrack(stream: MediaStream | null | undefined): boolean {
	if (!stream?.active) {
		return false;
	}

	const [videoTrack] = stream.getVideoTracks();
	return Boolean(videoTrack && videoTrack.readyState === 'live');
}

export async function requestCameraStream(
	attempts: MediaStreamConstraints[] = DEFAULT_CAMERA_ATTEMPTS
): Promise<MediaStream> {
	let lastError: unknown = new Error('Unable to access camera.');

	for (const constraints of attempts) {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				...constraints
			});

			if (hasLiveVideoTrack(stream)) {
				return stream;
			}

			stopMediaStream(stream);
			lastError = new Error('Camera stream started without an active video track.');
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
	if (!stream) {
		return;
	}

	for (const track of stream.getTracks()) {
		track.stop();
	}
}

export function detachVideoStream(videoElement: HTMLVideoElement | null | undefined): void {
	if (!videoElement) {
		return;
	}

	videoElement.pause();
	videoElement.srcObject = null;
}

async function waitForVideoMetadata(videoElement: HTMLVideoElement): Promise<void> {
	if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
			cleanup();
			reject(new Error('Camera video could not be initialized.'));
		}, 4000);

		const handleReady = () => {
			if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
				return;
			}

			cleanup();
			resolve();
		};

		const handleError = () => {
			cleanup();
			reject(new Error('Camera video failed to load.'));
		};

		const cleanup = () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}

			videoElement.removeEventListener('loadedmetadata', handleReady);
			videoElement.removeEventListener('loadeddata', handleReady);
			videoElement.removeEventListener('canplay', handleReady);
			videoElement.removeEventListener('error', handleError);
		};

		videoElement.addEventListener('loadedmetadata', handleReady);
		videoElement.addEventListener('loadeddata', handleReady);
		videoElement.addEventListener('canplay', handleReady);
		videoElement.addEventListener('error', handleError);
	});
}

export async function attachStreamToVideo(
	videoElement: HTMLVideoElement,
	stream: MediaStream
): Promise<void> {
	videoElement.srcObject = stream;
	videoElement.muted = true;
	videoElement.playsInline = true;

	await waitForVideoMetadata(videoElement);
	await videoElement.play();
	await waitForVideoMetadata(videoElement);
}

export function watchCameraDisconnect(
	stream: MediaStream,
	onDisconnect: (message: string) => void
): () => void {
	let active = true;
	const cleanups: Array<() => void> = [];

	const notifyDisconnect = () => {
		if (!active) {
			return;
		}

		active = false;
		onDisconnect(CAMERA_DISCONNECTED_MESSAGE);
	};

	const addListener = (
		target: EventTarget | null | undefined,
		eventName: string,
		handler: EventListener
	) => {
		if (!target) {
			return;
		}

		target.addEventListener(eventName, handler);
		cleanups.push(() => target.removeEventListener(eventName, handler));
	};

	addListener(stream, 'inactive', notifyDisconnect);

	for (const track of stream.getTracks()) {
		addListener(track, 'ended', notifyDisconnect);
	}

	if (navigator.mediaDevices) {
		const handleDeviceChange = () => {
			if (!hasLiveVideoTrack(stream)) {
				notifyDisconnect();
			}
		};

		addListener(navigator.mediaDevices, 'devicechange', handleDeviceChange);
	}

	return () => {
		active = false;
		for (const cleanup of cleanups) {
			cleanup();
		}
=======
export type CameraErrorKind =
	| 'permission'
	| 'not_found'
	| 'busy'
	| 'constraints'
	| 'unsupported'
	| 'unknown';

export interface CameraFailure {
	kind: CameraErrorKind;
	message: string;
	lastErrorName: string | null;
	videoInputCount: number | null;
}

export interface CameraStartOptions {
	attempts?: MediaStreamConstraints[];
	retries?: number;
	retryDelayMs?: number;
}

export class CameraStartupError extends Error {
	constructor(public readonly failure: CameraFailure) {
		super(failure.message);
		this.name = 'CameraStartupError';
	}
}

export const KIOSK_CAMERA_ATTEMPTS: MediaStreamConstraints[] = [
	{ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 } } },
	{ audio: false, video: { width: { ideal: 320 }, height: { ideal: 240 } } },
	{ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } },
	{ audio: false, video: { facingMode: 'user' } },
	{ audio: false, video: true }
];

export const HIGH_RES_CAMERA_ATTEMPTS: MediaStreamConstraints[] = [
	{ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
	{ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 } } },
	{ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } },
	{ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } },
	{ audio: false, video: { facingMode: 'user' } },
	{ audio: false, video: true }
];

const PERMISSION_ERROR_NAMES = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError']);
const NOT_FOUND_ERROR_NAMES = new Set(['NotFoundError', 'DevicesNotFoundError']);
const BUSY_ERROR_NAMES = new Set(['NotReadableError', 'TrackStartError', 'AbortError']);
const CONSTRAINT_ERROR_NAMES = new Set(['OverconstrainedError', 'ConstraintNotSatisfiedError']);

function getErrorName(error: unknown): string | null {
	if (error instanceof DOMException) return error.name;
	if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
		return error.name;
	}
	return null;
}

function classifyCameraFailure(errors: unknown[], videoInputCount: number | null): CameraFailure {
	const errorNames = errors.map(getErrorName).filter((name): name is string => Boolean(name));
	const lastErrorName = errorNames.at(-1) ?? null;

	if (errorNames.some((name) => PERMISSION_ERROR_NAMES.has(name))) {
		return {
			kind: 'permission',
			message: 'Camera access was denied. Allow camera access in Chromium and reload the page.',
			lastErrorName,
			videoInputCount
		};
	}

	if (errorNames.some((name) => BUSY_ERROR_NAMES.has(name))) {
		return {
			kind: 'busy',
			message: 'The camera was found but could not start. Another app may be using it, or the webcam briefly disconnected.',
			lastErrorName,
			videoInputCount
		};
	}

	if (videoInputCount === 0) {
		return {
			kind: 'not_found',
			message: 'No camera was detected. Check the USB webcam connection and confirm the Raspberry Pi exposes a video device.',
			lastErrorName,
			videoInputCount
		};
	}

	if (errorNames.some((name) => NOT_FOUND_ERROR_NAMES.has(name))) {
		return {
			kind: 'not_found',
			message: 'Chromium could not open a usable camera stream. This is often a Raspberry Pi startup timing or driver issue, not just a loose cable.',
			lastErrorName,
			videoInputCount
		};
	}

	if (errorNames.some((name) => CONSTRAINT_ERROR_NAMES.has(name))) {
		return {
			kind: 'constraints',
			message: 'The camera is connected but rejected the requested video format. A simpler capture mode is needed.',
			lastErrorName,
			videoInputCount
		};
	}

	return {
		kind: 'unknown',
		message: `Camera initialization failed${lastErrorName ? ` (${lastErrorName})` : ''}.`,
		lastErrorName,
		videoInputCount
	};
}

async function getVideoInputCount(): Promise<number | null> {
	if (!navigator.mediaDevices?.enumerateDevices) return null;

	try {
		const devices = await navigator.mediaDevices.enumerateDevices();
		return devices.filter((device) => device.kind === 'videoinput').length;
	} catch (error) {
		console.warn('Could not enumerate camera devices:', error);
		return null;
	}
}

function shouldStopRetrying(error: unknown): boolean {
	const name = getErrorName(error);
	return name !== null && PERMISSION_ERROR_NAMES.has(name);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startCameraStream(options: CameraStartOptions = {}): Promise<MediaStream> {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new CameraStartupError({
			kind: 'unsupported',
			message: 'This browser does not support camera access.',
			lastErrorName: null,
			videoInputCount: null
		});
	}

	const attempts = options.attempts?.length ? options.attempts : KIOSK_CAMERA_ATTEMPTS;
	const retries = Math.max(0, options.retries ?? 0);
	const retryDelayMs = options.retryDelayMs ?? 750;
	const errors: unknown[] = [];

	for (let pass = 0; pass <= retries; pass++) {
		for (const constraints of attempts) {
			try {
				return await navigator.mediaDevices.getUserMedia(constraints);
			} catch (error) {
				errors.push(error);
				console.warn('Camera config failed, trying next...', { constraints, error });

				if (shouldStopRetrying(error)) {
					const videoInputCount = await getVideoInputCount();
					throw new CameraStartupError(classifyCameraFailure(errors, videoInputCount));
				}
			}
		}

		if (pass < retries) {
			await delay(retryDelayMs);
		}
	}

	const videoInputCount = await getVideoInputCount();
	throw new CameraStartupError(classifyCameraFailure(errors, videoInputCount));
}

export function getCameraFailure(error: unknown): CameraFailure {
	if (error instanceof CameraStartupError) {
		return error.failure;
	}

	return {
		kind: 'unknown',
		message: error instanceof Error ? error.message : 'Camera initialization failed.',
		lastErrorName: getErrorName(error),
		videoInputCount: null
>>>>>>> ce119d7 (Update)
	};
}
