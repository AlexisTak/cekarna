import { defineConfig } from 'vite'

// Rust écrit des DLL verrouillées dans ce répertoire pendant `tauri dev`.
// Elles ne font pas partie du frontend et Vite ne doit donc pas les surveiller.
export default defineConfig({
  server: {
    watch: {
      ignored: ['**/src-tauri/target/**'],
    },
  },
})
