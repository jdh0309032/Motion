import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import motionRender from './render/vite-plugin.js';

export default defineConfig({
  plugins: [react(), tailwindcss(), motionRender()],
  server: { port: 5173 },
});
