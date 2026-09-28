import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/addon.tsx', formats: ['es'], fileName: () => 'addon.js' },
    outDir: 'dist',
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', '@wealthfolio/addon-sdk']
    }
  }
});
