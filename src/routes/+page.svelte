<!-- Main Verification Page -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Camera from '$lib/components/Camera.svelte';
	import FaceRecognition from '$lib/components/FaceRecognition.svelte';
	import FaceMatch from '$lib/components/FaceMatch.svelte';
	import ConsentDialog from '$lib/components/ConsentDialog.svelte';
	import { studentStore } from '$lib/stores/student.svelte';
	import { cameraStore } from '$lib/stores/camera.svelte';
	import { loadModels, getModelsLoaded, getLoadProgress } from '$lib/services/face';
	import { initDB, getStudentById } from '$lib/services/db';

	let cameraRef = $state<any>();
	let faceRecognitionRef = $state<any>();
	let faceMatchRef = $state<any>();

	let modelsLoading = $state<boolean>(true);
	let modelProgress = $state<number>(0);
	let showConsent = $state<boolean>(false);
	let step = $state<'scan' | 'verification' | 'result'>('scan');
	let recognitionInterval: any = null;
	
	// Scanner state
	let scannedInput = $state<string>('');
	let scannedStudent = $state<any>(null);
	let scanError = $state<string>('');
	let verificationStartTime = $state<number | null>(null);

	// Parse barcode format: "Name ID Course"
	function parseBarcode(input: string): { name: string; id: string; course: string } | null {
		// Expected format: "jhunes E. Encarguez 123456 Computer Science"
		// Split by spaces and find the ID (numeric part)
		const parts = input.trim().split(/\s+/);
		
		// Find index of ID (should be numeric)
		let idIndex = -1;
		for (let i = 0; i < parts.length; i++) {
			if (/^\d+$/.test(parts[i])) {
				idIndex = i;
				break;
			}
		}
		
		if (idIndex === -1) return null;
		
		const id = parts[idIndex];
		const name = parts.slice(0, idIndex).join(' ');
		const course = parts.slice(idIndex + 1).join(' ');
		
		return { name, id, course };
	}

	async function handleBarcodeInput(event: KeyboardEvent) {
		// Only process on Enter key
		if (event.key !== 'Enter') {
			return;
		}
		
		event.preventDefault();
		
		if (!scannedInput.trim()) {
			return;
		}
		
		console.log('🔍 Barcode scanned:', scannedInput);
		
		// Parse the barcode
		const parsed = parseBarcode(scannedInput);
		
		if (!parsed) {
			scanError = '❌ Invalid barcode format';
			scannedInput = '';
			return;
		}
		
		console.log('📋 Parsed data:', parsed);
		
		// Check if student exists in database
		try {
			const student = await getStudentById(parsed.id);
			
			if (!student) {
				scanError = `❌ Student ID ${parsed.id} not found in database`;
				scannedInput = '';
				return;
			}
			
			console.log('✅ Valid student found:', student);
			
			// Set student and start camera
			scannedStudent = student;
			studentStore.currentStudent = student;
			scanError = '';
			scannedInput = '';
			
			// Start camera for face verification
			step = 'verification';
			verificationStartTime = Date.now();
			
			// Start camera after a short delay
			setTimeout(() => {
				if (cameraRef && cameraRef.startCamera) {
					console.log('📱 Starting camera for face verification...');
					cameraRef.startCamera();
				}
			}, 500);
			
		} catch (err) {
			console.error('Error checking student:', err);
			scanError = '❌ Database error: ' + String(err);
			scannedInput = '';
		}
	}

	// Stop camera and reset when verification is complete
	function handleVerificationComplete(success: boolean) {
		console.log('🎯 Verification complete:', success ? 'SUCCESS' : 'FAILED');
		
		// Stop camera
		if (cameraRef && cameraRef.stopCamera) {
			cameraRef.stopCamera();
		}
		
		// Show result
		step = 'result';
		
		// Auto-reset after 5 seconds
		setTimeout(() => {
			resetVerification();
		}, 5000);
	}

	function resetVerification() {
		console.log('🔄 Resetting verification...');
		
		// Stop camera if active
		if (cameraRef && cameraRef.stopCamera) {
			cameraRef.stopCamera();
		}
		
		// Clear intervals
		if (recognitionInterval) {
			clearInterval(recognitionInterval);
			recognitionInterval = null;
		}
		
		// Reset state
		studentStore.reset();
		scannedStudent = null;
		scannedInput = '';
		scanError = '';
		step = 'scan';
		verificationStartTime = null;
		showConsent = false;
	}

	onMount(async () => {
		try {
			// Initialize database
			await initDB();

			// Load face detection models
			await loadModels((progress) => {
				modelProgress = progress;
			});

			modelsLoading = false;
			
			// Focus on input for barcode scanner
			setTimeout(() => {
				document.getElementById('barcode-input')?.focus();
			}, 500);
		} catch (err) {
			console.error('Failed to initialize:', err);
			studentStore.errorMessage = 'Failed to initialize system. Please refresh.';
		}
	});

	onDestroy(() => {
		if (recognitionInterval) {
			clearInterval(recognitionInterval);
		}
		
		// Stop camera on unmount
		if (cameraRef && cameraRef.stopCamera) {
			cameraRef.stopCamera();
		}
	});
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
				{#if step === 'scan'}
					<div class="step-container">
						<h2 class="step-title">STEP 1: SCAN STUDENT ID</h2>
						
						<div class="scanner-box">
							<div class="scanner-icon">
								<svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<rect x="3" y="5" width="18" height="14" rx="2" />
									<line x1="3" y1="10" x2="21" y2="10" />
									<line x1="7" y1="15" x2="7" y2="15" />
									<line x1="11" y1="15" x2="17" y2="15" />
								</svg>
							</div>
							
							<h3 class="scanner-instruction">SCAN OR SWIPE STUDENT ID CARD</h3>
							<p class="scanner-detail">Use the barcode/QR scanner to scan the student ID</p>
							
							<input
								id="barcode-input"
								type="text"
								bind:value={scannedInput}
								onkeydown={handleBarcodeInput}
								placeholder="Waiting for scan..."
								class="barcode-input"
								autocomplete="off"
							/>
							
							{#if scanError}
								<div class="scan-error">
									<p>{scanError}</p>
								</div>
							{/if}
							
							{#if scannedStudent}
								<div class="scanned-info">
									<h4>✓ Valid Student</h4>
									<p>Name: {scannedStudent.name}</p>
									<p>ID: {scannedStudent.id}</p>
								</div>
							{/if}
						</div>
					</div>
				{:else if step === 'verification'}
					<div class="step-container">
						<h2 class="step-title">STEP 2: FACE VERIFICATION</h2>
						<Camera bind:this={cameraRef} />
						{#if studentStore.currentStudent}
							<FaceMatch
								bind:this={faceMatchRef}
								videoElement={cameraRef?.getVideoElement()}
								student={studentStore.currentStudent}
								onComplete={handleVerificationComplete}
							/>
						{/if}
					</div>
				{:else if step === 'result'}
					<div class="result-container">
						<h2 class="result-title">
							{studentStore.verificationStatus === 'success' ? '✓ VERIFICATION SUCCESS' : '✗ VERIFICATION FAILED'}
						</h2>
						<p class="result-detail">Resetting in 5 seconds...</p>
						<button class="btn-action" onclick={resetVerification}>SCAN NEXT STUDENT</button>
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
<ConsentDialog bind:open={showConsent} />

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
		grid-template-columns: repeat(4, 1fr);
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
	
	.result-detail {
		font-size: 14px;
		color: #888888;
		margin: 0 0 16px 0;
	}

	/* Scanner Styles */
	.scanner-box {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
		padding: 64px 32px;
		background: #f4efea;
		border: 2px solid #383838;
	}

	.scanner-icon {
		color: #007aff;
	}

	.scanner-instruction {
		font-size: 20px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		margin: 0;
		color: #383838;
		text-align: center;
	}

	.scanner-detail {
		font-size: 14px;
		color: #888888;
		margin: 0;
		text-align: center;
	}

	.barcode-input {
		width: 100%;
		max-width: 500px;
		padding: 16px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 16px;
		border: 2px solid #383838;
		background: #ffffff;
		text-align: center;
		text-transform: uppercase;
	}

	.barcode-input:focus {
		outline: none;
		border-color: #007aff;
		box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
	}

	.scan-error {
		padding: 16px 32px;
		background: #ff3b30;
		color: #ffffff;
		border: 2px solid #383838;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.scan-error p {
		margin: 0;
	}

	.scanned-info {
		padding: 24px;
		background: #34c759;
		color: #ffffff;
		border: 2px solid #383838;
		text-align: center;
	}

	.scanned-info h4 {
		font-size: 18px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		margin: 0 0 12px 0;
	}

	.scanned-info p {
		font-size: 14px;
		margin: 4px 0;
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
