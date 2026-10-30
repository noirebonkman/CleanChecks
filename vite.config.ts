import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_VERSION } from './src/version';
// 자동 해시 대신 역할과 버전으로 배포 파일을 구분합니다.
const release = APP_VERSION.replace(/[^a-zA-Z0-9.-]/g, '-');
const chunkNames: Record<string, string> = {
    'ReportExport': 'report-export',
    'index': 'pdf-export',
    'index.es': 'pdf-engine',
    'html2canvas.esm': 'html-to-canvas',
    'jszip.min': 'zip-archive',
    'purify.es': 'html-sanitizer',
    'xlsx': 'excel-reader',
    'workbox-window.prod.es5': 'offline-update',
};
export default defineConfig({ base: './', server: { fs: { deny: ['.env', '.env.*', '**/.env', '**/.env.*', '**/.dev.vars', '**/.dev.vars.*', '**/.git/**', '**/.wrangler/**', '**/private/**', '**/.server-build/**'] }, proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } }, build: {
        manifest: true,
        rollupOptions: {
            output: {
                entryFileNames: 'assets/application-v' + release + '.js',
                chunkFileNames: chunk => 'assets/' + (chunkNames[chunk.name] ?? chunk.name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()) + '-v' + release + '.js',
                assetFileNames: asset => {
                    const name = asset.names?.[0] ?? asset.name ?? 'asset';
                    return name.endsWith('.css') ? 'assets/application-v' + release + '.css' : 'assets/[name]-v' + release + '[extname]';
                },
            },
        },
    }, plugins: [react(), VitePWA({ registerType: 'prompt', includeAssets: ['logo-black.svg', 'logo-white.svg', 'icon.svg', 'icon-192.png', 'icon-512.png', 'favicon-32.png', 'apple-touch-icon.png'], manifest: { name: '루센트 현장점검', short_name: '현장점검', description: '기기에 저장하는 현장 관리 점검표', lang: 'ko', start_url: './', scope: './', display: 'standalone', theme_color: '#087880', background_color: '#ffffff', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] }, workbox: { inlineWorkboxRuntime: true, globPatterns: ['**/*.{js,css,html,svg,png}'], navigateFallbackDenylist: [/site-directory\.enc\.json$/], maximumFileSizeToCacheInBytes: 6000000 } })] });
