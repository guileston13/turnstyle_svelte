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
	};
}
