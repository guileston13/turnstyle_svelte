import fs from 'fs';
import path from 'path';
import * as faceapi from 'face-api.js';
import * as canvasPkg from 'canvas';
import { getConnection } from '$lib/services/mariadb';

const { Canvas, Image, ImageData, loadImage, createCanvas } = canvasPkg;
// @ts-ignore
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const PROJECT_ROOT = path.resolve(process.cwd());
const FACE_DIR = path.join(PROJECT_ROOT, 'static', 'face');
const DESC_DIR = path.join(PROJECT_ROOT, 'static', 'descriptors');
const MODEL_PATH = path.join(PROJECT_ROOT, 'static', 'models');

// Target dimensions for face detection
const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 480;
const TARGET_ASPECT = TARGET_WIDTH / TARGET_HEIGHT;

if (!fs.existsSync(FACE_DIR)) fs.mkdirSync(FACE_DIR, { recursive: true });
if (!fs.existsSync(DESC_DIR)) fs.mkdirSync(DESC_DIR, { recursive: true });
if (!fs.existsSync(MODEL_PATH)) fs.mkdirSync(MODEL_PATH, { recursive: true });

let modelsLoaded = false;

// ============================================================================
// 🚀 PERFORMANCE: In-memory descriptor cache (from final_attendance)
// ============================================================================
let descriptorCache = new Map<string, { descriptors: Float32Array[], name: string }>();
let descriptorCacheLoadedAt = 0;
const DESCRIPTOR_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL
let isLoadingDescriptorCache = false;

export async function ensureModelsLoaded(): Promise<void> {
	if (!modelsLoaded) {
		await Promise.all([
			faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_PATH),  // 🚀 FAST for login/recognition
			faceapi.nets.mtcnn.loadFromDisk(MODEL_PATH),              // Accurate for registration
			faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH),
			faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH),
		]);
		console.log("✅ TinyFace + MTCNN + Landmarks + Recognition models loaded");
		modelsLoaded = true;
		
		// Preload descriptor cache on startup
		await preloadDescriptorCache();
	}
}

// 🚀 TinyFaceDetector options - FAST for login recognition
const tinyFaceOptions = new faceapi.TinyFaceDetectorOptions({
	inputSize: 416,       // 416 for server (good balance of speed/accuracy)
	scoreThreshold: 0.5
});

function bufferFromBase64(base64: string): Buffer {
	return Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
}

/**
 * Center-crop and convert to grayscale for consistent face detection
 * Matches client-side preprocessing for accuracy
 */
function preprocessImage(img: any): any {
	const canvas = createCanvas(TARGET_WIDTH, TARGET_HEIGHT);
	const ctx = canvas.getContext('2d');
	
	const srcWidth = img.width || img.naturalWidth || TARGET_WIDTH;
	const srcHeight = img.height || img.naturalHeight || TARGET_HEIGHT;
	const srcAspect = srcWidth / srcHeight;
	
	// Calculate center crop dimensions
	let cropWidth: number;
	let cropHeight: number;
	let cropX: number;
	let cropY: number;
	
	if (srcAspect > TARGET_ASPECT) {
		// Source is wider - crop sides
		cropHeight = srcHeight;
		cropWidth = srcHeight * TARGET_ASPECT;
		cropX = (srcWidth - cropWidth) / 2;
		cropY = 0;
	} else {
		// Source is taller - crop top/bottom
		cropWidth = srcWidth;
		cropHeight = srcWidth / TARGET_ASPECT;
		cropX = 0;
		cropY = (srcHeight - cropHeight) / 2;
	}
	
	// Draw center-cropped and scaled image
	ctx.drawImage(
		img,
		cropX, cropY, cropWidth, cropHeight,
		0, 0, TARGET_WIDTH, TARGET_HEIGHT
	);
	
	// Apply grayscale for consistent face detection
	const imageData = ctx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
	const data = imageData.data;
	for (let i = 0; i < data.length; i += 4) {
		const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
		data[i] = gray;     // R
		data[i + 1] = gray; // G
		data[i + 2] = gray; // B
		// Alpha stays the same
	}
	ctx.putImageData(imageData, 0, 0);
	
	return canvas;
}

