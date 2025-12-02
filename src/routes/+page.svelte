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
	
	// USB Scanner state
	let scannerConnected = $state<boolean>(false);
	let scannerDevice = $state<any>(null);
	let scanBuffer = $state<string>('');
	let lastKeyTime = $state<number>(0);
	let scanTimeout: any = null;
	let isProcessingScan = $state<boolean>(false); // Prevent overlapping scans
	// Note: useKeyboardMode removed - we always need to block keyboard events from scanner
	
	// Keyboard buffer for barcode scanner (scanners type very fast)
	const SCAN_SPEED_THRESHOLD = 100; // milliseconds between keystrokes (scanners are faster than humans)
	const SCAN_COMPLETE_DELAY = 150; // delay after last character to process scan
	let scanStartTime = $state<number>(0); // Track when scan started
	let isScanInProgress = $state<boolean>(false); // Track if we're receiving scanner input

	// Parse barcode format: "Name ID Course"
	function parseBarcode(input: string): { name: string; id: string; course: string } | null {
		const trimmed = input.trim();
		
		// Find the ID (assume it's a 10-digit student ID)
		const idMatch = trimmed.match(/(\d{10})/);
		if (!idMatch) return null;
		
		const id = idMatch[1];
		const idIndex = trimmed.indexOf(id);
		
		const name = trimmed.substring(0, idIndex).trim();
		const course = trimmed.substring(idIndex + id.length).trim();
		
		if (!name || !course) return null;
		
		return { name, id, course };
	}

	// Process scanned barcode data
	async function processBarcodeData(barcodeData: string) {
		if (!barcodeData.trim() || isProcessingScan) {
			return;
		}
		
		isProcessingScan = true;
		
		console.log('🔍 Barcode scanned:', barcodeData);
		
		// Parse the barcode
		const parsed = parseBarcode(barcodeData);
		
		if (!parsed) {
			scanError = '❌ Invalid barcode format';
			scannedInput = '';
			isProcessingScan = false;
			return;
		}
		
		console.log('📋 Parsed data:', parsed);
		
		// Check if student exists in database
		try {
			const student = await getStudentById(parsed.id);
			
			if (!student) {
				scanError = '❌ User not registered';
				scannedInput = '';
				isProcessingScan = false;
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
			isProcessingScan = false; // Processing complete, allow next scan after verification
			
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
			isProcessingScan = false;
		}
	}

	// Global keyboard listener for barcode scanner (HID keyboard mode)
	// This MUST run even in HID mode to block browser navigation from scanner keyboard events
	function handleGlobalKeydown(event: KeyboardEvent) {
		const now = Date.now();
		const timeSinceLastKey = now - lastKeyTime;
		
		// Detect if this is rapid scanner input (even if we're in HID mode)
		const isRapidInput = timeSinceLastKey < SCAN_SPEED_THRESHOLD;
		const isPrintableKey = event.key.length === 1;
		const isScannerKey = event.key === 'Tab' || event.key === 'Enter' || isPrintableKey;
		
		// If we detect rapid input or scan in progress, ALWAYS block browser actions
		if ((isRapidInput && isScannerKey) || isScanInProgress || isProcessingScan) {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
		}
		
		// Skip processing if not in scan mode
		if (step !== 'scan') {
			return;
		}
		
		// Skip if already processing a complete scan
		if (isProcessingScan) {
			return;
		}
		
		// Always block Tab key (scanner sends Tab between fields)
		if (event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			lastKeyTime = now;
			// Mark as scan in progress if we see rapid Tab
			if (isRapidInput || scanBuffer.length > 0) {
				isScanInProgress = true;
			}
			return;
		}
		
		// Ignore Shift key presses (just modifiers)
		if (event.key === 'Shift') {
			return;
		}
		
		// If Enter key, process the buffer
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			
			if (scanTimeout) {
				clearTimeout(scanTimeout);
				scanTimeout = null;
			}
			
			if (scanBuffer.length > 0) {
				console.log('📊 Scanner buffer complete (Enter):', scanBuffer);
				isScanInProgress = false;
				processBarcodeData(scanBuffer);
				scanBuffer = '';
				scannedInput = '';
			}
			lastKeyTime = now;
			return;
		}
		
		// Only capture printable characters (single character keys)
		if (isPrintableKey) {
			// Always prevent default to stop browser search/navigation
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			
			// Check if this looks like rapid scanner input or start of new scan
			if (isRapidInput || scanBuffer.length === 0) {
				// Mark scan as in progress
				if (scanBuffer.length === 0) {
					scanStartTime = now;
					isScanInProgress = true;
					console.log('🔄 Scan started');
				}
				
				scanBuffer += event.key;
				scannedInput = scanBuffer; // Update visible input
				
				// Clear any existing timeout
				if (scanTimeout) {
					clearTimeout(scanTimeout);
				}
				
				// Set timeout to process after scan complete
				scanTimeout = setTimeout(() => {
					if (scanBuffer.length > 3 && isScanInProgress) { // Minimum barcode length
						console.log('📊 Scanner timeout - processing:', scanBuffer);
						isScanInProgress = false;
						processBarcodeData(scanBuffer);
						scanBuffer = '';
						scannedInput = '';
					}
				}, SCAN_COMPLETE_DELAY);
			} else {
				// Slow typing - might be manual input, reset buffer
				scanBuffer = event.key;
				scanStartTime = now;
				isScanInProgress = true;
			}
			lastKeyTime = now;
		} else {
			// For any other special keys during scan, prevent default
			if (isScanInProgress) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
			}
		}
	}
	
	// Connect to USB scanner via WebHID API (optional enhancement)
	async function connectUSBScanner() {
		try {
			// Check if WebHID is supported
			if (!('hid' in navigator)) {
				console.log('⚠️ WebHID not supported, using keyboard mode');
				scanError = '⚠️ WebHID not supported. Scanner will work in keyboard mode.';
				return;
			}
			
			console.log('🔌 Requesting USB HID device...');
			
			// Request access to HID devices (barcode scanners typically have usage page 1)
			const devices = await (navigator as any).hid.requestDevice({
				filters: [] // Allow all HID devices, user will select
			});
			
			if (devices.length === 0) {
				console.log('❌ No device selected');
				scanError = '❌ No scanner selected';
				return;
			}
			
			const device = devices[0];
			console.log('📱 Device selected:', device.productName);
			
			// Open the device
			if (!device.opened) {
				await device.open();
			}
			
			scannerDevice = device;
			scannerConnected = true;
			scanError = '';
			
			console.log('✅ Scanner connected:', device.productName);
			
			// Listen for input reports
			let hidBuffer = '';
			device.addEventListener('inputreport', (event: any) => {
				const { data } = event;
				
				console.log('📊 HID report received, length:', data.byteLength);
				console.log('📊 HID data bytes:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
				
				// Parse HID keyboard data
				// Most barcode scanners send data as keyboard HID reports
				// Format: [modifier, reserved, key1, key2, key3, key4, key5, key6]
				for (let i = 2; i < data.byteLength; i++) {
					const keyCode = data.getUint8(i);
					if (keyCode === 0) continue;
					
					console.log(`🔤 HID key code: 0x${keyCode.toString(16).padStart(2, '0')} at position ${i}`);
					
					// Convert HID key codes to characters
					const char = hidKeyCodeToChar(keyCode, data.getUint8(0));
					console.log(`🔤 HID char: "${char}" for key code 0x${keyCode.toString(16).padStart(2, '0')}`);
					
					if (char) {
						if (char === '\n') {
							// Enter key - process the buffer
							if (hidBuffer.length > 0) {
								console.log('📊 HID scan complete:', hidBuffer);
								processBarcodeData(hidBuffer);
								hidBuffer = '';
							}
						} else {
							hidBuffer += char;
							scannedInput = hidBuffer;
							console.log('📊 HID buffer now:', hidBuffer);
						}
					}
				}
			});
			
		} catch (err) {
			console.error('Scanner connection error:', err);
			scanError = '❌ Failed to connect scanner: ' + String(err);
		}
	}
	
	// Disconnect USB scanner
	async function disconnectUSBScanner() {
		if (scannerDevice) {
			try {
				await scannerDevice.close();
				console.log('🔌 Scanner disconnected');
			} catch (err) {
				console.error('Error disconnecting scanner:', err);
			}
			scannerDevice = null;
			scannerConnected = false;
		}
	}
	
	// Convert HID keyboard key codes to characters
	function hidKeyCodeToChar(keyCode: number, modifier: number): string | null {
		const shift = (modifier & 0x22) !== 0; // Left or right shift
		
		// Key code mapping (USB HID Usage Tables)
		const keyMap: { [key: number]: [string, string] } = {
			0x04: ['a', 'A'], 0x05: ['b', 'B'], 0x06: ['c', 'C'], 0x07: ['d', 'D'],
			0x08: ['e', 'E'], 0x09: ['f', 'F'], 0x0A: ['g', 'G'], 0x0B: ['h', 'H'],
			0x0C: ['i', 'I'], 0x0D: ['j', 'J'], 0x0E: ['k', 'K'], 0x0F: ['l', 'L'],
			0x10: ['m', 'M'], 0x11: ['n', 'N'], 0x12: ['o', 'O'], 0x13: ['p', 'P'],
			0x14: ['q', 'Q'], 0x15: ['r', 'R'], 0x16: ['s', 'S'], 0x17: ['t', 'T'],
			0x18: ['u', 'U'], 0x19: ['v', 'V'], 0x1A: ['w', 'W'], 0x1B: ['x', 'X'],
			0x1C: ['y', 'Y'], 0x1D: ['z', 'Z'],
			0x1E: ['1', '!'], 0x1F: ['2', '@'], 0x20: ['3', '#'], 0x21: ['4', '$'],
			0x22: ['5', '%'], 0x23: ['6', '^'], 0x24: ['7', '&'], 0x25: ['8', '*'],
			0x26: ['9', '('], 0x27: ['0', ')'],
			0x28: ['\n', '\n'], // Enter
			0x2B: ['\t', '\t'], // Tab
			0x2C: [' ', ' '],   // Space
			0x2D: ['-', '_'], 0x2E: ['=', '+'], 0x2F: ['[', '{'], 0x30: [']', '}'],
			0x33: [';', ':'], 0x34: ["'", '"'], 0x36: [',', '<'], 0x37: ['.', '>'],
			0x38: ['/', '?'],
		};
		
		const mapping = keyMap[keyCode];
		if (!mapping) return null;
		return shift ? mapping[1] : mapping[0];
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
		
		await processBarcodeData(scannedInput);
		scannedInput = '';
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
		
		// Clear scan timeout
		if (scanTimeout) {
			clearTimeout(scanTimeout);
			scanTimeout = null;
		}
		
		// Reset state
		studentStore.reset();
		scannedStudent = null;
		scannedInput = '';
		scanBuffer = '';
		scanError = '';
		step = 'scan';
		verificationStartTime = null;
		showConsent = false;
		isProcessingScan = false; // Allow new scans
		isScanInProgress = false; // Reset scan progress flag
		lastKeyTime = 0; // Reset key timing
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
			
			// Add global keyboard listener for barcode scanner with capture phase
			// Using capture: true ensures we get the event before the browser
			window.addEventListener('keydown', handleGlobalKeydown, { capture: true });
			console.log('🔌 Global keyboard listener added for barcode scanner');
			
			// Focus on input for barcode scanner
			setTimeout(() => {
				document.getElementById('barcode-input')?.focus();
			}, 500);
			
			// Try to reconnect to previously paired HID devices
			if ('hid' in navigator) {
				try {
					const devices = await (navigator as any).hid.getDevices();
					if (devices.length > 0) {
						const device = devices[0];
						if (!device.opened) {
							await device.open();
						}
						scannerDevice = device;
						scannerConnected = true;
						console.log('✅ Auto-reconnected to scanner:', device.productName);
					}
				} catch (err) {
					console.log('⚠️ Could not auto-reconnect to HID devices:', err);
				}
			}
		} catch (err) {
			console.error('Failed to initialize:', err);
			studentStore.errorMessage = 'Failed to initialize system. Please refresh.';
		}
	});

	onDestroy(() => {
		if (recognitionInterval) {
			clearInterval(recognitionInterval);
		}
		
		// Only run browser-specific cleanup on client side
		if (typeof window !== 'undefined') {
			// Remove global keyboard listener (must match capture: true)
			window.removeEventListener('keydown', handleGlobalKeydown, { capture: true });
			
			// Clear scan timeout
			if (scanTimeout) {
				clearTimeout(scanTimeout);
			}
			
			// Disconnect USB scanner
			disconnectUSBScanner();
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
					<h3 class="stat-label">SCANNER</h3>
					<p class="stat-value" style="color: {scannerConnected ? '#34c759' : '#007aff'}">
						{scannerConnected ? 'USB CONNECTED' : 'KEYBOARD MODE'}
					</p>
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
							<p class="scanner-detail">
								{#if scannerConnected}
									✅ USB Scanner connected - Just scan your ID!
								{:else}
									Scanner in keyboard mode - Scan will auto-detect
								{/if}
							</p>
							
							<!-- Scanner connection button -->
							<div class="scanner-controls">
								{#if !scannerConnected}
									<button class="btn-scanner" onclick={connectUSBScanner}>
										🔌 CONNECT USB SCANNER
									</button>
								{:else}
									<button class="btn-scanner btn-disconnect" onclick={disconnectUSBScanner}>
										⏏️ DISCONNECT SCANNER
									</button>
								{/if}
							</div>
							
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

	.scanner-controls {
		display: flex;
		gap: 12px;
		margin: 8px 0;
	}

	.btn-scanner {
		padding: 12px 24px;
		background: #007aff;
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

	.btn-scanner:hover {
		background: #0051d5;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
	}

	.btn-scanner.btn-disconnect {
		background: #ff9500;
	}

	.btn-scanner.btn-disconnect:hover {
		background: #cc7700;
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
