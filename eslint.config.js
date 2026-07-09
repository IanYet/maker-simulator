import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/** ESLint 扁平配置，覆盖 TypeScript、React Hooks 与 Vite React Refresh 规则。 */
export default defineConfig([
  /** 忽略生产构建输出目录。 */
  globalIgnores(['dist']),
  {
    /** 仅对 TypeScript 源码启用该规则组。 */
    files: ['**/*.{ts,tsx}'],
    /** 合并官方推荐规则和 React/Vite 相关规则。 */
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    /** 声明浏览器运行时全局变量。 */
    languageOptions: {
      globals: globals.browser,
    },
  },
])
