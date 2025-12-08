<!-- Main Verification Page -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import FaceMatch from '$lib/components/FaceMatch.svelte';
	import ConsentDialog from '$lib/components/ConsentDialog.svelte';
	import { studentStore } from '$lib/stores/student.svelte';
	import { loadModels, getModelsLoaded, getLoadProgress } from '$lib/services/face';
	import { initDB, getStudentById } from '$lib/services/db';

	let faceMatchRef = $state<any>();
	let videoElement = $state<HTMLVideoElement>();
	let cameraStream = $state<MediaStream | null>(null);
	let cameraReady = $state<boolean>(false);

	let modelsLoading = $state<boolean>(true);
	let modelProgress = $state<number>(0);
	let showConsent = $state<boolean>(false);
	let step = $state<'scan' | 'verification' | 'result'>('scan');
	let recognitionActive = $state<boolean>(false);
	
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
	let isProcessingScan = $state<boolean>(false);
	let scannerAutoConnecting = $state<boolean>(false);
	
	// Keyboard buffer for barcode scanner (fallback mode - WebHID is faster)
	const SCAN_SPEED_THRESHOLD = 50;  // Reduced from 100ms for faster detection
	const SCAN_COMPLETE_DELAY = 80;   // Reduced from 150ms for faster processing
	let scanStartTime = $state<number>(0);
	let isScanInProgress = $state<boolean>(false);

	// Start camera immediately on mount for preview (always on)
	// Camera stream is always running - only face recognition toggles
	async function startCameraPreview() {
		try {
			console.log('🎥 Starting camera stream (always on)...');
			const stream = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: 'user',
					width: { ideal: 640 },
					height: { ideal: 480 }
				}
			});
			
			cameraStream = stream;
			
			// Attach to video element when ready (non-blocking check)
			const attachStream = () => {
				if (videoElement) {
					videoElement.srcObject = stream;
					videoElement.play().then(() => {
						cameraReady = true;
						console.log('🎥 Camera stream active and ready');
					}).catch(err => {
						console.error('Video play error:', err);
					});
				} else {
					// Retry quickly if element not ready yet
					requestAnimationFrame(attachStream);
				}
			};
			attachStream();
			
		} catch (err) {
			console.error('🎥 Camera error:', err);
			scanError = '❌ Camera access denied. Please allow camera access.';
		}
	}

	function stopCameraPreview() {
		if (cameraStream) {
			cameraStream.getTracks().forEach(track => track.stop());
			cameraStream = null;
			cameraReady = false;
		}
	}

	// Turnstile control functions
	async function unlockTurnstile(studentId: string, studentName: string) {
		try {
			const res = await fetch('/api/turnstile/control', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'unlock', studentId, studentName })
			});
			const data = await res.json();
			console.log('🔓 Turnstile unlock sent:', data);
		} catch (err) {
			console.error('❌ Turnstile control error:', err);
		}
	}

	async function lockTurnstile() {
		try {
			const res = await fetch('/api/turnstile/control', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'lock' })
			});
			const data = await res.json();
			console.log('🔒 Turnstile lock sent:', data);
		} catch (err) {
			console.error('❌ Turnstile control error:', err);
		}
	}

	// Parse barcode format: "Name ID Course"
	function parseBarcode(input: string): { name: string; id: string; course: string } | null {
		const trimmed = input.trim();
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
		if (!barcodeData.trim() || isProcessingScan) return;
		
		isProcessingScan = true;
		console.log('🔍 Barcode scanned:', barcodeData);
		
		const parsed = parseBarcode(barcodeData);
		
		if (!parsed) {
			scanError = '❌ Invalid barcode format';
			scannedInput = '';
			isProcessingScan = false;
			return;
		}
		
		console.log('📋 Parsed data:', parsed);
		
		try {
			const student = await getStudentById(parsed.id);
			
			if (!student) {
				scanError = '❌ User not registered';
				scannedInput = '';
				isProcessingScan = false;
				return;
			}
			
			console.log('✅ Valid student found:', student);
			
			scannedStudent = student;
			studentStore.currentStudent = student;
			scanError = '';
			scannedInput = '';
			
			// Enable face recognition (camera is already running)
			step = 'verification';
			recognitionActive = true;
			verificationStartTime = Date.now();
			isProcessingScan = false;
			
		} catch (err) {
			console.error('Error checking student:', err);
			scanError = '❌ Database error: ' + String(err);
			scannedInput = '';
			isProcessingScan = false;
		}
	}

	// Global keyboard listener for barcode scanner (fallback when WebHID not connected)
	function handleGlobalKeydown(event: KeyboardEvent) {
		// 🚀 Skip keyboard processing if WebHID scanner is connected (faster)
		if (scannerConnected) return;
		
		const now = Date.now();
		const timeSinceLastKey = now - lastKeyTime;
		
		const isRapidInput = timeSinceLastKey < SCAN_SPEED_THRESHOLD;
		const isPrintableKey = event.key.length === 1;
		const isScannerKey = event.key === 'Tab' || event.key === 'Enter' || isPrintableKey;
		
		if ((isRapidInput && isScannerKey) || isScanInProgress || isProcessingScan) {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
		}
		
		if (step !== 'scan') return;
		if (isProcessingScan) return;
		
		if (event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			lastKeyTime = now;
			if (isRapidInput || scanBuffer.length > 0) {
				isScanInProgress = true;
			}
			return;
		}
		
		if (event.key === 'Shift') return;
		
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
		
		if (isPrintableKey) {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			
			if (isRapidInput || scanBuffer.length === 0) {
				if (scanBuffer.length === 0) {
					scanStartTime = now;
					isScanInProgress = true;
					console.log('🔄 Scan started');
				}
				
				scanBuffer += event.key;
				scannedInput = scanBuffer;
				
				if (scanTimeout) clearTimeout(scanTimeout);
				
				scanTimeout = setTimeout(() => {
					if (scanBuffer.length > 3 && isScanInProgress) {
						console.log('📊 Scanner timeout - processing:', scanBuffer);
						isScanInProgress = false;
						processBarcodeData(scanBuffer);
						scanBuffer = '';
						scannedInput = '';
					}
				}, SCAN_COMPLETE_DELAY);
			} else {
				scanBuffer = event.key;
				scanStartTime = now;
				isScanInProgress = true;
			}
			lastKeyTime = now;
		} else {
			if (isScanInProgress) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
			}
		}
	}
	
	// Auto-connect to previously paired HID scanner devices
	async function autoConnectScanner() {
		if (!('hid' in navigator)) {
			console.log('⚠️ WebHID not supported, using keyboard mode');
			return;
		}
		
		scannerAutoConnecting = true;
		
		try {
			// Get previously paired devices (no user gesture needed!)
			const devices = await (navigator as any).hid.getDevices();
			console.log('🔍 Found previously paired HID devices:', devices.length);
			
			if (devices.length > 0) {
				// Find Yuriot ScanCode Box or any scanner
				let scanner = devices.find((d: any) => 
					d.productName?.toLowerCase().includes('yuriot') ||
					d.productName?.toLowerCase().includes('scan') ||
					d.productName?.toLowerCase().includes('barcode')
				) || devices[0];
				
				if (!scanner.opened) {
					await scanner.open();
				}
				
				scannerDevice = scanner;
				scannerConnected = true;
				console.log('✅ Auto-connected to scanner:', scanner.productName);
				
				// Set up input listener
				setupHIDListener(scanner);
			} else {
				console.log('📋 No previously paired devices. Keyboard mode active.');
				console.log('💡 Connect scanner once manually, then it will auto-connect on refresh.');
			}
		} catch (err) {
			console.log('⚠️ Could not auto-connect HID devices:', err);
		} finally {
			scannerAutoConnecting = false;
		}
	}
	
	// Set up HID input listener for scanner - FAST direct processing
	function setupHIDListener(device: any) {
		let hidBuffer = '';
		
		device.addEventListener('inputreport', (event: any) => {
			const { data } = event;
			for (let i = 2; i < data.byteLength; i++) {
				const keyCode = data.getUint8(i);
				if (keyCode === 0) continue;
				const char = hidKeyCodeToChar(keyCode, data.getUint8(0));
				if (char) {
					if (char === '\n') {
						if (hidBuffer.length > 0) {
							// 🚀 Process immediately - no state update delay
							const barcodeData = hidBuffer;
							hidBuffer = '';
							scannedInput = '';
							processBarcodeData(barcodeData);
						}
					} else {
						hidBuffer += char;
						// Only update UI periodically, not every character
						if (hidBuffer.length % 5 === 0 || hidBuffer.length < 5) {
							scannedInput = hidBuffer;
						}
					}
				}
			}
		});
		
		console.log('🎧 WebHID input listener attached - FAST MODE');
	}

	// USB Scanner functions
	async function connectUSBScanner() {
		try {
			if (!('hid' in navigator)) {
				console.log('⚠️ WebHID not supported, using keyboard mode');
				scanError = '⚠️ WebHID not supported. Scanner will work in keyboard mode.';
				return;
			}
			
			// Request device - this REQUIRES user gesture (click)
			const devices = await (navigator as any).hid.requestDevice({ 
				filters: [
					// Add common barcode scanner vendor IDs
					{ vendorId: 0x05e0 }, // Symbol
					{ vendorId: 0x0c2e }, // Honeywell
					{ vendorId: 0x05f9 }, // Datalogic
				]
			});
			
			if (devices.length === 0) {
				// Try without filters
				const allDevices = await (navigator as any).hid.requestDevice({ filters: [] });
				if (allDevices.length === 0) {
					scanError = '❌ No scanner selected';
					return;
				}
				devices.push(...allDevices);
			}
			
			const device = devices[0];
			if (!device.opened) await device.open();
			
			scannerDevice = device;
			scannerConnected = true;
			scanError = '';
			console.log('✅ Scanner connected:', device.productName);
			
			// Set up listener
			setupHIDListener(device);
			
		} catch (err) {
			console.error('Scanner connection error:', err);
			scanError = '❌ Failed to connect scanner: ' + String(err);
		}
	}
	
	async function disconnectUSBScanner() {
		if (scannerDevice) {
			try {
				await scannerDevice.close();
			} catch (err) {
				console.error('Error disconnecting scanner:', err);
			}
			scannerDevice = null;
			scannerConnected = false;
		}
	}
	
	function hidKeyCodeToChar(keyCode: number, modifier: number): string | null {
		const shift = (modifier & 0x22) !== 0;
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
			0x28: ['\n', '\n'], 0x2B: ['\t', '\t'], 0x2C: [' ', ' '],
			0x2D: ['-', '_'], 0x2E: ['=', '+'], 0x2F: ['[', '{'], 0x30: [']', '}'],
			0x33: [';', ':'], 0x34: ["'", '"'], 0x36: [',', '<'], 0x37: ['.', '>'],
			0x38: ['/', '?'],
		};
		const mapping = keyMap[keyCode];
		if (!mapping) return null;
		return shift ? mapping[1] : mapping[0];
	}

	async function handleBarcodeInput(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		if (!scannedInput.trim()) return;
		await processBarcodeData(scannedInput);
		scannedInput = '';
	}

	// Stop recognition and reset when verification is complete
	function handleVerificationComplete(success: boolean) {
		console.log('🎯 Verification complete:', success ? 'SUCCESS' : 'FAILED');
		
		// Stop face recognition but keep camera running for next person
		recognitionActive = false;
		step = 'result';
		
		// 🚀 TRIGGER TURNSTILE - unlock on success
		if (success && scannedStudent) {
			unlockTurnstile(scannedStudent.id, scannedStudent.name);
		}
		
		// Auto-reset after 1.5 seconds for fast transaction
		setTimeout(() => {
			resetVerification();
		}, 1500);
	}

	function resetVerification() {
		console.log('🔄 Resetting verification...');
		
		// 🚀 LOCK TURNSTILE on reset
		lockTurnstile();
		
		// Stop recognition
		recognitionActive = false;
		
		if (scanTimeout) {
			clearTimeout(scanTimeout);
			scanTimeout = null;
		}
		
		// Reset state but keep camera running
		studentStore.reset();
		scannedStudent = null;
		scannedInput = '';
		scanBuffer = '';
		scanError = '';
		step = 'scan';
		verificationStartTime = null;
		showConsent = false;
		isProcessingScan = false;
		isScanInProgress = false;
		lastKeyTime = 0;
		
		// Refocus the input
		setTimeout(() => {
			document.getElementById('barcode-input')?.focus();
		}, 100);
	}

	function getVideoElement(): HTMLVideoElement | undefined {
		return videoElement;
	}

	onMount(async () => {
		try {
			await initDB();
			
			// 🚀 Start camera IMMEDIATELY in parallel with model loading
			// Camera is always on - only face recognition toggles on/off
			const cameraPromise = startCameraPreview();
			
			// Load face models in parallel
			const modelsPromise = loadModels((progress) => {
				modelProgress = progress;
			});
			
			// Set up keyboard listener immediately (no waiting)
			window.addEventListener('keydown', handleGlobalKeydown, { capture: true });
			console.log('🔌 Global keyboard listener added');
			
			// Focus input immediately
			setTimeout(() => {
				document.getElementById('barcode-input')?.focus();
			}, 50);
			
			// Auto-connect scanner in background (non-blocking)
			autoConnectScanner();
			
			// Wait for both camera and models to be ready
			await Promise.all([cameraPromise, modelsPromise]);
			modelsLoading = false;
			
			console.log('✅ System ready - camera always on, face recognition on demand');
			
		} catch (err) {
			console.error('Failed to initialize:', err);
			studentStore.errorMessage = 'Failed to initialize system. Please refresh.';
		}
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', handleGlobalKeydown, { capture: true });
			if (scanTimeout) clearTimeout(scanTimeout);
			disconnectUSBScanner();
		}
		stopCameraPreview();
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
					<h3 class="stat-label">CAMERA</h3>
					<p class="stat-value" style="color: {cameraReady ? '#34c759' : '#ff3b30'}">
						{cameraReady ? 'READY' : 'LOADING'}
					</p>
				</div>
				<div class="stat-card">
					<h3 class="stat-label">STEP</h3>
					<p class="stat-value">{step.toUpperCase()}</p>
				</div>
				<div class="stat-card">
					<h3 class="stat-label">SCANNER</h3>
					<p class="stat-value" style="color: {scannerConnected ? '#34c759' : scannerAutoConnecting ? '#ff9500' : '#007aff'}">
						{scannerConnected ? 'USB CONNECTED' : scannerAutoConnecting ? 'CONNECTING...' : 'KEYBOARD MODE'}
					</p>
				</div>
			</section>

			<!-- Verification Section -->
			<section class="verification-section">
				<!-- Hidden video element for internal face detection processing -->
				<video 
					bind:this={videoElement} 
					autoplay 
					playsinline 
					muted
					class="hidden-video"
				>
					<track kind="captions" src="" srclang="en" label="No captions" default />
				</video>

				{#if step === 'scan'}
					<div class="step-container">
						<h2 class="step-title">SCAN STUDENT ID TO BEGIN</h2>
						
						<div class="scanner-box">
							<div class="scanner-icon">
								<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<rect x="3" y="5" width="18" height="14" rx="2" />
									<line x1="3" y1="10" x2="21" y2="10" />
									<line x1="7" y1="15" x2="7" y2="15" />
									<line x1="11" y1="15" x2="17" y2="15" />
								</svg>
							</div>
							
							<h3 class="scanner-instruction">SCAN OR SWIPE STUDENT ID CARD</h3>
							<p class="scanner-detail">
								{#if scannerConnected}
									✅ USB Scanner connected
								{:else}
									Keyboard mode active
								{/if}
							</p>
							
							<div class="scanner-controls">
								{#if !scannerConnected}
									<button class="btn-scanner" onclick={connectUSBScanner}>
										🔌 CONNECT USB SCANNER
									</button>
								{:else}
									<button class="btn-scanner btn-disconnect" onclick={disconnectUSBScanner}>
										⏏️ DISCONNECT
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
						</div>
					</div>
				{:else if step === 'verification'}
					<div class="step-container">
						<h2 class="step-title">VERIFYING FACE...</h2>
						{#if studentStore.currentStudent && videoElement && recognitionActive}
							<FaceMatch
								bind:this={faceMatchRef}
								videoElement={videoElement}
								student={studentStore.currentStudent}
								onComplete={handleVerificationComplete}
							/>
						{/if}
					</div>
				{:else if step === 'result'}
					<div class="result-container">
						<h2 class="result-title {studentStore.verificationStatus === 'success' ? 'success' : 'failed'}">
							{studentStore.verificationStatus === 'success' ? '✓ VERIFIED' : '✗ FAILED'}
						</h2>
						{#if scannedStudent}
							<p class="result-name">{scannedStudent.name}</p>
						{/if}
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
<ConsentDialog 
	bind:open={showConsent} 
	onAccept={() => { showConsent = false; }}
	onDecline={() => { showConsent = false; scanError = 'Consent declined'; }}
/>

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

	/* Hidden video for internal face detection processing */
	.hidden-video {
		position: absolute;
		left: -9999px;
		width: 640px;
		height: 480px;
		opacity: 0;
		pointer-events: none;
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
		text-align: center;
	}

	/* Result Container */
	.result-container {
		text-align: center;
		padding: 32px;
	}

	.result-title {
		font-size: 24px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 1px;
		margin: 0 0 16px 0;
	}

	.result-title.success {
		color: #34c759;
	}

	.result-title.failed {
		color: #ff3b30;
	}

	.result-name {
		font-size: 20px;
		font-weight: bold;
		margin: 0 0 16px 0;
		color: #383838;
	}

	/* Scanner Styles */
	.scanner-box {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 32px;
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
