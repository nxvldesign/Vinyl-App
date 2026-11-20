import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Jamendo's audio servers don't send CORS headers, and the Web Audio graph
// (the 3D panner, reverb and visualiser) needs them. So audio goes through
// our own origin: this proxy in dev, and the matching rewrite in vercel.json
// when deployed.
const jamendo = {
  target: 'https://prod-1.storage.jamendo.com',
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/stream\/jamendo/, ''),
};

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/stream/jamendo': jamendo } },
  preview: { proxy: { '/stream/jamendo': jamendo } },
  // three.js alone is most of the bundle; it's one download, cached after.
  build: { chunkSizeWarningLimit: 1600 },
});
