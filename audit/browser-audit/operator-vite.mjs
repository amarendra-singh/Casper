import original from '../../frontend/vite.config.js'
export default {
  ...original,
  root: new URL('../../frontend/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
  server: { ...original.server, host: '127.0.0.1', port: 5174, strictPort: true,
    proxy: { ...original.server.proxy, '/api': {target:'http://127.0.0.1:8766', changeOrigin:true} } }
}
