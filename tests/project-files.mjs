import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { requiredProjectFiles, checkProjectFiles } from '../tools/check-project-files.mjs';
mkdirSync('.test-work', { recursive: true });
const root = mkdtempSync(resolve('.test-work', 'project-check-'));
for (const name of requiredProjectFiles) {
    mkdirSync(dirname(resolve(root, name)), { recursive: true });
    writeFileSync(resolve(root, name), '');
}
const scripts = Object.fromEntries(['server:install','server:test','server:build','server:check'].map(name => [name, 'echo test']));
writeFileSync(resolve(root, 'package.json'), JSON.stringify({ scripts, dependencies: { react: '^19.0.0' } }));
writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({ packages: { '': { dependencies: { react: '^19.0.0' } } } }));
writeFileSync(resolve(root, 'server/package.json'), JSON.stringify({}));
writeFileSync(resolve(root, 'server/package-lock.json'), JSON.stringify({ packages: { '': {} } }));
assert.deepEqual(checkProjectFiles(root), []);
unlinkSync(resolve(root, 'tools/prepare-server-assets.mjs'));
assert(checkProjectFiles(root).some(error => error.includes('prepare-server-assets.mjs')));
writeFileSync(resolve(root, 'tools/prepare-server-assets.mjs'), '');
writeFileSync(resolve(root, 'src/main.tsx'), "import './missing.css';");
assert(checkProjectFiles(root).some(error => error.includes('missing.css')));
writeFileSync(resolve(root, 'src/main.tsx'), '');
writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({ packages: { '': {} } }));
assert(checkProjectFiles(root).some(error => error.includes('dependencies')));
writeFileSync(resolve(root, 'package.json'), '{}');
assert(checkProjectFiles(root).some(error => error.includes('server:install')));
console.log('PASS: missing deployment helper/import, absent npm script and inconsistent lockfile are detected before build');
