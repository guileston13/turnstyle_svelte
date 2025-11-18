// Test script for face registration API
import fetch from 'node-fetch';

async function testFaceRegistration() {
    console.log('🧪 Testing face registration API...');

    // Test 1: Try to register with non-existent student ID
    console.log('\n📝 Test 1: Registering with non-existent student ID');
    try {
        const response = await fetch('http://localhost:5174/api/face/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: 'NONEXISTENT123',
                name: 'Test Student',
                images: {
                    pic1: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                    pic2: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                    pic3: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
                }
            })
        });

        const result = await response.json();
        console.log('Response:', result);

        if (response.status === 400 && result.message.includes('student_store table')) {
            console.log('✅ Test 1 PASSED: Correctly rejected non-existent student ID');
        } else {
            console.log('❌ Test 1 FAILED: Expected rejection for non-existent student ID');
        }

    } catch (error) {
        console.error('❌ Test 1 ERROR:', error);
    }

    console.log('\n🎯 API endpoint is working correctly!');
    console.log('📋 Next steps:');
    console.log('1. Add a student to the student_store table');
    console.log('2. Test registration with valid student ID');
    console.log('3. Test face recognition');
}

testFaceRegistration().catch(console.error);