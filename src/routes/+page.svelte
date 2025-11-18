<!-- Main Verification Page -->
<script lang="ts">
	import { onMount } from 'svelte';
	import Camera from '$lib/components/Camera.svelte';
	import FaceRecognition from '$lib/components/FaceRecognition.svelte';
	import FaceMatch from '$lib/components/FaceMatch.svelte';
	import ConsentDialog from '$lib/components/ConsentDialog.svelte';
	import { studentStore } from '$lib/stores/student.svelte';
	import { cameraStore } from '$lib/stores/camera.svelte';
	import { loadModels, getModelsLoaded, getLoadProgress } from '$lib/services/face';
	import { initDB } from '$lib/services/db';

	let cameraRef = $state<any>();
	let faceRecognitionRef = $state<any>();
	let faceMatchRef = $state<any>();

	let modelsLoading = $state<boolean>(true);
	let modelProgress = $state<number>(0);
	let showConsent = $state<boolean>(false);
	let step = $state<'recognition' | 'verification' | 'result'>('recognition');

	// Auto-start camera when component and models are ready
	$effect(() => {
		if (!modelsLoading && cameraRef && !cameraStore.isActive && !cameraStore.error) {
			console.log('📱 Auto-starting camera...');
			setTimeout(() => {
				if (cameraRef && cameraRef.startCamera) {
					console.log('📱 Calling cameraRef.startCamera()');
					cameraRef.startCamera();
				}
			}, 1000); // Give more time for everything to initialize
		}
	});

	// Auto-advance to verification when student is recognized
	$effect(() => {
		if (studentStore.currentStudent && step === 'recognition' && studentStore.currentStudent.consentGiven) {
			console.log('🎯 Student recognized with consent, auto-advancing to verification...');
			step = 'verification';
		}
	});

	onMount(async () => {
		try {
			// Initialize database
			await initDB();

			// Load face detection models
			await loadModels((progress) => {
				modelProgress = progress;
			});

			modelsLoading = false;
		} catch (err) {
			console.error('Failed to initialize:', err);
			studentStore.errorMessage = 'Failed to initialize system. Please refresh.';
		}
	});

	function handleStudentRecognized() {
		if (studentStore.currentStudent) {
			console.log('🎯 Student recognized successfully');
			if (!studentStore.currentStudent.consentGiven) {
				showConsent = true;
			} else {
				// Auto-advance to verification if consent already given
				step = 'verification';
			}
		}
	}

	function handleConsentAccept() {
		if (studentStore.currentStudent) {
			studentStore.currentStudent.consentGiven = true;
			studentStore.currentStudent.consentDate = new Date();
			step = 'verification';
		}
		showConsent = false;
	}

	function handleConsentDecline() {
		studentStore.reset();
		showConsent = false;
		// Keep camera active for next recognition attempt
		step = 'recognition';
	}

	function performFaceRecognition() {
		const videoEl = cameraRef?.getVideoElement();
		if (videoEl && faceRecognitionRef) {
			faceRecognitionRef.performFaceRecognition();
		}
	}

	function resetVerification() {
		studentStore.reset();
		showConsent = false;
		step = 'recognition';
	}
</script>

<svelte:head>
	<title>Student Face Verification System</title>
</svelte:head>

