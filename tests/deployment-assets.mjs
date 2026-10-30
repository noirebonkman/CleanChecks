import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectBuildFiles, hashFile, securityHeaders, verifyStagedFiles } from '../tools/deployment-assets.mjs';

const testRoot = resolve('.test-work');
mkdirSync(testRoot, { recursive: true });
const root = mkdtempSync(resolve(testRoot, 'deployment-'));
const source = resolve(root, 'dist');
mkdirSync(resolve(source, '.vite'), { recursive: true });
mkdirSync(resolve(source, 'assets'));
mkdirSync(resolve(source, 'JSON'));
const html = '<script type="module" src="./assets/application.js"></script>';
writeFileSync(resolve(source, 'index.html'), html);
writeFileSync(resolve(source, 'sw.js'), '// service worker');
writeFileSync(resolve(source, 'manifest.webmanifest'), '{}');
writeFileSync(resolve(source, 'assets/application.js'), 'export default 1');
writeFileSync(resolve(source, 'assets/private-notes.txt'), 'must not deploy');
writeFileSync(resolve(source, 'JSON/site-directory.json'), '{"private":"address"}');
writeFileSync(resolve(source, '.vite/manifest.json'), JSON.stringify({ 'index.html': { file: 'assets/application.js' } }));
assert.deepEqual(collectBuildFiles(source), ['assets/application.js', 'index.html', 'manifest.webmanifest', 'sw.js']);
const destination = resolve(root, 'staged');
mkdirSync(resolve(destination, 'assets'), { recursive: true });
writeFileSync(resolve(destination, 'assets/application.js'), 'export default 1');
writeFileSync(resolve(destination, 'index.html'), html);
writeFileSync(resolve(destination, '_headers'), securityHeaders);
const inventory = {
    version: 'test',
    files: ['assets/application.js', 'index.html', '_headers'].map(path => ({
        path, sha256: hashFile(resolve(destination, path)),
    })),
};
verifyStagedFiles(destination, inventory, 'test');
assert.throws(() => verifyStagedFiles(destination, inventory, 'other'), /버전/);
writeFileSync(resolve(destination, 'index.html'), html + 'changed');
assert.throws(() => verifyStagedFiles(destination, inventory, 'test'), /변경/);
writeFileSync(resolve(destination, 'index.html'), html);
const missing = { ...inventory, files: inventory.files.filter(entry => entry.path !== 'index.html') };
assert.throws(() => verifyStagedFiles(destination, missing, 'test'), /예상하지 않은/);
writeFileSync(resolve(destination, 'index.html'), '<script>alert(1)</script>');
inventory.files.find(entry => entry.path === 'index.html').sha256 = hashFile(resolve(destination, 'index.html'));
assert.throws(() => verifyStagedFiles(destination, inventory, 'test'), /인라인/);
writeFileSync(resolve(destination, 'secret.json'), 'private');
assert.throws(() => verifyStagedFiles(destination, inventory, 'test'), /예상하지 않은/);
console.log('PASS: deployment allowlist excludes private catalogs/unrelated assets; detects stale/missing/tampered files, wrong version and inline scripts');
