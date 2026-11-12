import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { build } from '../../node_modules/esbuild/lib/main.js';
import { Miniflare } from 'miniflare';
mkdirSync('.test-work',{recursive:true});
await build({entryPoints:['src/worker.ts'],outfile:'.test-work/recent-worker.mjs',bundle:true,format:'esm',platform:'browser'});
await build({entryPoints:['src/security.ts'],outfile:'.test-work/recent-security.mjs',bundle:true,format:'esm',platform:'node'});
const {seal}=await import('../.test-work/recent-security.mjs');
const env={APP_DATA_KEY:randomBytes(32).toString('base64'),SETUP_TOKEN:randomBytes(32).toString('hex')};
const mf=new Miniflare({modules:true,scriptPath:'.test-work/recent-worker.mjs',compatibilityDate:'2026-08-01',d1Databases:{DB:'recent-test'},bindings:env});
const origin='https://example.workers.dev', password='Owner12345',temporary='Temp123456',chosen='User123456';
const db=await mf.getD1Database('DB');
async function call(path,status,{cookie,method='GET',body,binary=false}={}){
 const response=await mf.dispatchFetch(origin+'/api/'+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=binary?await response.arrayBuffer():await response.json();
 assert.equal(response.status,status,binary?'binary response':JSON.stringify(data));
 assert.equal(response.headers.get('cache-control'),'no-store');
 return {data,response,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
try{
 for(const name of ['0001_initial.sql','0002_account_login.sql','0003_account_permissions.sql','0004_inspection_photos.sql'])
  for(const sql of readFileSync('migrations/'+name,'utf8').split(';').filter(value=>value.trim()))await db.prepare(sql).run();
 await call('setup',201,{method:'POST',body:{setupToken:env.SETUP_TOKEN,username:'ludmin',name:'어드민',password}});
 const owner=await call('login',200,{method:'POST',body:{username:'ludmin',password}});
 const users=[];
 for(const [username,name] of [['worker-one','첫 점검자'],['worker-two','다른 점검자']]){
  await call('accounts',201,{cookie:owner.cookie,method:'POST',body:{username,name,password:temporary}});
  const first=await call('login',200,{method:'POST',body:{username,password:temporary}});
  await call('recent-inspections',403,{cookie:first.cookie});
  await call('password',200,{cookie:first.cookie,method:'POST',body:{current:temporary,password:chosen}});
  users.push(await call('login',200,{method:'POST',body:{username,password:chosen}}));
 }
 await call('recent-inspections',401);
 const site={id:'site',name:'공용 조회 현장',zone:'구역',address:'주소',priority:'',cycle:''};
 const base={site,date:'2026-11-12T12:00',type:'',cycle:'',technician:'',answers:{'0-0':'B'},rating:'개선 필요',issues:'조회용 점검 내용',action:'정리',assignee:'',due:'',actionState:'',notes:'',photos:[],status:'complete',modified:false,history:[]};
 for(let i=0;i<25;i++){
  const id='recent-'+String(i).padStart(2,'0');
  const at='2026-11-12T12:'+String(Math.floor(i/2)).padStart(2,'0')+':00.000Z';
  const record={...base,id,date:i===24?'2026-10-01T09:00':base.date,updated:at,status:i===23?'draft':'complete',photos:i===24?[{id:'saved-photo',name:'현장 사진'}]:[]};
  await db.prepare('INSERT INTO inspections(id,account_id,payload,revision,deleted,operation_id,updated_at) VALUES(?,?,?,1,0,?,?)')
   .bind(id,users[i%2].data.user.id,await seal(record,env),'operation-'+i,at).run();
 }
 const image='data:image/jpeg;base64,/9j/2Q==';
 await db.prepare('INSERT INTO inspection_photos(account_id,record_id,photo_id,payload,stored_bytes,staged_at) VALUES(?,?,?,?,?,NULL)')
  .bind(users[0].data.user.id,'recent-24','saved-photo',await seal(image,env),20).run();
 const first=(await call('recent-inspections',200,{cookie:users[1].cookie})).data;
 assert.equal(first.items.length,20);assert.equal(first.items[0].id,'recent-24');
 assert.deepEqual(new Set(first.items.map(row=>row.inspectorName)),new Set(['첫 점검자','다른 점검자']));
 assert(!JSON.stringify(first).includes('조회용 점검 내용'),'The list must only return summary metadata');
 const second=(await call('recent-inspections?cursor='+encodeURIComponent(first.nextCursor),200,{cookie:users[1].cookie})).data;
 assert.equal(second.items.length,5);assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,25);
 assert.equal((await call('recent-inspections?since='+encodeURIComponent(first.version),200,{cookie:users[1].cookie})).data.unchanged,true);
 const viewed=(await call('recent-inspections/recent-24',200,{cookie:users[1].cookie})).data;
 assert.equal(viewed.record.issues,base.issues);assert.equal(viewed.inspectorName,'첫 점검자');
 assert.equal(viewed.record.photos[0].data,'');
 const photo=await call('recent-inspections/recent-24/photos/saved-photo',200,{cookie:users[1].cookie,binary:true});
 assert.equal(photo.response.headers.get('content-type'),'image/jpeg');
 await call('recent-inspections/recent-24/photos/not-in-manifest',404,{cookie:users[1].cookie});
 await call('recent-inspections/recent-24',405,{cookie:users[1].cookie,method:'PUT',body:{record:base}});
 await call('recent-inspections/recent-24',405,{cookie:users[1].cookie,method:'DELETE',body:{}});
 await call('admin/records',403,{cookie:users[1].cookie});
 await call('records/recent-24',409,{cookie:users[1].cookie,method:'PUT',body:{record:{...base,id:'recent-24',status:'draft',updated:'2026-11-12T12:12:00.000Z'},revision:1,photoManifest:true}});
 assert.equal((await db.prepare('SELECT revision FROM inspections WHERE id=?').bind('recent-24').first()).revision,1);
 await call('recent-inspections?cursor=invalid!',400,{cookie:users[1].cookie});
 await db.prepare('UPDATE inspections SET deleted=1,revision=revision+1,payload=? WHERE id=?').bind(await seal(null,env),'recent-24').run();
 const changed=(await call('recent-inspections?since='+encodeURIComponent(first.version),200,{cookie:users[1].cookie})).data;
 assert(!changed.items.some(row=>row.id==='recent-24'));assert.notEqual(changed.version,first.version);
 await call('recent-inspections/recent-24',404,{cookie:users[1].cookie});
 await call('recent-inspections/recent-24/photos/saved-photo',404,{cookie:users[1].cookie});
 console.log('PASS: authenticated shared recent metadata, stable pagination, saved-time ordering, unchanged-version fast path and read-only detail/photos');
 console.log('PASS: shared viewing never grants foreign writes, deletions or admin-list access; deleted records/photos disappear and invalid cursors are rejected');
}finally{await mf.dispose();}
