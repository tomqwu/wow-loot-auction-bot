import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry points only wire modules together and talk to the live
      // Discord gateway; everything they call is covered by tests.
      // types.ts files contain no executable code.
      exclude: ['src/bot.ts', 'src/deploy-commands.ts', 'src/**/types.ts'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        lines: 99,
        statements: 99,
        functions: 99,
        branches: 96,
      },
    },
  },
});
