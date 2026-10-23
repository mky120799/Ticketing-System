import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Libraries go into their own files ("vendor chunks"). They change far less often than our code, so after a
 * release browsers keep them cached and only download the small app chunk again.
 */
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('@mantine/charts') || id.includes('recharts') || id.includes('d3-')) return undefined; // only the dashboard needs charts: keep them in its lazy chunk
  if (id.includes('@mantine')) return 'mantine';
  if (id.includes('@tabler')) return 'icons';
  if (id.includes('@tanstack')) return 'tanstack';
  if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react';
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { rollupOptions: { output: { manualChunks: vendorChunk } } }
});
