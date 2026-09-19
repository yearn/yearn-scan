import { defineConfig } from 'vite';
import vinext from 'vinext';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vinext(), tailwindcss(), cloudflare({
    configPath: process.env.WRANGLER_CONFIG || 'wrangler.jsonc',
    viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
  })],
  server: { host: '127.0.0.1', port: 3000, strictPort: true },
});
