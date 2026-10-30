import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
const dom=new JSDOM('<!doctype html><html lang="ko"><head><title>현장점검</title></head><body></body></html>',{url:'https://example.test',pretendToBeVisual:true});
for(const key of ['window','document','localStorage','HTMLElement','Element','Node','Event','MouseEvent','CustomEvent','MutationObserver','FormData','getComputedStyle'])globalThis[key]=key==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):dom.window[key];
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};globalThis.IS_REACT_ACT_ENVIRONMENT=true;
mkdirSync('.test-work',{recursive:true});
await build({entryPoints:['tests/api.ts'],outfile:'.test-work/access-api.mjs',bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
const api=await import('../.test-work/access-api.mjs'),React=await import('react');
const {render,screen,within,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const site={id:'site',name:'권한 검증 현장',zone:'구역',address:'주소',priority:'',cycle:''};
const base={id:'record',staffId:'someone',site,date:'2026-10-30T12:00',type:'',cycle:'',technician:'',answers:{},rating:'',issues:'타인 비공개 내용',action:'',assignee:'',due:'',actionState:'',notes:'',photos:[],status:'draft',modified:false,updated:new Date().toISOString(),history:[]};
await api.load();
await api.save({version:1,installId:'legacy-device',sites:[site],staff:[{id:'legacy-person',name:'로그인 점검자',salt:'',hash:'',active:true}],records:[{...base,id:'legacy-record',staffId:'legacy-person'}],logs:[],...api.bootstrap});
let activeUser=null,loginPayload;
globalThis.fetch=async(url,options={})=>{
 const path=String(url);
 if(path==='/api/auth-config')return Response.json({setupRequired:false,turnstileSiteKey:''});
 if(path==='/api/session')return activeUser?Response.json({user:activeUser}):Response.json({error:'로그인 필요'},{status:401});
 if(path==='/api/login'){loginPayload=JSON.parse(options.body);activeUser={id:'login-account',username:'worker',name:'로그인 점검자',role:'inspector',active:true};return Response.json({user:activeUser});}
 if(path==='/api/logout'){activeUser=null;return Response.json({ok:true});}
 if(path==='/api/sites')return Response.json({sites:[{site,revision:1}]});
 if(path==='/api/records'||path==='/api/admin/records')return Response.json({records:[],nextCursor:null});
 if(path==='/api/accounts'||path==='/api/people')return Response.json({users:activeUser?[activeUser]:[]});
 return Response.json({error:'지원하지 않음'},{status:404});
};
try{
 render(React.createElement(api.LoginApplication));
 await screen.findByRole('heading',{name:'로그인'});
 assert(!screen.queryByRole('button',{name:'새 점검'}));assert(!screen.queryByText('타인 비공개 내용'));
 fireEvent.change(await screen.findByLabelText('아이디'),{target:{value:'worker'}});
 fireEvent.change(screen.getByLabelText('비밀번호'),{target:{value:'test-password-123'}});
 fireEvent.click(screen.getByLabelText(/자동로그인/));fireEvent.click(screen.getByRole('button',{name:'로그인',exact:true}));
 await screen.findByRole('heading',{name:'점검 기록'});
 assert.equal(loginPayload.remember,true);
 assert.equal((await api.load()).records.length,0);
 fireEvent.click(screen.getByRole('button',{name:'설정',exact:true}));
 fireEvent.click(await screen.findByRole('button',{name:'이 기기의 이전 기록 확인 후 가져오기'}));
 await screen.findByRole('button',{name:'확인하고 불러오기'});
 assert.equal((await api.load()).records.length,0);
 fireEvent.click(screen.getByRole('button',{name:'확인하고 불러오기'}));
 await waitFor(async()=>assert.equal((await api.load()).records.length,1));
 await waitFor(()=>assert(!screen.queryByRole('dialog')));
 assert.equal((await api.load()).records[0].staffId,activeUser.id);
 assert.equal((await api.readLegacyWorkspace()).records[0].staffId,'legacy-person');

 assert(!screen.queryByRole('button',{name:'점검자 추가',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'로그아웃',exact:true}));
 await screen.findByRole('heading',{name:'로그인'});assert(!screen.queryByText('로그인 점검자'));
 console.log('PASS: unauthenticated login gate, remember selection, explicit logout and account-switch screen');
 cleanup();
 for(const role of ['inspector','admin','owner']){
  activeUser={id:'role-'+role,username:role,name:'현재 사용자',role,active:true};
  await api.prepareAccountWorkspace(activeUser);
  let state=await api.load();
  await api.save({...state,sites:[site],staff:[...state.staff,{id:'someone',name:'다른 점검자',salt:'',hash:'',active:true}],records:[{...base,id:'other-record'}, {...base,id:'my-record',staffId:activeUser.id,issues:'본인 내용'}]});
  render(React.createElement(api.App,{session:activeUser,onLogout:async()=>{}}));
  await screen.findByRole('heading',{name:'점검 기록'});
  const sidebar=document.querySelector('aside');
  assert(!within(sidebar).queryByRole('button',{name:'점검자 추가',exact:true}));
  assert(!within(sidebar).queryByRole('button',{name:/점검자 삭제/}));
  assert.equal(!!within(sidebar).queryByRole('button',{name:/다른 점검자/}),role!=='inspector');
  if(role!=='inspector'){
   fireEvent.click(within(sidebar).getByRole('button',{name:/다른 점검자/}));
   fireEvent.click(within(sidebar.querySelector('.accordion.expanded')).getByRole('button',{name:/권한 검증 현장/}));
   await screen.findByRole('heading',{name:'바닥 및 출입구'});
   await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50));});
   assert.equal(document.querySelector('.top-person').getAttribute('aria-label'),'로그인 계정: 현재 사용자');
   assert(!screen.queryByRole('button',{name:'수정하기',exact:true}));
   assert(!screen.queryByRole('button',{name:'점검표 삭제',exact:true}));
   assert(screen.getAllByRole('button',{name:'A 양호'}).every(button=>button.disabled));
   fireEvent.click(screen.getByRole('button',{name:'메뉴 열기'}));
  }
  fireEvent.click(within(sidebar).getByRole('button',{name:'설정',exact:true}));
  await screen.findByRole('heading',{name:/내 기기 데이터/});
  assert(!screen.queryByLabelText('관리자 PIN'));assert(!screen.queryByRole('button',{name:'관리자 로그인',exact:true}));
  assert.equal(!!screen.queryByRole('heading',{name:'관리자 메뉴 · 현장 관리'}),role!=='inspector');
  assert.equal(!!screen.queryByRole('heading',{name:'어드민 전용 메뉴'}),role==='owner');
  const axe=(await import('axe-core')).default;
  let audit;await act(async()=>{audit=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']},rules:{'color-contrast':{enabled:false}}});});
  assert.deepEqual(audit.violations.map(value=>({id:value.id,nodes:value.nodes.map(node=>node.target)})),[]);
  const styleFiles=['base-layout','interaction-feedback','theme-and-components','record-journal','mobile-inspection','inspection-workspace'];
  const snapshot='<!doctype html>'+document.documentElement.outerHTML.replace('<head>','<head><meta charset="utf-8"><base href="/">').replace('</head>',styleFiles.map(name=>'<link rel="stylesheet" href="/src/'+name+'.css">').join('')+'<link rel="stylesheet" href="/src/cloud/login-and-access.css"><link rel="stylesheet" href="/src/cloud/cloud-settings.css"><style>html{font-size:200%}.page-enter{animation:none;opacity:1}.toast{display:none!important}</style></head>');
  writeFileSync('.test-work/'+role+'-large-font.html',snapshot);
  cleanup();
 }
 console.log('PASS: role-filtered sidebars, no local PIN, owner-only menus, read-only foreign records and WCAG structure for all three roles');
 const first={id:'partition-a',name:'A',username:'a',role:'inspector',active:true},second={...first,id:'partition-b',name:'B',username:'b'};
 await api.prepareAccountWorkspace(first);let state=await api.load();await api.save({...state,records:[{...base,staffId:first.id,photos:[{id:'secret-photo',name:'사진',data:'data:image/webp;base64,private'}]}]});
 await api.prepareAccountWorkspace(second);assert.equal((await api.load()).records.length,0);
 await api.prepareAccountWorkspace(first);assert.equal((await api.load()).records[0].photos[0].id,'secret-photo');
 console.log('PASS: encrypted local account partitions isolate text and photos while preserving the prior account');
}finally{cleanup();dom.window.close();}
process.exit(0);