async function imageFromBase64(base64: string, preprocess: boolean = true): Promise<any> {
	try {
		// Ensure proper data URI - assume JPEG since client sends JPEG
		const dataUri = base64.startsWith('data:image') ? base64 : `data:image/jpeg;base64,${base64}`;
		console.log('🔄 Loading image from data URI, length:', dataUri.length);
		const img = await loadImage(dataUri);
		console.log(`✅ Image loaded: ${img.width}x${img.height}`);
		
		// Apply preprocessing if requested
		if (preprocess) {
			console.log('🔄 Applying center-crop and grayscale preprocessing...');
			return preprocessImage(img);
		}
		
		return img;
	} catch (error) {
		console.error('❌ Error creating image from base64:', error);
		throw new Error('Unsupported image type');
	}
}

const mtcnnOptions = new faceapi.MtcnnOptions({
	minFaceSize: 50,
	scaleFactor: 0.709
});

/**
 * 🚀 Preload all student descriptors into memory cache
 */
async function preloadDescriptorCache(): Promise<void> {
	if (isLoadingDescriptorCache) return;
	isLoadingDescriptorCache = true;
	
	const startTime = Date.now();
	try {
		const descFiles = fs.readdirSync(DESC_DIR).filter(f => f.endsWith('.json'));
		const newCache = new Map<string, { descriptors: Float32Array[], name: string }>();
		
		for (const descFile of descFiles) {
			const studentId = descFile.replace('.json', '');
			const filePath = path.join(DESC_DIR, descFile);
			const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			const descriptors = Array.isArray(data) ? data : data.descriptors;
			
			if (Array.isArray(descriptors)) {
				// Pre-convert to Float32Arrays for faster euclidean distance
				const optimizedDescriptors = descriptors.map(desc => {
					const arr = Array.isArray(desc) ? desc : Object.values(desc);
					return new Float32Array(arr as number[]);
				});
				
				newCache.set(studentId, {
					descriptors: optimizedDescriptors,
					name: data.name || studentId
				});
			}
		}
		
		descriptorCache = newCache;
		descriptorCacheLoadedAt = Date.now();
		console.log(`🚀 Descriptor cache loaded: ${newCache.size} students in ${Date.now() - startTime}ms`);
	} catch (error) {
		console.error('⚠️ Failed to preload descriptor cache:', error);
	} finally {
		isLoadingDescriptorCache = false;
	}
}

/**
 * Get cached descriptors, reloading if stale or empty
 */
async function getCachedDescriptors(): Promise<Map<string, { descriptors: Float32Array[], name: string }>> {
	const now = Date.now();
	if (descriptorCache.size === 0 || (now - descriptorCacheLoadedAt) > DESCRIPTOR_CACHE_TTL) {
		await preloadDescriptorCache();
	}
	return descriptorCache;
}

/**
 * Update cache after registration
 */
function updateStudentInCache(studentId: string, descriptors: number[][], name: string): void {
	const optimizedDescriptors = descriptors.map(desc => new Float32Array(desc));
	descriptorCache.set(studentId, { descriptors: optimizedDescriptors, name });
	console.log(`🔄 Cache updated for student: ${studentId}`);
}

