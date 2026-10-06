import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import type { Plugin } from 'vite';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function emitGlslangWasm(): Plugin {
  return {
    name: 'physicscraft-glslang-wasm',
    generateBundle() {
      const wasmPath = path.resolve('node_modules/@webgpu/glslang/dist/web-devel/glslang.wasm');
      if (!fs.existsSync(wasmPath)) throw new Error('glslang WASM not found at ' + wasmPath);
      this.emitFile({ type: 'asset', fileName: 'glslang.wasm', source: fs.readFileSync(wasmPath) });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      emitGlslangWasm(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'icon.svg'],
        manifest: {
          id: '/',
          name: 'Rapier Block Physics Lab',
          short_name: 'BlockPhysics',
          description: 'Interactive 3D rigid-body block physics simulation powered by Rapier3D WebAssembly with Android touch & gyro tilt.',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/icon.svg',
              sizes: '192x192 512x512',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
    // `npm start` (used by hosts like Render's Web Service): serve the built `dist` folder.
    // allowedHosts: true lets it answer on any hostname (e.g. *.onrender.com).
    preview: {
      host: '0.0.0.0',
      port: Number(process.env.PORT) || 4173,
      allowedHosts: true as const,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
