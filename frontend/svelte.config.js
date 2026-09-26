import adapter from '@sveltejs/adapter-vercel';
import { relative, sep } from 'node:path';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => {
			const relativePath = relative(import.meta.dirname, filename);
			const pathSegments = relativePath.toLowerCase().split(sep);
			const isExternalLibrary = pathSegments.includes('node_modules');

			return isExternalLibrary ? undefined : true;
		}
	},
	kit: {
		adapter: adapter({
			// Optional: choose the runtime. 'nodejs20.x' is a safe default.
			// Use 'edge' if you need lower cold starts and don't rely on Node APIs.
			runtime: 'nodejs20.x'
		}),

		version: {
			name: process.env.BUILD_ID || String(Date.now()),
			pollInterval: 60_000
		}
	}
};

export default config;
