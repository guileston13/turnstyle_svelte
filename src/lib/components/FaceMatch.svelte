<!-- Face Match Component with Motherduc Design -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { studentStore } from '../stores/student.svelte';
	import { detectFace, compareFaces, captureFrame } from '../services/face';
	import { ErrorType, handleError } from '../utils/error-handler';
	import type { Student } from '../services/db';

	let { videoElement, student, onComplete }: { 
		videoElement: HTMLVideoElement; 
		student: Student;
		onComplete?: (success: boolean) => void;
	} = $props();

	let matching = $state<boolean>(false);
	let resultMessage = $state<string>('');
	let resultType = $state<'success' | 'error' | ''>('');
	let verificationInterval = $state<number | null>(null);
	let verificationComplete = $state<boolean>(false);
	let attemptCount = $state<number>(0);
	
	// 🎯 Guard 2: Throttle tracking
	let lastDetectionTime = $state<number>(0);

	// 🚀 FAST verification settings
	const VERIFICATION_INTERVAL = 500; // 500ms for faster detection (was 800ms)
	const MIN_DETECTION_GAP = 400; // Minimum gap between detections (was 600ms)
	const MAX_ATTEMPTS = 10; // Max attempts before failing

	let performFaceMatch = async () => {
		// 🎯 GUARD 1: Prevent request queue buildup
		if (matching) {
			console.log("⏳ Detection already pending, skipping frame...");
			return;
		}

		// 🎯 GUARD 2: Throttle frames - don't process if last request was too recent
		const now = Date.now();
		if (now - lastDetectionTime < MIN_DETECTION_GAP) {
			return;
		}

		// Stop if already completed or max attempts reached
		if (verificationComplete || attemptCount >= MAX_ATTEMPTS) {
			if (attemptCount >= MAX_ATTEMPTS && !verificationComplete) {
				resultMessage = '✗ FACE NOT MATCHED - TOO MANY ATTEMPTS';
				resultType = 'error';
				studentStore.verificationStatus = 'failed';
				stopAutoVerification();
				if (onComplete) setTimeout(() => onComplete(false), 1500);
			}
			return;
		}

		if (!videoElement || !student) {
			console.error('❌ Missing videoElement or student');
			return;
		}

		if (!student.faceDescriptor) {
			console.error('❌ Student has no face descriptor');
			resultMessage = '✗ ERROR: No stored face data';
			resultType = 'error';
			stopAutoVerification();
			if (onComplete) onComplete(false);
			return;
		}

		// Mark as pending and update throttle time
		matching = true;
		lastDetectionTime = now;
		attemptCount++;
		studentStore.verificationStatus = 'face_matching';

		try {
			// Capture frame (already center-cropped to 640x480)
			const canvas = await captureFrame(videoElement, false);
			
			// Fast face detection
			const detection = await detectFace(canvas, false);

			if (!detection) {
				console.log(`👤 No face detected (attempt ${attemptCount}/${MAX_ATTEMPTS})`);
				resultMessage = `Looking for face...`;
				resultType = '';
				return;
			}

			// Compare faces
			const result = await compareFaces(detection.descriptor, student.faceDescriptor);
			studentStore.confidenceScore = result.confidence;

			if (result.match) {
				resultMessage = `✓ VERIFIED (${(result.confidence * 100).toFixed(0)}%)`;
				resultType = 'success';
				studentStore.verificationStatus = 'success';
				verificationComplete = true;
				
				stopAutoVerification();
				if (onComplete) setTimeout(() => onComplete(true), 500);
			} else {
				resultMessage = `Matching... ${(result.confidence * 100).toFixed(0)}%`;
				resultType = '';
			}
		} catch (err) {
			console.error('❌ Face match error:', err);
		} finally {
			matching = false;
		}
	};

	function startAutoVerification() {
		console.log('🔄 Starting fast verification...');
		if (verificationInterval) clearInterval(verificationInterval);
		
		// Run first check immediately
		performFaceMatch();
		
		verificationInterval = setInterval(() => {
			performFaceMatch();
		}, VERIFICATION_INTERVAL) as unknown as number;
	}

	function stopAutoVerification() {
		if (verificationInterval) {
			clearInterval(verificationInterval);
			verificationInterval = null;
		}
	}

	onMount(() => {
		// Start verification immediately
		startAutoVerification();
	});

	onDestroy(() => {
		stopAutoVerification();
	});

	export { performFaceMatch };
</script>

<div class="face-match">
	<div class="student-info">
		<h3 class="student-name">{student.name}</h3>
		<p class="student-id">ID: {student.id}</p>
	</div>

	<div class="verification-status">
		<div class="status-indicator">
			<span class="status-dot {verificationInterval ? 'active' : 'inactive'}"></span>
			<span class="status-text">
				{verificationInterval ? 'SCANNING...' : 'COMPLETE'}
			</span>
		</div>
	</div>

	{#if resultMessage}
		<div class="result-box {resultType}">
			<p class="result-text">{resultMessage}</p>
		</div>
	{/if}

	{#if matching}
		<div class="loading-indicator">
			<div class="spinner"></div>
		</div>
	{/if}
</div>

<style>
	.face-match {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.student-info {
		padding: 12px;
		background: #f4efea;
		border: 2px solid #383838;
		text-align: center;
	}

	.student-name {
		font-family: 'JetBrains Mono', monospace;
		font-size: 16px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: #383838;
		margin: 0 0 4px 0;
	}

	.student-id {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #666;
		margin: 0;
	}

	.verification-status {
		display: flex;
		justify-content: center;
		padding: 8px;
		background: #f4efea;
		border: 2px solid #383838;
	}

	.status-indicator {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		border: 2px solid #383838;
	}

	.status-dot.active {
		background: #34c759;
		animation: pulse 1s ease-in-out infinite;
	}

	.status-dot.inactive {
		background: #007aff;
	}

	.status-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #383838;
	}

	.result-box {
		padding: 12px;
		border: 2px solid #383838;
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		text-align: center;
	}

	.result-box.success {
		background: #34c759;
		color: #ffffff;
	}

	.result-box.error {
		background: #ff3b30;
		color: #ffffff;
	}

	.result-text {
		margin: 0;
	}

	.loading-indicator {
		display: flex;
		justify-content: center;
		padding: 8px;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 3px solid #f1f1f1;
		border-top: 3px solid #007aff;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}
</style>
