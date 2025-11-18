<!-- Camera Component with Motherduc Design -->
<script lang="ts">
	import { cameraStore } from '../stores/camera.svelte';
	import { ErrorType, handleError } from '../utils/error-handler';

	let videoElement = $state<HTMLVideoElement>();

	$effect(() => {
		return () => {
			cameraStore.stopCamera();
		};
	});

	async function startCamera() {
		try {
			console.log('🎥 Starting camera...');
			cameraStore.error = null;

			const mediaStream = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: 'user',
					width: { ideal: 640 },
					height: { ideal: 480 }
				}
			});

			console.log('🎥 Camera stream obtained:', mediaStream);
			cameraStore.stream = mediaStream;
			cameraStore.permissionStatus = 'granted';

			// Wait for video element to be available
			if (!videoElement) {
				console.log('🎥 Waiting for video element...');
				await new Promise<void>((resolve) => {
					const checkVideo = () => {
						if (videoElement) {
							resolve();
						} else {
							setTimeout(checkVideo, 100);
						}
					};
					checkVideo();
				});
			}

			if (videoElement) {
				console.log('🎥 Setting video srcObject');
				videoElement.srcObject = mediaStream;
				// Ensure video plays
				await videoElement.play();
				console.log('🎥 Video playing - camera active indefinitely');
			} else {
				console.error('🎥 Video element still not found');
			}

			// Note: No timeout set - camera stays active until explicitly stopped
		} catch (err) {
			console.error('🎥 Camera error:', err);
			cameraStore.permissionStatus = 'denied';
			cameraStore.error = handleError(ErrorType.CAMERA_DENIED);
		}
	}

	function stopCamera() {
		cameraStore.stopCamera();
	}

	export function getVideoElement(): HTMLVideoElement | undefined {
		return videoElement;
	}

	export { startCamera };
</script>

<div class="camera-container">
	{#if cameraStore.error}
		<div class="error-box">
			<p class="error-text">{cameraStore.error}</p>
			<button class="btn-primary" onclick={startCamera}>RETRY</button>
		</div>
	{:else if cameraStore.isActive}
		<div class="video-wrapper">
			<video bind:this={videoElement} autoplay playsinline class="video-element">
				<track kind="captions" src="" srclang="en" label="No captions available" default />
			</video>
			<div class="recording-indicator">
				<span class="indicator-dot"></span>
				<span class="indicator-text">RECORDING</span>
			</div>
		</div>
		<button class="btn-danger" onclick={stopCamera}>STOP CAMERA</button>
	{:else}
		<div class="camera-controls">
			<button class="btn-primary" onclick={startCamera}>START CAMERA</button>
			<p class="permission-text">Camera permission: {cameraStore.permissionStatus}</p>
		</div>
	{/if}
</div>

<style>
	.camera-container {
		display: flex;
		flex-direction: column;
		gap: 16px;
		align-items: center;
		padding: 32px;
		background: #ffffff;
		border: 2px solid #383838;
	}

	.video-wrapper {
		position: relative;
		width: 100%;
		max-width: 640px;
		border: 2px solid #383838;
	}

	.video-element {
		width: 100%;
		height: auto;
		min-height: 240px;
		display: block;
		background: #000;
	}

	.recording-indicator {
		position: absolute;
		top: 16px;
		right: 16px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		background: rgba(255, 59, 48, 0.9);
		border: 2px solid #383838;
		color: #ffffff;
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.indicator-dot {
		width: 8px;
		height: 8px;
		background: #ffffff;
		border-radius: 50%;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}

	.error-box {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 32px;
		background: #ffffff;
		border: 2px solid #ff3b30;
	}

	.error-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		color: #ff3b30;
		text-align: center;
		margin: 0;
	}

	.btn-primary,
	.btn-danger {
		padding: 12px 32px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		border: 2px solid #383838;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-primary {
		background: #007aff;
		color: #ffffff;
	}

	.btn-primary:hover {
		background: #0051d5;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
	}

	.btn-danger {
		background: transparent;
		color: #ff3b30;
		border-color: #ff3b30;
	}

	.btn-danger:hover {
		background: #ff3b30;
		color: #ffffff;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(255, 59, 48, 0.3);
	}
</style>
