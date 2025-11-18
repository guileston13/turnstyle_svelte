// Test script for face recognition API
async function testFaceRecognition() {
    console.log('🧪 Testing face recognition API...');

    try {
        const response = await fetch('http://localhost:5174/api/face/recognize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
            })
        });

        const result = await response.json();
        console.log('Response status:', response.status);
        console.log('Response:', result);

        if (response.status === 200 && result.message === '❌ No face detected') {
            console.log('✅ Test PASSED: API can load images and detect no face in minimal image');
        } else if (response.status === 500 && result.message.includes('Unsupported image type')) {
            console.log('❌ Test FAILED: Still getting "Unsupported image type" error');
        } else {
            console.log('⚠️ Test UNCLEAR: Unexpected response');
        }

    } catch (error) {
        console.error('❌ Test ERROR:', error);
    }
}

testFaceRecognition().catch(console.error);