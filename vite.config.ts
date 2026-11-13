import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const rootDir = fileURLToPath(new URL('.', import.meta.url));
  const backendEnvDir = fileURLToPath(new URL('./backend', import.meta.url));
  const env = loadEnv(mode, rootDir, '');
  const backendEnv = loadEnv(mode, backendEnvDir, 'VITE_');
  const publicSupabaseUrl = env.VITE_SUPABASE_URL || backendEnv.VITE_SUPABASE_URL || '';
  const publicSupabaseKey = env.VITE_SUPABASE_ANON_KEY || backendEnv.VITE_SUPABASE_ANON_KEY || '';
  const devPort = Number(env.VITE_PORT || 5173);

  return {
    envDir: rootDir,
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(publicSupabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(publicSupabaseKey),
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
    server: {
      host: true,
      strictPort: true,
      port: devPort,
      hmr: { host: 'localhost', clientPort: devPort },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      proxy: {
        '/api': {
          target: env.DGUY_API_TARGET || 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
  };
});
