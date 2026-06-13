import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../public/react-app'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sounds: path.resolve(__dirname, 'src/entries/sounds.entry.jsx'),
        dev: path.resolve(__dirname, 'src/entries/dev.entry.jsx'),
        rank: path.resolve(__dirname, 'src/entries/rank.entry.jsx'),
        rank_admin: path.resolve(__dirname, 'src/entries/rank_admin.entry.jsx'),
        vo: path.resolve(__dirname, 'src/entries/vo.entry.jsx'),
        vo_admin: path.resolve(__dirname, 'src/entries/vo_admin.entry.jsx'),
        interviews: path.resolve(__dirname, 'src/entries/interviews.entry.jsx'),
        interviews_admin: path.resolve(__dirname, 'src/entries/interviews_admin.entry.jsx'),
        matchlist: path.resolve(__dirname, 'src/entries/matchlist.entry.jsx'),
        match_detail: path.resolve(__dirname, 'src/entries/match_detail.entry.jsx'),
        players: path.resolve(__dirname, 'src/entries/players.entry.jsx'),
        player_detail: path.resolve(__dirname, 'src/entries/player_detail.entry.jsx'),
        heroes: path.resolve(__dirname, 'src/entries/heroes.entry.jsx'),
        hero_detail: path.resolve(__dirname, 'src/entries/hero_detail.entry.jsx'),
        stats: path.resolve(__dirname, 'src/entries/stats.entry.jsx'),
        items: path.resolve(__dirname, 'src/entries/items.entry.jsx'),
        match_admin: path.resolve(__dirname, 'src/entries/match_admin.entry.jsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    proxy: {
      '/db': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
      },
      '/sounds': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
      },
      '/rank': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
      },
      '/dlns': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
      },
      '/admin': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
      },
      '/interviews': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
      },
    },
  },
});

