import type {State} from './inspection-model';

const key='lucent-workspace-v1';
export type Workspace={person:string;recordId:string;step:number;screen:string};
// Only opaque local IDs and navigation are stored here. Personal content stays in the vault.
export function readWorkspace(state:State):Workspace{
 const empty={person:'',recordId:'',step:0,screen:'home'};
 try{
  const value=JSON.parse(localStorage.getItem(key)||'null');
  if(!value||!state.staff.some(p=>p.id===value.person&&p.active))return empty;
  const record=state.records.find(r=>r.id===value.recordId&&r.staffId===value.person);
  return {person:value.person,recordId:record?.id||'',step:Number.isInteger(value.step)?Math.max(0,Math.min(7,value.step)):0,screen:value.screen==='inspect'&&record?'inspect':'home'};
 }catch{return empty}
}
export function saveWorkspace(value:Workspace){try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Record saving does not depend on navigation storage. */}}
