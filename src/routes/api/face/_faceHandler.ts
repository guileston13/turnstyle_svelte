import fs from 'fs';
import path from 'path';
import * as faceapi from 'face-api.js';
import * as canvasPkg from 'canvas';
import { getConnection } from '$lib/services/mariadb';

const { Canvas, Image, ImageData, loadImage } = canvasPkg;
// @ts-ignore
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const PROJECT_ROOT = path.resolve(process.cwd());
const FACE_DIR = path.join(PROJECT_ROOT, 'static', 'face');
const DESC_DIR = path.join(PROJECT_ROOT, 'static', 'descriptors');
const MODEL_PATH = path.join(PROJECT_ROOT, 'static', 'models');

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

function imageFromBase64(base64: string): Promise<any> {
	try {
		// Ensure proper data URI - assume JPEG since client sends JPEG
		const dataUri = base64.startsWith('data:image') ? base64 : `data:image/jpeg;base64,${base64}`;
		console.log('🔄 Loading image from data URI, length:', dataUri.length);
		const result = loadImage(dataUri);
		console.log('✅ Image load promise created');
		return result;
	} catch (error) {
		console.error('❌ Error creating image from base64:', error);
		throw new Error('Unsupported image type');
	}
}

const mtcnnOptions = new faceapi.MtcnnOptions({
	minFaceSize: 100,
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

		const img = await imageFromBase64(image);
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

			const img = await imageFromBase64(images[imageKey]);
			const detection = await faceapi
				.detectSingleFace(img, mtcnnOptions)
				.withFaceLandmarks()
				.withFaceDescriptor();

			if (!detection) {
				console.warn(`⚠️ No face detected in image ${i}, skipping`);
				continue;
			}

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
		const { image } = await request.json();

		if (!image) {
			return new Response(JSON.stringify({ message: '❌ No image provided' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		console.log('🔍 Processing recognition request, image length:', image.length);

		const img = await imageFromBase64(image);
		console.log('✅ Image loaded successfully, dimensions:', img.width, 'x', img.height);

		const detection = await faceapi
			.detectSingleFace(img, mtcnnOptions)
			.withFaceLandmarks()
			.withFaceDescriptor();

		if (!detection) {
			console.log('❌ No face detected in image');
			return new Response(JSON.stringify({ message: '❌ No face detected' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		console.log('✅ Face detected, computing descriptor...');
		const queryDescriptor = detection.descriptor;
		let bestMatch: string | null = null;
		let bestDistance = Infinity;

		// Check all registered students
		const descFiles = fs.readdirSync(DESC_DIR).filter(f => f.endsWith('.json'));

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
