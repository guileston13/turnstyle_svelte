// Web Crypto API for AES-256-GCM Encryption
export async function generateKey(): Promise<CryptoKey> {
	return await crypto.subtle.generateKey(
		{
			name: 'AES-GCM',
			length: 256
		},
		true,
		['encrypt', 'decrypt']
	);
}

export async function encryptData(data: string, key: CryptoKey): Promise<{ encrypted: string; iv: string }> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoder = new TextEncoder();
	const encoded = encoder.encode(data);

	const encrypted = await crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv: iv
		},
		key,
		encoded
	);

	return {
		encrypted: arrayBufferToBase64(encrypted),
		iv: arrayBufferToBase64(iv.buffer)
	};
}

export async function decryptData(encryptedData: string, iv: string, key: CryptoKey): Promise<string> {
	const encrypted = base64ToArrayBuffer(encryptedData);
	const ivArray = base64ToArrayBuffer(iv);

	const decrypted = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: ivArray
		},
		key,
		encrypted
	);

	const decoder = new TextDecoder();
	return decoder.decode(decrypted);
}

export async function exportKey(key: CryptoKey): Promise<string> {
	const exported = await crypto.subtle.exportKey('raw', key);
	return arrayBufferToBase64(exported);
}

export async function importKey(keyData: string): Promise<CryptoKey> {
	const keyBuffer = base64ToArrayBuffer(keyData);
	return await crypto.subtle.importKey(
		'raw',
		keyBuffer,
		{
			name: 'AES-GCM',
			length: 256
		},
		true,
		['encrypt', 'decrypt']
	);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

export function generateHash(data: string): Promise<string> {
	const encoder = new TextEncoder();
	const dataBuffer = encoder.encode(data);
	return crypto.subtle.digest('SHA-256', dataBuffer).then((hash) => arrayBufferToBase64(hash));
}
