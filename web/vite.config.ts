import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// One self-contained index.html, so the Mac app can serve it from its bundle.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  server: { port: 5199, strictPort: true },
})
