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

/**
 * @webgpu/glslang's web-devel/glslang.js ends with a zero-argument default
 * export that hardcodes `locateFile` to `<import.meta.url dir>/glslang.wasm`
 * and discards any options we pass (wasmBinary, locateFile, instantiateWasm).
 * After bundling that resolves to /assets/glslang.wasm, which does not exist,
 * so the SPA fallback serves index.html (bytes 3c 21 64 6f = "<!do").
 *
 * Strip the CJS/UMD tail and the hardcoded wrapper and export the raw
 * Emscripten factory instead, so the caller controls wasm loading.
 */
function patchGlslangLoader(): Plugin {
  return {
    name: 'physicscraft-glslang-loader-patch',
    enforce: 'pre',
    transform(code, id) {
      const clean = id.split('?')[0].replace(/\\/g, '/');
      if (!clean.endsWith('/@webgpu/glslang/dist/web-devel/glslang.js')) return null;
      const marker = "if (typeof exports === 'object' && typeof module === 'object')";
      const i = code.indexOf(marker);
      if (i < 0) throw new Error('glslang loader layout changed; patch needs updating');
      return { code: code.slice(0, i) + '\nexport default Module;\n', map: null };
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      patchGlslangLoader(),
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
    optimizeDeps: {
      // Keep the dev server on the patched loader (esbuild pre-bundling would bypass the transform).
      exclude: ['@webgpu/glslang'],
    },
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
