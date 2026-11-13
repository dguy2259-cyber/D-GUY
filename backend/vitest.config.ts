import { defineConfig } from 'vitest/config';

export default defineConfig({ configFile: false, root: process.cwd(), test: { environment: 'node', include: ['src/**/*.test.ts'] } });
