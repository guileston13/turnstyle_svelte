<!-- QR Scanner Component with Motherduc Design -->
<script lang="ts">
	import { cameraStore } from '../stores/camera.svelte';
	import { studentStore } from '../stores/student.svelte';
	import { scanQRCode } from '../services/qr';
	import { getStudentByQRCode } from '../services/db';
	import { ErrorType, handleError } from '../utils/error-handler';

	let { onScanSuccess }: { onScanSuccess?: (studentId: string) => void } = $props();

	let canvasElement = $state<HTMLCanvasElement>();
	let scanning = $state<boolean>(false);
	let scanInterval: number | null = null;

	async function startScanning(videoElement: HTMLVideoElement) {
		if (!canvasElement || scanning) return;

		console.log('📱 Starting QR scanning...');
		scanning = true;
		studentStore.verificationStatus = 'qr_scanning';

		scanInterval = setInterval(async () => {
			if (!canvasElement || !videoElement) return;

			try {
				const qrData = scanQRCode(videoElement, canvasElement);

				if (qrData) {
					console.log('📱 QR code found:', qrData);
					stopScanning();

					// Look up student in database
					const student = await getStudentByQRCode(qrData);

					if (student) {
						console.log('📱 Student found:', student.name);
						studentStore.currentStudent = student;
						if (onScanSuccess) onScanSuccess(student.id);
					} else {
						console.log('📱 Student not found for QR:', qrData);
						studentStore.errorMessage = handleError(ErrorType.STUDENT_NOT_FOUND);
						studentStore.verificationStatus = 'failed';
					}
				}
			} catch (err) {
				console.error('📱 QR scan error:', err);
				studentStore.errorMessage = handleError(ErrorType.QR_INVALID, String(err));
				stopScanning();
			}
		}, 300) as unknown as number;
	}

	function stopScanning() {
		if (scanInterval) {
			clearInterval(scanInterval);
			scanInterval = null;
		}
		scanning = false;
	}

	$effect(() => {
		return () => {
			stopScanning();
		};
	});

	export { startScanning, stopScanning };
</script>

<div class="qr-scanner">
	<canvas bind:this={canvasElement} style="display: none;"></canvas>

	{#if scanning}
		<div class="scanning-indicator">
			<div class="scan-line"></div>
			<p class="scan-text">SCANNING QR CODE...</p>
		</div>
	{/if}
</div>

<style>
	.qr-scanner {
		position: relative;
		width: 100%;
	}

	.scanning-indicator {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: rgba(0, 122, 255, 0.1);
		border: 2px solid #007aff;
		pointer-events: none;
	}

	.scan-line {
		width: 80%;
		height: 2px;
		background: #ffe100;
		animation: scan 2s ease-in-out infinite;
	}

	@keyframes scan {
		0%,
		100% {
			transform: translateY(-50px);
		}
		50% {
			transform: translateY(50px);
		}
	}

	.scan-text {
		margin-top: 16px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: #007aff;
	}
</style>
