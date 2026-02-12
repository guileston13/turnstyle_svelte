import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Custom SSL configuration with mkcert certificates
const httpsConfig = {
	key: readFileSync(resolve('key.pem')),
	cert: readFileSync(resolve('cert.pem'))
};

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		host: '0.0.0.0', // Allow network access
		port: 5173,
		https: httpsConfig
	}
});
