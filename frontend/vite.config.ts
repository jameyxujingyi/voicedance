import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true, // 允许通过 ngrok 等外网域名访问（手机打开链接用）
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        timeout: 600000, // 与前端 analyze 超时一致，长视频在弱 CPU 上可能数分钟
      },
    },
  },
})
