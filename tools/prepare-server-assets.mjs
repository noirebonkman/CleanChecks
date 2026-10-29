import {cpSync,existsSync,mkdirSync,readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {dirname,resolve,relative,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(root,'dist');
const target=resolve(root,'.server-build');
if(!existsSync(source))throw Error('먼저 npm run build 를 실행하세요.');
// Use a fresh versioned directory, never remove user files or private catalogs.
const packageInfo=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
const destination=resolve(target,'v'+packageInfo.version);
mkdirSync(destination,{recursive:true});
const allowedRoot=new Set(['index.html','sw.js','registerSW.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','favicon-32.png','apple-touch-icon.png','logo-black.svg','logo-white.svg','_headers']);
const allowed=new Set(['.html','.js','.css','.svg','.png','.jpg','.jpeg','.webmanifest','.ico','.woff','.woff2','.txt']);
function copy(directory){
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  const file=resolve(directory,entry.name);
  const parts=relative(source,file).split(sep);
  if(parts.some(part=>['JSON','data','private','server','src','node_modules'].includes(part)))continue;
  if(entry.isDirectory()){if(parts[0]==='assets')copy(file);continue;}
  if(parts.length===1&&!allowedRoot.has(entry.name)&&!/^workbox-[a-z0-9]+\.js$/.test(entry.name))continue;
  if(entry.name.startsWith('.')||(!allowed.has(extname(file))&&entry.name!=='_headers'))continue;
  if(statSync(file).size>8*1024*1024)throw Error('배포 파일이 너무 큽니다: '+entry.name);
  const output=resolve(destination,relative(source,file));mkdirSync(dirname(output),{recursive:true});cpSync(file,output);
 }
}
copy(source);
writeFileSync(resolve(destination,'_headers'),`/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Strict-Transport-Security: max-age=31536000
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'

/index.html
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
`);
console.log('서버 배포 파일 준비 완료: .server-build/v'+packageInfo.version+' (현장 JSON·원본·비밀 파일 제외)');
