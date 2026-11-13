import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const files=['src/App.tsx','src/cloud/LoginApplication.tsx','src/cloud/WorkspaceMenu.tsx','src/shared-ui.tsx','src/local-storage.ts','index.html','vite.config.ts'];
for(const file of files){
 const source=readFileSync(file,'utf8');
 assert(!source.includes('루센트'),file+' must use the current company name');
 if(file.endsWith('.tsx'))assert(!/<img[^>]*(?:logo-black|logo-white)/.test(source),file+' must display company text instead of logo images');
}
assert(readFileSync('src/BrandName.tsx','utf8').includes('FM 파트너스'));
assert(readFileSync('index.html','utf8').includes('<title>FM 파트너스'));
for(const file of ['icon.svg','logo-black.svg','logo-white.svg'])assert(!readFileSync('public/'+file,'utf8').includes('<path'),'Old logo paths must be removed from '+file);
// Changing presentation must not break encrypted records, imports or installed clients.
assert(readFileSync('src/local-storage.ts','utf8').includes('lucent-inspection-v1'));
assert(readFileSync('src/site-directory.ts','utf8').includes("'lucent-directory'"));
console.log('PASS: FM company text replaces old branding/logo paths; existing storage/import identifiers remain compatible');
