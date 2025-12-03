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

export async function ensureModelsLoaded(): Promise<void> {
	if (!modelsLoaded) {
		await Promise.all([
			faceapi.nets.mtcnn.loadFromDisk(MODEL_PATH),
			faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH),
			faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH),
		]);
		console.log("✅ MTCNN + Landmarks + Recognition models loaded");
		modelsLoaded = true;
	}
}

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
		const { id, name, images } = await request.json();

		console.log('📥 Registration request received:', {
			id,
			name,
			hasImages: !!images,
			imageKeys: images ? Object.keys(images) : []
		});

		if (!id || !name || !images) {
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
				) VALUES (?, ?, '', '', '', NULL, ?, '', ?, 1, NOW())
				ON DUPLICATE KEY UPDATE
					name = VALUES(name),
					face_descriptor = VALUES(face_descriptor),
					qr_code_data = VALUES(qr_code_data),
					consent_given = VALUES(consent_given),
					consent_date = VALUES(consent_date),
					updated_at = NOW()
			`, [
				id,
				name,
				faceDescriptorJson,
				qrCodeData
			]);
			
			console.log(`✅ Student ${id} saved to database`);
		} catch (dbError) {
			console.warn('⚠️ Failed to save to database, but face registration successful:', dbError);
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

		console.log(`📸 [${timestamp}] Processing image, length: ${image.length} chars`);

		// Use preprocessed image (center-crop + grayscale) for consistent recognition
		const img = await imageFromBase64(image, true);
		console.log(`✅ [${timestamp}] Image preprocessed: ${TARGET_WIDTH}x${TARGET_HEIGHT}`);

		const detection = await faceapi
			.detectSingleFace(img, mtcnnOptions)
			.withFaceLandmarks()
			.withFaceDescriptor();

		if (!detection) {
			console.log(`⚠️ [${timestamp}] No face detected in image`);
			return new Response(JSON.stringify({ message: '❌ No face detected' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		console.log(`✅ [${timestamp}] Face detected, comparing with database...`);
		const queryDescriptor = detection.descriptor;
		let bestMatch: string | null = null;
		let bestDistance = Infinity;

		// Check all registered students
		const descFiles = fs.readdirSync(DESC_DIR).filter(f => f.endsWith('.json'));
		console.log(`📚 [${timestamp}] Checking against ${descFiles.length} registered students`);

		for (const descFile of descFiles) {
			const studentId = descFile.replace('.json', '');
			const data = JSON.parse(fs.readFileSync(path.join(DESC_DIR, descFile), 'utf8'));
			const descriptors = Array.isArray(data) ? data : data.descriptors;

			if (!Array.isArray(descriptors)) continue;

			for (const desc of descriptors) {
				const descriptorArray = Array.isArray(desc) ? desc : Object.values(desc);
				const distance = faceapi.euclideanDistance(queryDescriptor, descriptorArray as number[]);
				if (distance < bestDistance) {
					bestDistance = distance;
					bestMatch = studentId;
				}
			}
		}

		const timestamp2 = new Date().toLocaleTimeString();
		if (bestMatch && bestDistance < 0.6) {
			// Get student name from students table
			let studentName = bestMatch;
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

			console.log(`✅ [${timestamp2}] MATCH FOUND: ${studentName} (ID: ${bestMatch})`);
			console.log(`   Distance: ${bestDistance.toFixed(3)}, Confidence: ${((1 - bestDistance) * 100).toFixed(1)}%`);

			return new Response(JSON.stringify({
				message: `✅ Welcome back, ${studentName}!`,
				studentId: bestMatch,
				confidence: (1 - bestDistance).toFixed(2),
				distance: bestDistance.toFixed(3),
				imageUrl: `/face/${bestMatch}_pic1.png`
			}), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		} else {
			console.log(`❌ [${timestamp2}] NO MATCH - Best distance: ${bestDistance.toFixed(3)} (threshold: 0.6)`);
			return new Response(JSON.stringify({
				message: '🚫 Face not recognized',
				bestDistance: bestDistance.toFixed(3)
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
