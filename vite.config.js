import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths let the built site be served from any sub-path.
  base: './',
  server: { host: true, port: 5173, allowedHosts: true },
  preview: { host: true, port: 5173, allowedHosts: true },
});
