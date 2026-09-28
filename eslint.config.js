import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/node_modules/**',
      '**/.turbo/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['examples/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-empty-object-type': ['error', { allowObjectTypes: 'always' }],
    },
  },
  {
    rules: {
      semi: ['error', 'never'],
    },
  },
)
