import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Vite 开发服务器和生产构建配置。 */
export default defineConfig({
  /** 启用 React 插件以支持 JSX 与 Fast Refresh。 */
  plugins: [react()],
})
