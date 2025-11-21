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

	const VERIFICATION_INTERVAL = 3000; // 3 seconds

	let performFaceMatch = async () => {
		console.log('🎯 Starting automatic face match...');

		// Stop if already completed
		if (verificationComplete) {
			return;
		}

		if (!videoElement || !student) {
			console.error('❌ Missing videoElement or student');
			return;
		}

		if (!student.faceDescriptor) {
			console.error('❌ Student has no face descriptor');
			resultMessage = '✗ ERROR: Student has no stored face data';
			resultType = 'error';
			stopAutoVerification();
			if (onComplete) onComplete(false);
			return;
		}

		// Don't start new match if one is already running
		if (matching) {
			return;
		}

		matching = true;
		studentStore.verificationStatus = 'face_matching';

		try {
			console.log('📸 Capturing frame from video...');
			const canvas = await captureFrame(videoElement);
			console.log('📸 Frame captured');

			console.log('🔍 Detecting face...');
			const detection = await detectFace(canvas);

			if (!detection) {
				console.log('⚠️ No face detected, will retry...');
				return;
			}

			console.log('⚖️ Comparing faces...');
			const result = await compareFaces(detection.descriptor, student.faceDescriptor);
			console.log('⚖️ Comparison result:', result);

			studentStore.confidenceScore = result.confidence;

			if (result.match) {
				resultMessage = `✓ FACE MATCH CONFIRMED (${(result.confidence * 100).toFixed(1)}% confidence)`;
				resultType = 'success';
				studentStore.verificationStatus = 'success';
				verificationComplete = true;
				
				// Stop verification and notify parent
				stopAutoVerification();
				if (onComplete) {
					setTimeout(() => onComplete(true), 1000); // Small delay to show success message
				}
			} else {
				resultMessage = `✗ FACE DOES NOT MATCH (${(result.confidence * 100).toFixed(1)}% confidence)`;
				resultType = 'error';
				studentStore.verificationStatus = 'failed';
				studentStore.errorMessage = handleError(ErrorType.FACE_NO_MATCH);
				
				// Stop after failed match
				stopAutoVerification();
				if (onComplete) {
					setTimeout(() => onComplete(false), 2000);
				}
			}
		} catch (err) {
			console.error('❌ Face match error:', err);
			resultMessage = '✗ ERROR: ' + String(err);
			resultType = 'error';
			studentStore.verificationStatus = 'failed';
			studentStore.errorMessage = handleError(ErrorType.FACE_NO_MATCH, String(err));
		} finally {
			matching = false;
		}
	};

	function startAutoVerification() {
		console.log('🔄 Starting automatic face verification...');
		if (verificationInterval) {
			clearInterval(verificationInterval);
		}
		verificationInterval = setInterval(() => {
			performFaceMatch();
		}, VERIFICATION_INTERVAL) as unknown as number;
	}

	function stopAutoVerification() {
		console.log('⏹️ Stopping automatic face verification...');
		if (verificationInterval) {
			clearInterval(verificationInterval);
			verificationInterval = null;
		}
	}

	onMount(() => {
		// Start automatic verification when component mounts
		setTimeout(() => {
			startAutoVerification();
		}, 1000); // Small delay to ensure video is ready
	});

	onDestroy(() => {
		stopAutoVerification();
	});

	export { performFaceMatch };
</script>

<div class="face-match">
	{#if student}
		<div class="student-info">
			<h3 class="student-name">{student.name}</h3>
			<p class="student-detail">ID: {student.id}</p>
			<p class="student-detail">EMAIL: {student.email}</p>
			{#if student.program}
				<p class="student-detail">PROGRAM: {student.program}</p>
			{/if}
		</div>
	{/if}

	<div class="verification-status">
		<div class="status-indicator">
			<span class="status-dot {verificationInterval ? 'active' : 'inactive'}"></span>
			<span class="status-text">
				{verificationInterval ? 'LIVE VERIFICATION ACTIVE' : 'VERIFICATION INACTIVE'}
			</span>
		</div>
		<p class="status-detail">Auto-verifying every 3 seconds</p>
	</div>

	{#if resultMessage}
		<div class="result-box {resultType}">
			<p class="result-text">{resultMessage}</p>
		</div>
	{/if}

	{#if matching}
		<div class="loading-spinner">
			<div class="spinner"></div>
			<p class="loading-text">ANALYZING FACE...</p>
		</div>
	{/if}
</div>

<style>
	.face-match {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 32px;
		background: #ffffff;
		border: 2px solid #383838;
	}

	.student-info {
		padding: 16px;
		background: #f4efea;
		border: 2px solid #383838;
	}

	.student-name {
		font-family: 'JetBrains Mono', monospace;
		font-size: 18px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: #383838;
		margin: 0 0 8px 0;
	}

	.student-detail {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #383838;
		margin: 4px 0;
	}

	.verification-status {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 16px;
		background: #f4efea;
		border: 2px solid #383838;
	}

	.status-indicator {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.status-dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid #383838;
	}

	.status-dot.active {
		background: #34c759;
		animation: pulse 2s ease-in-out infinite;
	}

	.status-dot.inactive {
		background: #ff3b30;
	}

	.status-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #383838;
	}

	.status-detail {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #888888;
		margin: 0;
	}

	.result-box {
		padding: 16px;
		border: 2px solid #383838;
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
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

	.loading-spinner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 32px;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 4px solid #f1f1f1;
		border-top: 4px solid #007aff;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}

	.loading-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #007aff;
		margin: 0;
	}
</style>
