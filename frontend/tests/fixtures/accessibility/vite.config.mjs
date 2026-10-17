import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../../node_modules/.vite/accessibility-fixture', import.meta.url)),
  plugins: [svelte({ configFile: false })],
  resolve: { alias: { $lib: fileURLToPath(new URL('../../../src/lib', import.meta.url)) }, dedupe: ['svelte'] },
  server: { fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] } }
};
