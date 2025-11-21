// Test face detection with different image qualities
import fs from 'fs';
import path from 'path';
import * as faceapi from 'face-api.js';
import * as canvasPkg from 'canvas';

const { Canvas, Image, ImageData, loadImage } = canvasPkg;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const PROJECT_ROOT = process.cwd();
const MODEL_PATH = path.join(PROJECT_ROOT, 'static', 'models');

console.log('Loading models...');
await Promise.all([
	faceapi.nets.mtcnn.loadFromDisk(MODEL_PATH),
	faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH),
	faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH),
]);
console.log('✅ Models loaded\n');

// Test with different minFaceSize values
const testSizes = [50, 100, 150];

console.log('Testing different MTCNN minFaceSize settings:\n');

for (const minSize of testSizes) {
	const options = new faceapi.MtcnnOptions({
		minFaceSize: minSize,
		scaleFactor: 0.709
	});
	
	console.log(`\n🔍 Testing with minFaceSize: ${minSize}`);
	console.log('='  .repeat(50));
	
	// Create a test image (blank canvas with text)
	const canvas = new Canvas(640, 480);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = 'white';
	ctx.fillRect(0, 0, 640, 480);
	ctx.fillStyle = 'black';
	ctx.font = '30px Arial';
	ctx.fillText(`Test Image (minFaceSize: ${minSize})`, 50, 240);
	
	const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
	
	try {
		const img = await loadImage(dataUrl);
		const detection = await faceapi
			.detectSingleFace(img, options)
			.withFaceLandmarks()
			.withFaceDescriptor();
		
		if (detection) {
			console.log(`✅ Face detected!`);
			console.log(`   Detection box:`, detection.detection.box);
		} else {
			console.log(`❌ No face detected`);
		}
	} catch (err) {
		console.log(`❌ Error: ${err.message}`);
	}
}

console.log('\n\nℹ️  NOTE: This test uses blank images.');
console.log('For real face detection, use actual photos with faces.');
console.log('Recommended settings:');
console.log('  - minFaceSize: 50-80 for medium distance faces');
console.log('  - JPEG quality: 0.90-0.95 for good quality');
