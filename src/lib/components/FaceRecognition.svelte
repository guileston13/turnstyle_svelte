<!-- Face Recognition Component - Identifies student from camera -->
<script lang="ts">
	import { studentStore } from '../stores/student.svelte';
	import { captureFrame, detectFace } from '../services/face';
	import { ErrorType, handleError } from '../utils/error-handler';
	import { getAllStudents } from '../services/db';

	let { videoElement }: { videoElement: HTMLVideoElement } = $props();

	let recognizing = $state<boolean>(false);
	let resultMessage = $state<string>('');
	let resultType = $state<'success' | 'error' | ''>('');

	let performFaceRecognition = async () => {
		console.log('🔍 Starting face recognition...');

		if (!videoElement) {
			console.error('❌ No video element provided');
			resultMessage = '❌ ERROR: Camera not available';
			resultType = 'error';
			return;
		}

		recognizing = true;
		studentStore.verificationStatus = 'recognizing';
		resultMessage = '';
		resultType = '';

		try {
			console.log('📸 Capturing frame from video...');
			const canvas = await captureFrame(videoElement);
			console.log('📸 Frame captured');

			// Convert canvas to base64 for API
			const imageData = canvas.toDataURL('image/jpeg', 0.8);

			console.log('🔍 Sending to recognition API...');
			const response = await fetch('/api/face/recognize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ image: imageData })
			});

			const data = await response.json();
			console.log('🔍 Recognition result:', data);

			if (response.ok && data.studentId) {
				// Student recognized - fetch full student data
				const students = await getAllStudents();
				const recognizedStudent = students.find(s => s.id === data.studentId);

				if (recognizedStudent) {
					studentStore.currentStudent = recognizedStudent;
					resultMessage = `${data.message} (${data.confidence * 100}% confidence)`;
					resultType = 'success';
					studentStore.verificationStatus = 'recognized';

					// Check consent
					if (!recognizedStudent.consentGiven) {
						studentStore.errorMessage = 'Student consent required for verification';
					}
				} else {
					resultMessage = '❌ Student data not found in database';
					resultType = 'error';
					studentStore.verificationStatus = 'failed';
				}
			} else {
				resultMessage = data.message || '❌ Face not recognized';
				resultType = 'error';
				studentStore.verificationStatus = 'failed';
				studentStore.errorMessage = handleError(ErrorType.FACE_NO_MATCH);
			}
		} catch (err) {
			console.error('❌ Face recognition error:', err);
			resultMessage = '❌ ERROR: Recognition failed - ' + String(err);
			resultType = 'error';
			studentStore.verificationStatus = 'failed';
			studentStore.errorMessage = handleError(ErrorType.FACE_NO_MATCH, String(err));
		} finally {
			recognizing = false;
		}
	};

	export { performFaceRecognition };
</script>

<div class="face-recognition">
	<div class="instruction-box">
		<h3 class="instruction-title">FACE RECOGNITION</h3>
		<p class="instruction-text">
			Position your face clearly in front of the camera and click "RECOGNIZE FACE" to identify yourself.
		</p>
	</div>

	<button class="btn-recognize" onclick={performFaceRecognition} disabled={recognizing}>
		{recognizing ? 'RECOGNIZING...' : '🔍 RECOGNIZE FACE'}
	</button>

	{#if resultMessage}
		<div class="result-box {resultType}">
			<p class="result-text">{resultMessage}</p>
		</div>
	{/if}

	{#if recognizing}
		<div class="loading-spinner">
			<div class="spinner"></div>
			<p class="loading-text">ANALYZING FACE...</p>
		</div>
	{/if}
</div>

<style>
	.face-recognition {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 32px;
		background: #ffffff;
		border: 2px solid #383838;
	}

	.instruction-box {
		padding: 16px;
		background: #f4efea;
		border: 2px solid #383838;
		text-align: center;
	}

	.instruction-title {
		font-family: 'JetBrains Mono', monospace;
		font-size: 18px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: #383838;
		margin: 0 0 8px 0;
	}

	.instruction-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		color: #383838;
		margin: 0;
		line-height: 1.4;
	}

	.btn-recognize {
		padding: 16px 32px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		background: #007aff;
		color: #ffffff;
		border: 2px solid #383838;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-recognize:hover:not(:disabled) {
		background: #0051d5;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
	}

	.btn-recognize:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
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