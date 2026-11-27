import base from '../../frontend/vite.config.js'
export default { ...base, server: { ...base.server, port: 5174, strictPort: true,
  proxy: { ...base.server.proxy, '/api': { target: 'http://127.0.0.1:8766', changeOrigin: true } } } }