<div class="app-container">
	<!-- Header -->
	<header class="header">
		<div class="logo-box">
			<span class="logo-text">SV</span>
		</div>
		<h1 class="brand">STUDENT VERIFICATION</h1>
		<a href="/admin" class="btn-header">ADMIN</a>
	</header>

	<!-- Productivity Tip Bar -->
	<div class="tip-bar">
		<p class="tip-text">SECURITY TIP: FACE RECOGNITION REQUIRES PROPER LIGHTING AND CLEAR VISIBILITY</p>
	</div>

	<!-- Main Content -->
	<main class="main-content">
		{#if modelsLoading}
			<div class="loading-screen">
				<div class="loading-box">
					<h2 class="loading-title">LOADING AI MODELS...</h2>
					<div class="progress-bar">
						<div class="progress-fill" style="width: {modelProgress}%"></div>
					</div>
					<p class="loading-text">{modelProgress.toFixed(0)}%</p>
				</div>
			</div>
		{:else}
			<!-- Stats Section -->
			<section class="stats-section">
				<div class="stat-card">
					<h3 class="stat-label">STATUS</h3>
					<p class="stat-value">{studentStore.verificationStatus.toUpperCase()}</p>
				</div>
				<div class="stat-card">
					<h3 class="stat-label">CONFIDENCE</h3>
					<p class="stat-value">{(studentStore.confidenceScore * 100).toFixed(1)}%</p>
				</div>
				<div class="stat-card">
					<h3 class="stat-label">STEP</h3>
					<p class="stat-value">{step.toUpperCase()}</p>
				</div>
				<div class="stat-card">
					<h3 class="stat-label">CAMERA</h3>
					<p class="stat-value">{cameraStore.isActive ? 'ACTIVE' : 'INACTIVE'}</p>
				</div>
			</section>

			<!-- Verification Section -->
			<section class="verification-section">
				{#if step === 'recognition'}
					<div class="step-container">
						<h2 class="step-title">STEP 1: FACE RECOGNITION</h2>
						<Camera bind:this={cameraRef} />
						<FaceRecognition bind:this={faceRecognitionRef} videoElement={cameraRef?.getVideoElement()} />
						{#if cameraStore.isActive && !studentStore.currentStudent}
							<button class="btn-action" onclick={performFaceRecognition}>START FACE RECOGNITION</button>
						{:else if cameraStore.isActive && studentStore.currentStudent}
							<div class="post-recognition-controls">
								<p class="recognition-success-text">✓ STUDENT RECOGNIZED SUCCESSFULLY</p>
								<div class="control-buttons">
									<button class="btn-secondary" onclick={() => cameraStore.stopCamera()}>STOP CAMERA</button>
									<button class="btn-action" onclick={() => step = 'verification'}>CONTINUE TO VERIFICATION</button>
								</div>
							</div>
						{/if}
					</div>
				{:else if step === 'verification'}
					<div class="step-container">
						<h2 class="step-title">STEP 2: LIVE FACE VERIFICATION</h2>
						<Camera bind:this={cameraRef} />
						{#if studentStore.currentStudent}
							<FaceMatch
								bind:this={faceMatchRef}
								videoElement={cameraRef?.getVideoElement()}
								student={studentStore.currentStudent}
							/>
						{/if}
					</div>
				{:else if step === 'result'}
					<div class="result-container">
						<h2 class="result-title">
							{studentStore.verificationStatus === 'success' ? '✓ VERIFICATION SUCCESS' : '✗ VERIFICATION FAILED'}
						</h2>
						<button class="btn-action" onclick={resetVerification}>START NEW VERIFICATION</button>
					</div>
				{/if}
			</section>

			<!-- Error Display -->
			{#if studentStore.errorMessage}
				<div class="error-alert">
					<p class="error-text">{studentStore.errorMessage}</p>
				</div>
			{/if}
		{/if}
	</main>

	<!-- Footer -->
	<footer class="footer">
		<p class="footer-text">Motherduc Design System © 2025</p>
	</footer>
</div>

<!-- Consent Dialog -->
<ConsentDialog bind:open={showConsent} onAccept={handleConsentAccept} onDecline={handleConsentDecline} />

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		font-family: 'JetBrains Mono', monospace;
		background: #f4efea;
		color: #383838;
	}

	.app-container {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	/* Header */
	.header {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 16px 32px;
		background: #f4efea;
		border-bottom: 2px solid #383838;
	}

	.logo-box {
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid #383838;
		background: #ffffff;
	}

	.logo-text {
		font-size: 20px;
		font-weight: bold;
		color: #383838;
	}

	.brand {
		font-size: 24px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 1px;
		margin: 0;
		flex: 1;
	}

	.btn-header {
		padding: 8px 16px;
		background: #007aff;
		color: #ffffff;
		border: 2px solid #383838;
		text-decoration: none;
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		transition: all 0.15s ease;
	}

	.btn-header:hover {
		background: #0051d5;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
	}

	/* Tip Bar */
	.tip-bar {
		background: #ffe100;
		border-top: 2px solid #383838;
		border-bottom: 2px solid #383838;
		padding: 12px;
		text-align: center;
	}

	.tip-text {
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin: 0;
		color: #383838;
	}

	/* Main Content */
	.main-content {
		flex: 1;
		max-width: 1200px;
		width: 100%;
		margin: 0 auto;
		padding: 64px 32px;
	}

	/* Loading Screen */
	.loading-screen {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 400px;
	}

	.loading-box {
		background: #ffffff;
		border: 2px solid #383838;
		padding: 64px;
		text-align: center;
		min-width: 400px;
	}

	.loading-title {
		font-size: 18px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		margin: 0 0 24px 0;
	}

	.progress-bar {
		width: 100%;
		height: 24px;
		background: #f1f1f1;
		border: 2px solid #383838;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: #007aff;
		transition: width 0.3s ease;
	}

	.loading-text {
		font-size: 24px;
		font-weight: bold;
		margin: 16px 0 0 0;
		color: #007aff;
	}

	/* Stats Section */
	.stats-section {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
		margin-bottom: 32px;
	}

	.stat-card {
		background: #ffffff;
		border: 2px solid #383838;
		padding: 24px;
		transition: all 0.15s ease;
	}

	.stat-card:hover {
		border-color: #007aff;
		transform: translateY(-2px);
	}

	.stat-label {
		font-size: 12px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin: 0 0 8px 0;
		color: #888888;
	}

	.stat-value {
		font-size: 32px;
		font-weight: bold;
		margin: 0;
		color: #007aff;
	}

	/* Verification Section */
	.verification-section {
		background: #ffffff;
		border: 2px solid #383838;
		padding: 32px;
	}

	.step-container {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.step-title {
		font-size: 18px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		margin: 0;
		padding-bottom: 16px;
		border-bottom: 2px solid #383838;
	}

	.btn-action {
		padding: 16px 32px;
		background: #34c759;
		color: #ffffff;
		border: 2px solid #383838;
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-action:hover {
		background: #28a745;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
	}

	.post-recognition-controls {
		display: flex;
		flex-direction: column;
		gap: 16px;
		align-items: center;
		padding: 24px;
		background: #f4efea;
		border: 2px solid #383838;
	}

	.recognition-success-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 16px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.8px;
		color: #34c759;
		margin: 0;
		text-align: center;
	}

	.control-buttons {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.btn-secondary {
		padding: 12px 24px;
		background: #ff3b30;
		color: #ffffff;
		border: 2px solid #383838;
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-secondary:hover {
		background: #d63027;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(255, 59, 48, 0.3);
	}

	.result-container {
		text-align: center;
		padding: 64px 32px;
	}

	.result-title {
		font-size: 24px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 1px;
		margin: 0 0 32px 0;
	}

	/* Error Alert */
	.error-alert {
		margin-top: 32px;
		padding: 16px;
		background: #ff3b30;
		color: #ffffff;
		border: 2px solid #383838;
	}

	.error-text {
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin: 0;
	}

	/* Footer */
	.footer {
		background: #383838;
		color: #ffffff;
		padding: 32px;
		text-align: center;
		border-top: 2px solid #383838;
	}

	.footer-text {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin: 0;
	}

	/* Responsive */
	@media (max-width: 728px) {
		.stats-section {
			grid-template-columns: 1fr;
		}

		.main-content {
			padding: 32px 16px;
		}

		.header {
			padding: 16px;
		}

		.brand {
			font-size: 18px;
		}
	}
</style>
