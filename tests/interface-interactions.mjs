import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const dom=new JSDOM('<!doctype html><html lang="ko"><head><title>화면 검사</title></head><body></body></html>',{url:'https://example.test',pretendToBeVisual:true});
for(const key of ['window','document','localStorage','HTMLElement','Element','Node','Event','MouseEvent','CustomEvent','MutationObserver','FormData','getComputedStyle'])globalThis[key]=key==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):dom.window[key];
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});globalThis.WebSocket=undefined;
dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
mkdirSync('.test-work',{recursive:true});
await build({stdin:{contents:"export {AccountSettings} from './src/cloud/AccountSettings';export {FieldCalendar} from './src/cloud/FieldCalendar';",resolveDir:process.cwd(),loader:'tsx'},outfile:'.test-work/interface-api.mjs',bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.xlsx':'file'}});
const {AccountSettings,FieldCalendar}=await import('../.test-work/interface-api.mjs');
const React=await import('react'),{render,screen,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const user={id:'me',username:'worker',name:'점검자',role:'admin',active:true};
let requests=[],changed=null,logout=0;
window.addEventListener('cleanchecks:server-logout',()=>logout++);
try{
 globalThis.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):{};requests.push({url,body});
  if(url==='/api/account/verify')return body.current==='RightPassword'?Response.json({ok:true}):Response.json({error:'비밀번호를 확인해 주세요.'},{status:403});
  if(url==='/api/account/profile')return Response.json({user:{...user,name:body.name}});
  return Response.json({ok:true});
 };
 render(React.createElement(AccountSettings,{user,onClose(){},onChanged:value=>changed=value}));
 assert(!screen.queryByLabelText('이름'));assert(!screen.queryByRole('button',{name:'로그아웃'}));
 fireEvent.change(screen.getByLabelText('현재 비밀번호'),{target:{value:'WrongPassword'}});
 fireEvent.click(screen.getByRole('button',{name:'계정 설정 열기'}));
 await screen.findByRole('alert');assert(!screen.queryByLabelText('이름'));
 fireEvent.change(screen.getByLabelText('현재 비밀번호'),{target:{value:'RightPassword'}});
 fireEvent.click(screen.getByRole('button',{name:'계정 설정 열기'}));
 await screen.findByLabelText('이름');assert(!screen.queryByLabelText('아이디'));assert(screen.getByText('worker'));
 fireEvent.change(screen.getByLabelText('이름'),{target:{value:'변경된 이름'}});fireEvent.click(screen.getByRole('button',{name:'이름 저장'}));
 await screen.findByRole('status');assert.equal(changed.name,'변경된 이름');assert.deepEqual(requests.at(-1).body,{current:'RightPassword',name:'변경된 이름'});
 fireEvent.change(screen.getByLabelText('새 비밀번호',{exact:true}),{target:{value:'ChangedPassword'}});
 fireEvent.change(screen.getByLabelText('새 비밀번호 확인'),{target:{value:'WrongConfirmation'}});
 const before=requests.length;fireEvent.click(screen.getByRole('button',{name:'변경 후 다시 로그인'}));
 await screen.findByText('새 비밀번호가 서로 다릅니다.');assert.equal(requests.length,before);
 fireEvent.change(screen.getByLabelText('새 비밀번호 확인'),{target:{value:'ChangedPassword'}});fireEvent.click(screen.getByRole('button',{name:'변경 후 다시 로그인'}));
 await waitFor(()=>assert.equal(logout,1));assert(!JSON.stringify({...localStorage}).includes('RightPassword'));
 cleanup();console.log('PASS: account page requires current password before opening; only name/password are editable; feedback, mismatch handling and logout work');
 const clock=new Date(),date=new Date(clock.getTime()-clock.getTimezoneOffset()*60000).toISOString().slice(0,10);
 const targetDate=new Date(date+'T12:00:00');targetDate.setDate(targetDate.getDate()+1);
 const tomorrow=`${targetDate.getFullYear()}-${String(targetDate.getMonth()+1).padStart(2,'0')}-${String(targetDate.getDate()).padStart(2,'0')}`;
 for(const [repeat,conflict] of [['none',false],['weekly',false],['none',true]]){
  let rows=[{id:'calendar',siteId:'site',siteName:'점검 현장',title:'청소',date,kind:'정기청소',start:'09:00',end:'10:00',assignee:'점검자',address:'',notes:'보존할 메모',state:'예정',repeat,until:'',seriesId:'',originalDate:'',revision:1}],writes=[];
  globalThis.fetch=async(url,options={})=>{
   if(String(url).startsWith('/api/calendar?'))return Response.json({schedules:rows,version:'v'+writes.length});
   if(url==='/api/sites')return Response.json({sites:[]});
   if(options.method==='PUT'){
    const body=JSON.parse(options.body);writes.push(body);
    if(conflict&&writes.length===2)return Response.json({error:'다른 사용자가 변경한 일정입니다.'},{status:409});
    const row={...body.schedule,revision:body.revision+1};rows=[...rows.filter(r=>r.id!==row.id),row];
    return Response.json({revision:row.revision,schedule:row});
   }
   return Response.json({ok:true});
  };
  render(React.createElement(FieldCalendar,{user,onMenu(){},onLogout:async()=>{}}));
  await waitFor(()=>assert(document.querySelector('.visit-chip[draggable=true]')));
  const transfer={setData(){},effectAllowed:'',dropEffect:''};
  fireEvent.dragStart(document.querySelector('.visit-chip[draggable=true]'),{dataTransfer:transfer});
  fireEvent.drop(document.querySelector(`[data-date="${tomorrow}"]`),{dataTransfer:transfer});
  const undo=await screen.findByRole('button',{name:'되돌리기'});assert.equal(writes.length,1);assert.equal(writes[0].schedule.date,tomorrow);
  fireEvent.click(undo);
  if(conflict){await screen.findByText(/되돌리지 못했습니다.*다른 사용자가 변경한 일정/);assert.equal(writes.length,2);assert.equal(rows[0].date,tomorrow);cleanup();continue;}
  await screen.findByText('이동을 취소하고 원래 날짜로 되돌렸습니다.');
  assert.equal(writes.length,2);assert.equal(writes[1].schedule.date,date);assert.equal(writes[1].revision,writes[0].revision+1);
  assert.equal(writes[1].schedule.notes,'보존할 메모');
  if(repeat==='weekly'){assert.equal(writes[1].schedule.seriesId,'calendar');assert.equal(writes[1].schedule.originalDate,date);}
  cleanup();
 }
 console.log('PASS: normal/recurring moves undo with the committed revision; conflicts preserve the newer schedule and show a visible error');
}finally{cleanup();dom.window.close();}
process.exit(0);
