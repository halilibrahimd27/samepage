import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'tests/unit/**/*.test.{ts,tsx}',
            'tests/property/**/*.test.ts',
            'src/**/*.test.{ts,tsx}',
          ],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'golden',
          include: ['tests/golden/**/*.golden.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'bench',
          include: ['tests/bench/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
