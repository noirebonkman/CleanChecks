import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html lang="ko"><head><title>삭제 검사</title></head><body></body></html>',{url:'https://example.test',pretendToBeVisual:true});
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','MutationObserver'])globalThis[key]=dom.window[key];
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
mkdirSync('.test-work/deletion',{recursive:true});
await build({entryPoints:['src/cloud/inspection-deletion.ts','src/RecordJournal.tsx'],outdir:'.test-work/deletion',bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
const {deleteInspection,canDeleteInspection}=await import('../.test-work/deletion/cloud/inspection-deletion.js');
const {RecordJournal}=await import('../.test-work/deletion/RecordJournal.js');
const React=await import('react'),{render,screen,fireEvent,cleanup,waitFor}=await import('@testing-library/react');
const user={id:'me',role:'inspector',name:'본인',username:'me',active:true},owner={...user,id:'owner',role:'owner'};
const site={id:'site',name:'삭제 검사 현장',zone:'지역',address:'주소',cycle:'',priority:''};
const record={id:'one',staffId:'me',site,date:'2026-11-12T12:00',type:'',cycle:'',technician:'',answers:{},rating:'',issues:'',action:'',assignee:'',due:'',actionState:'',notes:'',photos:[],status:'draft',modified:false,updated:'2026-11-12T12:00:00Z',history:[]};
const target={id:'one',ownerId:'me',siteName:site.name,date:record.date,revision:1};
const initial=()=>({records:[structuredClone(record)],cloud:{userId:'me',staffId:'me',automatic:true,records:{one:{revision:1,fingerprint:'saved'}}}});
let state=initial(),calls=[],mode='success',failSave=false,events=0;
window.addEventListener('cleanchecks:inspections-changed',()=>events++);
globalThis.fetch=async(path,options={})=>{
 calls.push({path,options});
 if(options.method==='DELETE'){
  if(mode==='failure')return Response.json({error:'서버 오류'},{status:500});
  if(mode==='deleted')return Response.json({error:'이미 삭제됨'},{status:409});
  if(mode==='password'&&JSON.parse(options.body).password!=='secret')return Response.json({error:'비밀번호 확인'},{status:403});
  return Response.json({revision:2});
 }
 return Response.json({records:mode==='deleted'?[{id:'one',ownerId:'me',deleted:true,revision:2,record:null}]:[],nextCursor:null});
};
const save=async value=>{if(failSave)throw Error('저장 공간 오류');state=value;};
try{
 assert(!canDeleteInspection(user,{...target,ownerId:'other'}));
 await assert.rejects(deleteInspection({...target,ownerId:'other'},user,()=>state,save),/본인의/);assert.equal(calls.length,0);
 await deleteInspection(target,user,()=>state,save);assert.equal(state.records.length,0);assert.equal(state.cloud.records.one.fingerprint,null);assert.equal(state.cloud.records.one.revision,2);assert.equal(events,1);assert.equal(calls[0].path,'/api/records/one');
 state=initial();calls=[];mode='failure';await assert.rejects(deleteInspection(target,user,()=>state,save),/서버 오류/);assert.equal(state.records.length,1);
 mode='success';failSave=true;await assert.rejects(deleteInspection(target,user,()=>state,save),/저장 공간/);assert.equal(state.records.length,1);
 failSave=false;mode='deleted';await deleteInspection(target,user,()=>state,save);assert.equal(state.records.length,0);assert.equal(state.cloud.records.one.revision,2);
 state=initial();calls=[];mode='password';await assert.rejects(deleteInspection(target,owner,()=>state,save,'wrong'),/비밀번호/);assert.equal(state.records.length,1);
 await deleteInspection(target,owner,()=>state,save,'secret');assert.equal(state.records.length,0);assert.equal(calls.at(-1).path,'/api/owner/records/one');
 console.log('PASS: own deletion, foreign denial, owner password, server-confirmed local removal, failed deletion preservation and lost-response/local-save retry recovery');
 let chosen=[];
 render(React.createElement(RecordJournal,{records:[record,{...record,id:'two'},{...record,id:'foreign',staffId:'other'}],name:'본인',query:'',filter:'전체',canCreate:true,editableStaffId:'me',onQuery:()=>{},onFilter:()=>{},onNew:()=>{},onOpen:()=>{},onExport:()=>{},emptyAction:null,canDelete:row=>row.staffId==='me',onDeleteMany:rows=>chosen=rows}));
 const recordList=screen.getByRole('region',{name:'점검 기록 목록'});
 const directDelete=[...recordList.querySelectorAll('button')].filter(button=>button.getAttribute('aria-label')===site.name+' 점검표 삭제');
 assert.equal(directDelete.length,2,'Each owned row has a visible delete button; foreign rows do not');
 fireEvent.click(directDelete[0]);assert.deepEqual(chosen.map(row=>row.id),['one']);
 assert(!screen.getByRole('region',{name:'선택한 점검 요약'}).querySelector('.danger'),'Deletion belongs in the list, not the detail preview');
 fireEvent.click(screen.getByRole('button',{name:'선택 삭제',exact:true}));
 const boxes=screen.getAllByRole('checkbox');assert.equal(boxes.length,3,'One select-all and two owned records; no foreign selection');
 fireEvent.click(screen.getByRole('checkbox',{name:'표시된 삭제 가능 기록 전체 선택'}));
 fireEvent.click(screen.getByRole('button',{name:'선택 삭제',exact:true}));
 assert.deepEqual(chosen.map(row=>row.id).sort(),['one','two']);
 console.log('PASS: list bulk selection includes only deletable displayed records, leaving foreign records unselected');
}finally{cleanup();dom.window.close();}
