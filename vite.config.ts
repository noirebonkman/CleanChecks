import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_VERSION } from './src/version';
// 자동 해시 대신 역할과 버전으로 배포 파일을 구분합니다.
const release = APP_VERSION.replace(/[^a-zA-Z0-9.-]/g, '-');
const chunkNames: Record<string, string> = {
    'App': 'inspection',
    'FieldCalendar': 'calendar',
    'UserManagement': 'user-management',
    'AccountSettings': 'account-settings',
    'ReportExport': 'report-export',
    'index': 'pdf-export',
    'index.es': 'pdf-engine',
    'html2canvas.esm': 'html-to-canvas',
    'jszip.min': 'zip-archive',
    'purify.es': 'html-sanitizer',
    'xlsx': 'excel-reader',
    'workbox-window.prod.es5': 'offline-update',
};
export default defineConfig({ base: './', server: { fs: { deny: ['.env', '.env.*', '**/.env', '**/.env.*', '**/.dev.vars', '**/.dev.vars.*', '**/.git/**', '**/.wrangler/**', '**/private/**', '**/.server-build/**'] }, proxy: { '/api/calendar/events': { target: 'http://127.0.0.1:8787', changeOrigin: false, ws: true }, '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } }, build: {
        manifest: true,
        rollupOptions: {
            output: {
                entryFileNames: 'assets/application-v' + release + '.js',
                chunkFileNames: chunk => 'assets/' + (chunkNames[chunk.name] ?? chunk.name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()) + '-v' + release + '.js',
                assetFileNames: asset => {
                    const name = asset.names?.[0] ?? asset.name ?? 'asset';
                    if (!name.endsWith('.css')) return 'assets/[name]-v' + release + '[extname]';
                    const stem = name.slice(0,-4);
                    const role = stem === 'index' || stem === 'style' ? 'application'
                        : chunkNames[stem] ?? stem.replace(/([a-z0-9])([A-Z])/g,'$1-$2').replace(/[^a-zA-Z0-9-]/g,'-').toLowerCase();
                    return 'assets/' + role + '-v' + release + '.css';
                },
            },
        },
    }, plugins: [react(), VitePWA({ registerType: 'prompt', includeAssets: ['logo-black.svg', 'logo-white.svg', 'icon.svg', 'icon-192.png', 'icon-512.png', 'favicon-32.png', 'apple-touch-icon.png'], manifest: { name: 'FM 파트너스 현장 관리', short_name: 'FM 파트너스', description: 'FM 파트너스 현장점검 및 일정 관리', lang: 'ko', start_url: './', scope: './', display: 'standalone', theme_color: '#205ba6', background_color: '#ffffff', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] }, workbox: { inlineWorkboxRuntime: true, dontCacheBustURLsMatching: /^$/, globPatterns: ['**/*.{js,css,html,svg,png}'], navigateFallbackDenylist: [/site-directory\.enc\.json$/, /^\/api\//], maximumFileSizeToCacheInBytes: 6000000 } })] });
