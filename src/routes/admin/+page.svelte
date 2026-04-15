<!-- Admin Panel Page - Face Recognition with Multi-Angle Capture -->
<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { getAllStudents, addStudent, deleteStudent, clearAllData, initDB, type Student } from '$lib/services/db';
	import { generateQRCodeData, validateStudentID } from '$lib/services/qr';
	import { validateName, validateEmail, validatePhone, validateProgram, validateYear, sanitizeInput } from '$lib/utils/validation';
	import { loadModels, detectFace, getModelsLoaded, captureFrameAsBase64 } from '$lib/services/face';
	import {
		attachStreamToVideo,
		detachVideoStream,
		getCameraErrorMessage,
		requestCameraStream,
		stopMediaStream,
		watchCameraDisconnect
	} from '$lib/services/camera';

	let students = $state<Student[]>([]);
	let loading = $state<boolean>(true);
	let showAddForm = $state<boolean>(false);
	let showFacePage = $state<boolean>(false);
	let showTestPage = $state<boolean>(false);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);
	let dbInitialized = $state<boolean>(false);

	// Form fields
	let formData = $state({
		id: '',
		name: '',
		email: '',
		phone: '',
		program: '',
		year: new Date().getFullYear()
	});

	// Multi-angle face capture
	let videoElement = $state<HTMLVideoElement>();
	let canvasElement = $state<HTMLCanvasElement>();
	let stream = $state<MediaStream | null>(null);
	let faceStep = $state<number>(1);
	let capturedImages = $state<{pic1: string, pic2: string, pic3: string}>({
		pic1: '',
		pic2: '',
		pic3: ''
	});
	let faceInstruction = $state<string>('');
	let capturing = $state<boolean>(false);
	
	// Test recognition
	let testVideoElement = $state<HTMLVideoElement>();
	let testCanvasElement = $state<HTMLCanvasElement>();
	let testStream = $state<MediaStream | null>(null);
	let testResult = $state<string>('');
	let testResultColor = $state<string>('black');
	let testImageUrl = $state<string>('');
	let faceCameraDisconnectCleanup: (() => void) | null = null;
	let testCameraDisconnectCleanup: (() => void) | null = null;
	let captureSessionId = 0;
	let autoCaptureTimeout: ReturnType<typeof setTimeout> | null = null;

	onMount(async () => {
		await initDatabase();
		await loadStudents();
	});

	onDestroy(() => {
		stopCamera();
		stopTestCamera();
	});

	function clearAutoCaptureTimeout() {
		if (autoCaptureTimeout) {
			clearTimeout(autoCaptureTimeout);
			autoCaptureTimeout = null;
		}
	}

	function handleFaceCameraFailure(message: string) {
		console.error('Face capture camera failure:', message);
		stopCamera();
		capturedImages = { pic1: '', pic2: '', pic3: '' };
		faceStep = 1;
		faceInstruction = '';
		showFacePage = false;
		showAddForm = true;
		error = message;
	}

	function handleTestCameraFailure(message: string) {
		console.error('Test camera failure:', message);
		stopTestCamera();
		error = message;
	}

	async function initDatabase() {
		if (dbInitialized) return;

		try {
			console.log('💾 Initializing database...');
			await initDB();
			dbInitialized = true;
			console.log('✅ Database initialized successfully');
		} catch (err) {
			console.error('❌ Failed to initialize database:', err);
			error = 'Failed to initialize database: ' + String(err);
			throw err;
		}
	}

