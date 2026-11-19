import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.wrangler/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'apps/web/**',
      'prototype/**',
      'specification/**',
      '.tessl/**',
      '.agents/**',
      '.claude/**',
      '.cloud-launch/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);