export async function handleCheckOrientation(request: Request): Promise<Response> {
	await ensureModelsLoaded();
	try {
		const { image } = await request.json();
		if (!image) {
			return new Response(JSON.stringify({ orientation: 'none' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Use preprocessed image (center-crop + grayscale)
		const img = await imageFromBase64(image, true);
		const detection = await faceapi
			.detectSingleFace(img, mtcnnOptions)
			.withFaceLandmarks()
			.withFaceDescriptor();

		if (!detection) {
			return new Response(JSON.stringify({ orientation: 'none' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const { landmarks } = detection;
		const nose = landmarks.getNose()[3];
		const leftEye = landmarks.getLeftEye()[0];
		const rightEye = landmarks.getRightEye()[3];

		const eyeDiff = rightEye.x - leftEye.x;
		const noseOffset = nose.x - (leftEye.x + eyeDiff / 2);

		let orientation = 'front';
		if (noseOffset > 15) orientation = 'left';
		if (noseOffset < -15) orientation = 'right';

		return new Response(JSON.stringify({ orientation }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('Orientation detection error:', err);
		return new Response(JSON.stringify({ orientation: 'none' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

export async function handleRegister(request: Request): Promise<Response> {
	await ensureModelsLoaded();
	try {
		const { id, name, email, images } = await request.json();

		console.log('📥 Registration request received:', {
			id,
			name,
			email,
			hasImages: !!images,
			imageKeys: images ? Object.keys(images) : []
		});

		if (!id || !name || !email || !images) {
			return new Response(JSON.stringify({ message: '❌ Missing required fields' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Check if already registered
		const descFile = path.join(DESC_DIR, `${id}.json`);
		if (fs.existsSync(descFile)) {
			return new Response(JSON.stringify({ message: '❌ Student already registered for face recognition' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const descriptors: number[][] = [];

		for (let i = 1; i <= 3; i++) {
			const imageKey = `pic${i}`;
			if (!images[imageKey]) {
				console.warn(`⚠️ Image ${i} not provided, skipping`);
				continue;
			}

			console.log(`🔍 Processing image ${i}, size: ${images[imageKey].length} chars`);
			// Use preprocessed image (center-crop + grayscale) for consistent detection
			const img = await imageFromBase64(images[imageKey], true);
			console.log(`✅ Image ${i} preprocessed: ${TARGET_WIDTH}x${TARGET_HEIGHT}`);
			
			const detection = await faceapi
				.detectSingleFace(img, mtcnnOptions)
				.withFaceLandmarks()
				.withFaceDescriptor();

			if (!detection) {
				console.warn(`⚠️ No face detected in image ${i}, skipping`);
				continue;
			}

			console.log(`✅ Face detected in image ${i}`);
			descriptors.push(Array.from(detection.descriptor));
			const imageBuffer = bufferFromBase64(images[imageKey]);
			fs.writeFileSync(path.join(FACE_DIR, `${id}_pic${i}.png`), imageBuffer);
		}

		if (descriptors.length === 0) {
			return new Response(JSON.stringify({ message: '❌ No faces detected in any image' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Save descriptors with student info
		const descriptorData = {
			studentId: id,
			name: name,
			descriptors: descriptors,
			registeredAt: new Date().toISOString()
		};
		fs.writeFileSync(descFile, JSON.stringify(descriptorData, null, 2));
		
		// 🚀 Update in-memory cache
		updateStudentInCache(id, descriptors, name);

		// Also save to students table
		try {
			const connection = await getConnection();
			const qrCodeData = `QR-${id}-${Date.now()}`;
			
			// For now, store face descriptor as JSON (should be encrypted in production)
			const faceDescriptorJson = JSON.stringify(descriptors[0]); // Store first descriptor
			
			await connection.execute(`
				INSERT INTO students (
					id, name, email, phone, program, year, 
					face_descriptor, face_descriptor_iv,
					qr_code_data, consent_given, consent_date
				) VALUES (?, ?, ?, NULL, NULL, NULL, ?, '', ?, 1, NOW())
			`, [
				id,
				name,
				email,
				faceDescriptorJson,
				qrCodeData
			]);
			
			console.log(`✅ Student ${id} saved to database`);
		} catch (dbError) {
			console.error('❌ Failed to save to database:', dbError);
			// If this is a duplicate key error, throw it so the user knows
			if (dbError && typeof dbError === 'object' && 'code' in dbError && dbError.code === 'ER_DUP_ENTRY') {
				const errorMsg = (dbError as any).sqlMessage || '';
				if (errorMsg.includes("for key 'PRIMARY'") || errorMsg.includes(`'${id}'`)) {
					throw new Error(`Student ID ${id} already exists in database. Please use a unique ID.`);
				}
				throw new Error(`Duplicate entry detected. This student may already be registered.`);
			}
			console.warn('⚠️ Database error, but face registration successful:', dbError);
		}

		console.log(`✅ Student ${id} registered successfully with ${descriptors.length} face descriptors`);

		return new Response(JSON.stringify({ message: '✅ Registration successful!' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('Registration error:', err);
		return new Response(JSON.stringify({ message: '❌ Registration failed: ' + String(err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

export async function handleRecognize(request: Request): Promise<Response> {
	const requestStartTime = Date.now();
	await ensureModelsLoaded();
	
	try {
		const timestamp = new Date().toLocaleTimeString();
		console.log(`\n🔍 [${timestamp}] Recognition request received`);
		
		const { image } = await request.json();

		if (!image) {
			return new Response(JSON.stringify({ message: '❌ No image provided' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Image decode
		const imgDecodeStart = Date.now();
		const img = await imageFromBase64(image, true);
		console.log(`⏱️ Image decode + preprocess: ${Date.now() - imgDecodeStart}ms`);

		// 🚀 TURBO: Use TinyFaceDetector for FAST login detection (5-10x faster than MTCNN)
		const detectionStart = Date.now();
		const detection = await faceapi
			.detectSingleFace(img, tinyFaceOptions)
			.withFaceLandmarks()
			.withFaceDescriptor();
		console.log(`⏱️ TURBO Face detection: ${Date.now() - detectionStart}ms`);

		if (!detection) {
			console.log(`⚠️ [${timestamp}] No face detected in image`);
			return new Response(JSON.stringify({ message: '❌ No face detected' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		console.log(`✅ Face detected with confidence ${detection.detection.score.toFixed(3)}`);
		const queryDescriptor = detection.descriptor;

		// ============================================================================
		// 🔥 TURBO MATCHING (from final_attendance)
		// ============================================================================
		
		/**
		 * 🔥 Quick reject using first 8 dimensions only
		 * If partial distance already exceeds bestSoFar, reject immediately
		 */
		function quickReject(a: Float32Array, b: Float32Array, bestSoFar: number): boolean {
			let s = 0;
			for (let i = 0; i < 8; i++) {
				const d = a[i] - b[i];
				s += d * d;
				if (s > bestSoFar) return true;
			}
			return false;
		}

		/**
		 * 🔥 Full distance with early exit
		 */
		function fastDistanceEarly(a: Float32Array, b: Float32Array, threshold: number): number {
			let sum = 0;
			for (let i = 0; i < a.length; i++) {
				const d = a[i] - b[i];
				sum += d * d;
				if (sum > threshold) return Infinity;
			}
			return sum;
		}

		let bestMatch: string | null = null;
		let bestDistance = Infinity;
		let bestName = '';

		// 🚀 Use cached descriptors + fast distance functions
		const matchingStart = Date.now();
		const cachedDescriptors = await getCachedDescriptors();
		
		// Convert query to Float32Array for fast comparison
		const queryFloat32 = new Float32Array(queryDescriptor);

		for (const [studentId, studentData] of cachedDescriptors) {
			let studentMin = Infinity;
			
			for (const desc of studentData.descriptors) {
				// 🔥 Quick reject using first 8 dimensions
				if (quickReject(queryFloat32, desc, studentMin)) continue;
				
				// 🔥 Full distance with early exit
				const dist = fastDistanceEarly(queryFloat32, desc, studentMin);
				
				if (dist < studentMin) {
					studentMin = dist;
					if (dist < bestDistance) {
						bestDistance = dist;
						bestMatch = studentId;
						bestName = studentData.name;
					}
				}
			}
		}
		
		console.log(`⚡ TURBO matching (${cachedDescriptors.size} students): ${Date.now() - matchingStart}ms`);

		// Convert squared distance to regular distance for threshold comparison
		const actualDistance = Math.sqrt(bestDistance);
		
		const timestamp2 = new Date().toLocaleTimeString();
		if (bestMatch && actualDistance < 0.6) {
			// Get student name from cache or database
			let studentName = bestName || bestMatch;
			if (!studentName || studentName === bestMatch) {
				try {
					const connection = await getConnection();
					const [rows] = await connection.execute('SELECT name FROM students WHERE id = ?', [bestMatch]);
					const students = rows as any[];
					if (students && students.length > 0) {
						studentName = students[0].name;
					}
				} catch (nameError) {
					console.error('Error fetching student name:', nameError);
				}
			}

			console.log(`✅ [${timestamp2}] MATCH FOUND: ${studentName} (ID: ${bestMatch})`);
			console.log(`   Distance: ${actualDistance.toFixed(3)}, Confidence: ${((1 - actualDistance) * 100).toFixed(1)}%`);
			console.log(`⏱️ Total request time: ${Date.now() - requestStartTime}ms`);

			return new Response(JSON.stringify({
				message: `✅ Welcome back, ${studentName}!`,
				studentId: bestMatch,
				confidence: (1 - actualDistance).toFixed(2),
				distance: actualDistance.toFixed(3),
				imageUrl: `/face/${bestMatch}_pic1.png`,
				timing: Date.now() - requestStartTime
			}), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		} else {
			console.log(`❌ [${timestamp2}] NO MATCH - Best distance: ${actualDistance.toFixed(3)} (threshold: 0.6)`);
			console.log(`⏱️ Total request time: ${Date.now() - requestStartTime}ms`);
			
			return new Response(JSON.stringify({
				message: '🚫 Face not recognized',
				bestDistance: actualDistance.toFixed(3),
				timing: Date.now() - requestStartTime
			}), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	} catch (err) {
		console.error('Recognition error:', err);
		return new Response(JSON.stringify({ message: '❌ Recognition failed: ' + String(err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}