async function loadStudents() {
	try {
		loading = true;
		students = await getAllStudents();
	} catch (err) {
		console.warn('Failed to load students, using empty list:', err);
		students = []; // Use empty list if database fails
		error = 'Database not available - some features may not work';
	} finally {
		loading = false;
	}
}	// Multi-angle face capture functions
	async function startCamera(): Promise<boolean> {
		error = null;
		stopCamera();

		if (!videoElement) {
			await tick();
		}

		if (!videoElement) {
			error = 'Camera preview is not ready yet. Please try again.';
			return false;
		}

		try {
			const mediaStream = await requestCameraStream();
			const disconnectCleanup = watchCameraDisconnect(mediaStream, handleFaceCameraFailure);

			try {
				await attachStreamToVideo(videoElement, mediaStream);
			} catch (cameraError) {
				disconnectCleanup();
				stopMediaStream(mediaStream);
				throw cameraError;
			}

			stream = mediaStream;
			faceCameraDisconnectCleanup = disconnectCleanup;
			return true;
		} catch (cameraError) {
			error = getCameraErrorMessage(cameraError, 'Unable to start camera.');
			stopCamera();
			return false;
		}

		/*
		try {
			const attempts = [
				{ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } },
				{ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } },
				{ video: { facingMode: 'user' } },
				{ video: true }
			];

			for (const config of attempts) {
				try {
					stream = await navigator.mediaDevices.getUserMedia(config);
					break;
				} catch (err) {
					console.warn('Camera config failed, trying next...', err);
				}
			}

			if (!stream) throw new Error('Could not access camera');

			if (videoElement) {
				videoElement.srcObject = stream;
				await videoElement.play();
			}

			console.log('✅ Camera started successfully');
		} catch (err) {
			error = 'Camera access denied: ' + String(err);
		}
		*/
	}

	function stopCamera() {
		captureSessionId += 1;
		clearAutoCaptureTimeout();
		capturing = false;

		if (faceCameraDisconnectCleanup) {
			faceCameraDisconnectCleanup();
			faceCameraDisconnectCleanup = null;
		}

		if (stream) {
			stopMediaStream(stream);
			stream = null;
		}

		detachVideoStream(videoElement);
	}

	function takeSnapshot(): string {
		if (!videoElement) return '';

		try {
			return captureFrameAsBase64(videoElement, true, 0.92);
		} catch (cameraError) {
			throw new Error(getCameraErrorMessage(cameraError, 'Unable to capture a frame from the camera.'));
		}
	}

	async function checkOrientation(): Promise<string> {
		let frame = '';

		try {
			frame = takeSnapshot();
		} catch (cameraError) {
			handleFaceCameraFailure(
				getCameraErrorMessage(cameraError, 'Camera connection lost during face capture.')
			);
			return 'camera-error';
		}

		if (!frame) return 'none';

		try {
			const res = await fetch('/api/face/check-orientation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ image: frame })
			});
			const data = await res.json();
			return data.orientation || 'none';
		} catch (err) {
			console.error('Orientation check error:', err);
			return 'none';
		}
	}

	function getFaceInstruction(step: number): string {
		if (step === 1) return 'Look straight ahead';
		if (step === 2) return 'Turn your face slightly RIGHT';
		if (step === 3) return 'Turn your face slightly LEFT';
		return '';
	}

	async function autoCaptureSequence(sessionId: number) {
		capturing = true;
		faceStep = 1;
		capturedImages = { pic1: '', pic2: '', pic3: '' };

		const instructions: Record<number, string> = {
			1: 'front',
			2: 'right',
			3: 'left'
		};

		while (faceStep <= 3 && sessionId === captureSessionId) {
			faceInstruction = getFaceInstruction(faceStep);
			let captured = false;

			while (!captured && sessionId === captureSessionId) {
				const orientation = await checkOrientation();
				if (orientation === 'camera-error' || sessionId !== captureSessionId) {
					capturing = false;
					return;
				}
				console.log(`Step ${faceStep}: Detected orientation = ${orientation}`);

				if (orientation === instructions[faceStep]) {
					let frame = '';
					try {
						frame = takeSnapshot();
					} catch (cameraError) {
						handleFaceCameraFailure(
							getCameraErrorMessage(cameraError, 'Camera connection lost during face capture.')
						);
						capturing = false;
						return;
					}
					capturedImages[`pic${faceStep}` as keyof typeof capturedImages] = frame;
					console.log(`✅ Captured step ${faceStep}`);
					captured = true;
					faceStep++;
					await new Promise(res => setTimeout(res, 1500));
				}

				await new Promise(res => setTimeout(res, 2000));
			}
		}

		if (sessionId !== captureSessionId) {
			capturing = false;
			return;
		}

		capturing = false;
		await registerWithFaces();
	}

	async function registerWithFaces() {
		if (!capturedImages.pic1 || !capturedImages.pic2 || !capturedImages.pic3) {
			error = 'Please capture all 3 pictures';
			return;
		}

		console.log('� Extracting face descriptors in browser...');

		try {
			// Load face detection models if not already loaded
			if (!getModelsLoaded()) {
				console.log('📦 Loading face detection models...');
				await loadModels();
			}

			// Extract descriptors from each image in the browser
			const descriptors: number[][] = [];
			
			for (let i = 1; i <= 3; i++) {
				const imageKey = `pic${i}` as keyof typeof capturedImages;
				const imageBase64 = capturedImages[imageKey];
				
				// Create image element from base64
				const img = document.createElement('img');
				await new Promise((resolve, reject) => {
					img.onload = resolve;
					img.onerror = reject;
					img.src = imageBase64;
				});
				
				console.log(`🔍 Image ${i} loaded: ${img.naturalWidth}x${img.naturalHeight}`);
				
				// Images are already grayscale+cropped from takeSnapshot()
				// Pass false for grayscale to avoid double-processing
				const detection = await detectFace(img, false);
				
				if (!detection) {
					console.warn(`⚠️ No face detected in image ${i}, retrying with lower threshold...`);
					// Retry: try without center-crop preprocessing (image is already 640x480)
					const { default: faceapiModule } = await import('@vladmandic/face-api') as any;
					const fapi = faceapiModule || await import('@vladmandic/face-api');
					const retryDetection = await fapi
						.detectSingleFace(img, new fapi.TinyFaceDetectorOptions({
							inputSize: 416,
							scoreThreshold: 0.3
						}))
						.withFaceLandmarks()
						.withFaceDescriptor();
					
					if (!retryDetection) {
						console.warn(`❌ Still no face in image ${i} after retry`);
						error = `No face detected in picture ${i}. Please ensure your face is clearly visible and try again.`;
						return;
					}
					
					descriptors.push(Array.from(retryDetection.descriptor));
					console.log(`✅ Face descriptor ${i} extracted (retry with lower threshold)`);
				} else {
					descriptors.push(Array.from(detection.descriptor));
					console.log(`✅ Face descriptor ${i} extracted`);
				}
			}

			if (descriptors.length !== 3) {
				error = 'Failed to extract all face descriptors';
				return;
			}

			console.log('📤 Sending registration with descriptors:', {
				descriptorCount: descriptors.length,
				pic1Length: capturedImages.pic1.length,
				pic2Length: capturedImages.pic2.length,
				pic3Length: capturedImages.pic3.length
			});

			const payload = {
				id: formData.id,
				name: formData.name,
				email: formData.email,
				images: capturedImages,
				descriptors: descriptors // Send pre-computed descriptors
			};

			const res = await fetch('/api/face/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			const result = await res.json();

			if (res.ok) {
				success = result.message || '✅ Face registration successful!';
				error = null;
				
				// Reset form and go back to add form
				resetForm();
				showAddForm = true;
			} else {
				error = result.message || '❌ Face registration failed';
			}
		} catch (err) {
			error = '❌ Registration failed: ' + String(err);
		}
	}



	async function handleSubmit() {
		error = null;
		success = null;

		if (!validateStudentID(formData.id)) {
			error = 'Invalid Student ID format (5-20 alphanumeric characters)';
			return;
		}

		if (!validateName(formData.name)) {
			error = 'Invalid name format';
			return;
		}

		if (!validateEmail(formData.email)) {
			error = 'Invalid email format';
			return;
		}

		if (formData.phone && !validatePhone(formData.phone)) {
			error = 'Invalid phone format';
			return;
		}

		if (formData.program && !validateProgram(formData.program)) {
			error = 'Invalid program format';
			return;
		}

		if (!validateYear(formData.year)) {
			error = 'Invalid year';
			return;
		}

		// Move to face capture page
		showAddForm = false;
		showFacePage = true;

		capturedImages = { pic1: '', pic2: '', pic3: '' };
		faceInstruction = '';
		faceStep = 1;

		await tick();
		const cameraStarted = await startCamera();
		if (!cameraStarted) {
			showFacePage = false;
			showAddForm = true;
			return;
		}

		clearAutoCaptureTimeout();
		const sessionId = captureSessionId;
		autoCaptureTimeout = setTimeout(() => {
			void autoCaptureSequence(sessionId);
		}, 1000);
	}
function resetForm() {
	formData = {
		id: '',
		name: '',
		email: '',
		phone: '',
		program: '',
		year: new Date().getFullYear()
	};
	capturedImages = { pic1: '', pic2: '', pic3: '' };
	faceStep = 1;
	faceInstruction = '';
	capturing = false;
	stopCamera();
	showFacePage = false;
}
	// Test recognition functions
	async function startTestCamera() {
		error = null;
		stopTestCamera();

		try {
			const mediaStream = await requestCameraStream([
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
			]);

			const disconnectCleanup = watchCameraDisconnect(mediaStream, handleTestCameraFailure);
			testStream = mediaStream;
			await tick();

			if (!testVideoElement) {
				disconnectCleanup();
				stopMediaStream(mediaStream);
				throw new Error('Test camera preview is not ready yet.');
			}

			try {
				await attachStreamToVideo(testVideoElement, mediaStream);
			} catch (cameraError) {
				disconnectCleanup();
				stopMediaStream(mediaStream);
				throw cameraError;
			}

			testCameraDisconnectCleanup = disconnectCleanup;
			return;
		} catch (cameraError) {
			error = getCameraErrorMessage(cameraError, 'Unable to start test camera.');
			stopTestCamera();
			return;
		}
		/*
		console.log('🎥 Starting test camera...');
		try {
			const attempts = [
				{ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } },
				{ video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } } },
				{ video: { facingMode: 'user' } },
				{ video: true }
			];

			let stream: MediaStream | null = null;
			for (const config of attempts) {
				try {
					stream = await navigator.mediaDevices.getUserMedia(config);
					break;
				} catch (err) {
					console.warn('Camera config failed, trying next...', err);
				}
			}

			if (!stream) throw new Error('Could not access camera');

			console.log('✅ Camera stream obtained:', stream);

			// Set the stream state to trigger DOM update
			testStream = stream;

			// Wait for DOM to update and video element to be bound
			await tick();

			if (testVideoElement) {
				console.log('📹 Setting video element srcObject');
				testVideoElement.srcObject = testStream;
				await testVideoElement.play();
				console.log('▶️ Video playing, dimensions:', testVideoElement.videoWidth, 'x', testVideoElement.videoHeight);
			} else {
				console.error('❌ testVideoElement is null after DOM update');
				error = 'Video element not found';
			}
		} catch (err) {
			console.error('❌ Camera access error:', err);
			error = 'Test camera access denied: ' + String(err);
		}
		*/
	}

	function stopTestCamera() {
		if (testCameraDisconnectCleanup) {
			testCameraDisconnectCleanup();
			testCameraDisconnectCleanup = null;
		}

		if (testStream) {
			stopMediaStream(testStream);
			testStream = null;
		}

		detachVideoStream(testVideoElement);
	}

	function takeTestSnapshot(): string {
		if (!testVideoElement) return '';

		try {
			return captureFrameAsBase64(testVideoElement, true, 0.8);
		} catch (cameraError) {
			error = getCameraErrorMessage(cameraError, 'Unable to capture a test frame from the camera.');
			return '';
		}
	}

	async function testRecognition() {
		// Small delay to ensure video is ready
		await new Promise(resolve => setTimeout(resolve, 100));
		
		const image = takeTestSnapshot();
		if (!image) {
			error = 'Failed to capture test image - video may not be ready';
			return;
		}

		try {
			const res = await fetch('/api/face/recognize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ image })
			});

			const data = await res.json();
			testResult = data.message || 'No result';
			testResultColor = data.message && data.message.includes('Welcome') ? 'green' : 'red';
			testImageUrl = data.imageUrl || '';

			if (data.confidence) {
				testResult += ` (Confidence: ${(parseFloat(data.confidence) * 100).toFixed(1)}%)`;
			}

			console.log('Test recognition result:', data);
		} catch (err) {
			testResult = '❌ Recognition test failed';
			testResultColor = 'red';
			error = 'Test recognition failed: ' + String(err);
		}
	}

	// Development helper: Fill form with test data
	function fillTestData() {
		const timestamp = Date.now();
		const randomNum = Math.floor(Math.random() * 9000000000) + 1000000000; // 10-digit number
		
		formData = {
			id: randomNum.toString(),
			name: `Test Student ${randomNum}`,
			email: `student${randomNum}@test.edu`,
			phone: `+1234567${String(randomNum).padStart(4, '0')}`,
			program: 'Computer Science',
			year: 2024
		};
		
		success = 'Test data filled! Now capture a face.';
	}

	async function handleDelete(id: string) {
		if (!confirm('Are you sure you want to delete this student?')) return;

		try {
			await deleteStudent(id);
			success = 'Student deleted successfully';
			await loadStudents();
		} catch (err) {
			error = 'Failed to delete student: ' + String(err);
		}
	}

	async function handleClearAll() {
		if (!confirm('WARNING: This will delete ALL student data. Are you sure?')) return;
		if (!confirm('This action cannot be undone. Continue?')) return;

		try {
			await clearAllData();
			success = 'All data cleared successfully';
			await loadStudents();
		} catch (err) {
			error = 'Failed to clear data: ' + String(err);
		}
	}
