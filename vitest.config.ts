import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC instead of esbuild: Nest DI needs emitDecoratorMetadata, which esbuild does not support.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          setupFiles: ['reflect-metadata'],
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          globalSetup: ['test/setup/global-setup.ts'],
          setupFiles: ['reflect-metadata', 'test/setup/e2e-env.ts'],
          hookTimeout: 120_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
