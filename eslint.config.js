import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(?:^|/)gameplay/(?!index(?:\.ts)?$)',
              message: 'UI 只能从 Gameplay 公共入口导入能力与只读类型。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/gameplay/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react/*',
                'react-dom',
                'react-dom/*',
                'react-router',
                'react-router/*',
                '**/ui/**',
              ],
              message: 'Gameplay 不依赖 UI、React 或路由。',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'location', 'navigator'],
    },
  },
])