</script>

<svelte:head>
	<title>Admin Panel - Student Verification</title>
</svelte:head>

<div class="admin-container">
	<!-- Header -->
	<header class="header">
		<div class="logo-box">
			<span class="logo-text">AD</span>
		</div>
		<h1 class="brand">ADMIN PANEL</h1>
		<a href="/" class="btn-header">BACK TO APP</a>
	</header>

	<!-- Alert Bar -->
	<div class="alert-bar">
		<p class="alert-text">⚠ GDPR COMPLIANT - ALL DATA ENCRYPTED WITH AES-256-GCM</p>
	</div>

	<!-- Main Content -->
	<main class="main-content">
		<!-- Stats -->
		<section class="stats-section">
			<div class="stat-card">
				<h3 class="stat-label">TOTAL STUDENTS</h3>
				<p class="stat-value">{students.length}</p>
			</div>
			<div class="stat-card">
				<h3 class="stat-label">CONSENTED</h3>
				<p class="stat-value">{students.filter(s => s.consentGiven).length}</p>
			</div>
			<div class="stat-card">
				<h3 class="stat-label">DATABASE</h3>
				<p class="stat-value">ENCRYPTED</p>
			</div>
		</section>

		<!-- Actions -->
		<section class="actions-section">
			<button class="btn-add" onclick={() => showAddForm = !showAddForm}>
				{showAddForm ? 'CANCEL' : '+ ADD STUDENT'}
			</button>
			<button class="btn-danger-outline" onclick={handleClearAll}>
				CLEAR ALL DATA
			</button>
		</section>

		<!-- Messages -->
		{#if error}
			<div class="error-box">
				<p class="message-text">{error}</p>
			</div>
		{/if}

		{#if success}
			<div class="success-box">
				<p class="message-text">{success}</p>
			</div>
		{/if}

		<!-- Add Student Form -->
		{#if showAddForm}
			<section class="form-section">
				<div class="section-header">
					<h2 class="section-title">ADD NEW STUDENT</h2>
					<button type="button" class="btn-autofill" onclick={fillTestData}>
						🎲 AUTO-FILL TEST DATA
					</button>
				</div>

				<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
					<div class="form-grid">
						<div class="form-group">
							<label class="form-label">STUDENT ID*</label>
							<input
								type="text"
								class="form-input"
								bind:value={formData.id}
								placeholder="2013102064"
								required
							/>
						</div>

						<div class="form-group">
							<label class="form-label">FULL NAME*</label>
							<input
								type="text"
								class="form-input"
								bind:value={formData.name}
								placeholder="John Doe"
								required
							/>
						</div>

						<div class="form-group">
							<label class="form-label">EMAIL*</label>
							<input
								type="email"
								class="form-input"
								bind:value={formData.email}
								placeholder="student@university.edu"
								required
							/>
						</div>

						<div class="form-group">
							<label class="form-label">PHONE</label>
							<input
								type="tel"
								class="form-input"
								bind:value={formData.phone}
								placeholder="+1234567890"
							/>
						</div>

						<div class="form-group">
							<label class="form-label">PROGRAM</label>
							<input
								type="text"
								class="form-input"
								bind:value={formData.program}
								placeholder="Computer Science"
							/>
						</div>

						<div class="form-group">
							<label class="form-label">YEAR</label>
							<input
								type="number"
								class="form-input"
								bind:value={formData.year}
								min="1900"
								max={new Date().getFullYear() + 10}
							/>
						</div>
					</div>

					<!-- Submit -->
					<button type="submit" class="btn-submit" disabled={!dbInitialized}>
						{!dbInitialized ? 'INITIALIZING DATABASE...' : 'START FACE CAPTURE'}
					</button>
				</form>
			</section>
		{/if}

		<!-- Face Capture Page -->
		{#if showFacePage}
			<section class="form-section">
				<div class="section-header">
					<h2 class="section-title">FACE CAPTURE - STEP {faceStep}/3</h2>
					<button type="button" class="btn-danger-outline" onclick={() => {
						stopCamera();
						showFacePage = false;
						showAddForm = true;
					}}>
						CANCEL
					</button>
				</div>

				<div class="face-capture-container">
					<div class="face-instruction">
						<h3 style="color: {capturing ? '#34c759' : '#007aff'}; font-size: 24px; margin-bottom: 16px;">
							{faceInstruction || 'Initializing camera...'}
						</h3>
						{#if capturing}
							<p style="font-size: 16px; color: #888;">Please hold still while we capture your face</p>
						{/if}
					</div>

					<div class="video-container" style="position: relative;">
						<video bind:this={videoElement} autoplay playsinline muted class="video-preview"></video>
					</div>
					<canvas bind:this={canvasElement} style="display: none;"></canvas>

					<div class="preview-images">
						{#if capturedImages.pic1}
							<div class="preview-image">
								<img src={capturedImages.pic1} alt="Front" />
								<p>Front</p>
							</div>
						{/if}
						{#if capturedImages.pic2}
							<div class="preview-image">
								<img src={capturedImages.pic2} alt="Right" />
								<p>Right</p>
							</div>
						{/if}
						{#if capturedImages.pic3}
							<div class="preview-image">
								<img src={capturedImages.pic3} alt="Left" />
								<p>Left</p>
							</div>
						{/if}
					</div>

					{#if faceStep > 3}
						<div class="capture-success">
							<p class="success-text">✓ ALL 3 FACES CAPTURED - REGISTERING...</p>
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<!-- Test Recognition Page -->
		{#if showTestPage}
			<section class="form-section">
				<div class="section-header">
					<h2 class="section-title">TEST FACE RECOGNITION</h2>
					<button type="button" class="btn-danger-outline" onclick={() => {
						stopTestCamera();
						showTestPage = false;
					}}>
						CLOSE
					</button>
				</div>

				<div class="test-recognition-container">
					<p style="margin-bottom: 16px; font-size: 14px; color: #888;">
						Position your face in front of the camera and click "Test Recognition" to verify if you're in the system.
					</p>

					{#if !testStream}
						<button type="button" class="btn-camera" onclick={startTestCamera}>
							START CAMERA
						</button>
					{:else}
						<div class="video-container">
							<video bind:this={testVideoElement} autoplay playsinline muted class="video-preview"></video>
						</div>
						<canvas bind:this={testCanvasElement} style="display: none;"></canvas>

						<div class="camera-actions" style="margin-top: 16px;">
							<button type="button" class="btn-capture" onclick={testRecognition}>
								📸 TEST RECOGNITION
							</button>
							<button type="button" class="btn-danger-outline" onclick={stopTestCamera}>
								STOP CAMERA
							</button>
						</div>
					{/if}

					{#if testResult}
						<div class="test-result" style="margin-top: 24px; padding: 24px; border: 2px solid {testResultColor}; background: {testResultColor === 'green' ? '#d4edda' : '#f8d7da'};">
							{#if testImageUrl}
								<img src={testImageUrl} alt="Matched face" style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; border: 2px solid {testResultColor}; margin-bottom: 16px;" />
							{/if}
							<p style="font-size: 18px; font-weight: bold; color: {testResultColor}; margin: 0;">
								{testResult}
							</p>
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<!-- Test Recognition Button (above student list) -->
		{#if !showAddForm && !showFacePage && !showTestPage}
			<section class="actions-section">
				<button class="btn-add" style="background: #007aff;" onclick={() => {
					showTestPage = true;
					testResult = '';
					testImageUrl = '';
				}}>
					🧪 TEST FACE RECOGNITION
				</button>
			</section>
		{/if}

		<!-- Student List -->
		<section class="list-section">
			<h2 class="section-title">REGISTERED STUDENTS ({students.length})</h2>

			{#if loading}
				<div class="loading-box">
					<p class="loading-text">LOADING...</p>
				</div>
			{:else if students.length === 0}
				<div class="empty-box">
					<p class="empty-text">NO STUDENTS REGISTERED</p>
				</div>
			{:else}
				<div class="student-list">
					{#each students as student}
						<div class="student-card">
							<div class="student-header">
								<h3 class="student-name">{student.name}</h3>
								<button class="btn-delete" onclick={() => handleDelete(student.id)}>
									DELETE
								</button>
							</div>
							<div class="student-details">
								<p class="detail-item"><strong>ID:</strong> {student.id}</p>
								<p class="detail-item"><strong>EMAIL:</strong> {student.email}</p>
								{#if student.phone}
									<p class="detail-item"><strong>PHONE:</strong> {student.phone}</p>
								{/if}
								{#if student.program}
									<p class="detail-item"><strong>PROGRAM:</strong> {student.program}</p>
								{/if}
								{#if student.year}
									<p class="detail-item"><strong>YEAR:</strong> {student.year}</p>
								{/if}
								<p class="detail-item"><strong>QR CODE:</strong> {student.qrCodeData}</p>
								<p class="detail-item">
									<strong>CONSENT:</strong> {student.consentGiven ? '✓ GIVEN' : '✗ NOT GIVEN'}
								</p>
								<p class="detail-item"><strong>REGISTERED:</strong> {new Date(student.createdAt).toLocaleString()}</p>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</main>

	<!-- Footer -->
	<footer class="footer">
		<p class="footer-text">Motherduc Design System © 2025 | GDPR Compliant</p>
	</footer>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		font-family: 'JetBrains Mono', monospace;
		background: #f4efea;
		color: #383838;
	}

	.admin-container {
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
		background: #ff3b30;
	}

	.logo-text {
		font-size: 20px;
		font-weight: bold;
		color: #ffffff;
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

	/* Alert Bar */
	.alert-bar {
		background: #ff3b30;
		border-bottom: 2px solid #383838;
		padding: 12px;
		text-align: center;
	}

	.alert-text {
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin: 0;
		color: #ffffff;
	}

	/* Main Content */
	.main-content {
		flex: 1;
		max-width: 1200px;
		width: 100%;
		margin: 0 auto;
		padding: 64px 32px;
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

	/* Actions Section */
	.actions-section {
		display: flex;
		gap: 16px;
		margin-bottom: 32px;
	}

	.btn-add {
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

	.btn-add:hover {
		background: #28a745;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
	}

	.btn-danger-outline {
		padding: 16px 32px;
		background: transparent;
		color: #ff3b30;
		border: 2px solid #ff3b30;
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-danger-outline:hover {
		background: #ff3b30;
		color: #ffffff;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(255, 59, 48, 0.3);
	}

	/* Messages */
	.error-box,
	.success-box {
		padding: 16px;
		border: 2px solid #383838;
		margin-bottom: 32px;
	}

	.error-box {
		background: #ff3b30;
		color: #ffffff;
	}

	.success-box {
		background: #34c759;
		color: #ffffff;
	}

	.message-text {
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin: 0;
	}

	/* Form Section */
	.form-section {
		background: #ffffff;
		border: 2px solid #383838;
		padding: 32px;
		margin-bottom: 32px;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 24px;
		padding-bottom: 16px;
		border-bottom: 2px solid #383838;
	}

	.section-title {
		font-size: 18px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		margin: 0;
	}

	.btn-autofill {
		padding: 8px 16px;
		background: #ffe100;
		color: #383838;
		border: 2px solid #383838;
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-autofill:hover {
		background: #ffd700;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 16px;
		margin-bottom: 32px;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.form-label {
		font-size: 12px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #383838;
	}

	.form-input {
		padding: 12px;
		background: #f4efea;
		border: 2px solid #383838;
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		color: #383838;
		transition: border-color 0.15s ease;
	}

	.form-input:focus {
		outline: none;
		border-color: #007aff;
	}

	/* Camera Section */
	.camera-section {
		margin-bottom: 32px;
		padding: 24px;
		background: #f4efea;
		border: 2px solid #383838;
	}

	.subsection-title {
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin: 0 0 16px 0;
	}

	.video-container {
		margin-bottom: 16px;
		border: 2px solid #383838;
	}

	.video-preview {
		width: 100%;
		height: auto;
		display: block;
	}

	.camera-actions {
		display: flex;
		gap: 16px;
	}

	.btn-camera,
	.btn-capture {
		flex: 1;
		padding: 12px 24px;
		background: #007aff;
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

	.btn-camera:hover,
	.btn-capture:hover {
		background: #0051d5;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
	}

	.model-loading {
		padding: 24px;
		background: #007aff;
		border: 2px solid #383838;
		text-align: center;
		margin-bottom: 16px;
	}

	.model-loading .loading-text {
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #ffffff;
		margin: 0;
	}

	.btn-submit {
		width: 100%;
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

	.btn-submit:hover:not(:disabled) {
		background: #28a745;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
	}

	.btn-submit:disabled {
		background: #cccccc;
		color: #666666;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	/* List Section */
	.list-section {
		background: #ffffff;
		border: 2px solid #383838;
		padding: 32px;
	}

	.loading-box,
	.empty-box {
		padding: 64px;
		text-align: center;
	}

	.loading-text,
	.empty-text {
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #888888;
		margin: 0;
	}

	.student-list {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.student-card {
		background: #f4efea;
		border: 2px solid #383838;
		padding: 24px;
	}

	.student-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
		padding-bottom: 16px;
		border-bottom: 2px solid #383838;
	}

	.student-name {
		font-size: 16px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin: 0;
	}

	.btn-delete {
		padding: 8px 16px;
		background: transparent;
		color: #ff3b30;
		border: 2px solid #ff3b30;
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-delete:hover {
		background: #ff3b30;
		color: #ffffff;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(255, 59, 48, 0.3);
	}

	.student-details {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
	}

	.detail-item {
		font-size: 12px;
		line-height: 1.6;
		margin: 0;
	}

	.detail-item strong {
		font-weight: bold;
		text-transform: uppercase;
	}

	/* Face Capture Section */
	.face-capture-container {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.face-instruction {
		text-align: center;
		padding: 24px;
		background: #f4efea;
		border: 2px solid #383838;
	}

	.preview-images {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
		margin-top: 16px;
	}

	.preview-image {
		text-align: center;
	}

	.preview-image img {
		width: 100%;
		height: auto;
		border: 2px solid #383838;
		border-radius: 8px;
	}

	.preview-image p {
		margin-top: 8px;
		font-size: 12px;
		font-weight: bold;
		text-transform: uppercase;
		color: #888888;
	}

	.capture-success {
		padding: 16px;
		background: #34c759;
		border: 2px solid #383838;
		text-align: center;
	}

	.success-text {
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #ffffff;
		margin: 0;
	}

	/* Test Recognition Section */
	.test-recognition-container {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.test-result {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
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
		.stats-section,
		.form-grid,
		.student-details {
			grid-template-columns: 1fr;
		}

		.section-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 16px;
		}

		.btn-autofill {
			width: 100%;
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

		.actions-section {
			flex-direction: column;
		}

		.camera-actions {
			flex-direction: column;
		}
	}
</style>
