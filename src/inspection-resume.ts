import { storageAccount } from './local-storage';
import {sections,type State} from './inspection-model';

const workspaceKey=()=> 'lucent-workspace-v1'+(storageAccount()?':'+storageAccount():'');
export type Workspace={person:string;recordId:string;step:number;screen:string};
// Only opaque local IDs and navigation are stored here. Personal content stays in the vault.
export function readWorkspace(state:State):Workspace{
 const empty={person:'',recordId:'',step:0,screen:'home'};
 try{
  const value=JSON.parse(localStorage.getItem(workspaceKey())||'null');
  if(!value||!state.staff.some(p=>p.id===value.person&&p.active))return empty;
  const record=state.records.find(r=>r.id===value.recordId&&r.staffId===value.person);
  const unfinished=record?.status==='draft'?sections.findIndex((section,index)=>section.items.some((_,item)=>!record.answers[`${index}-${item}`])):-1;
  const lastAvailable=unfinished<0?sections.length:unfinished;
  const step=Number.isInteger(value.step)?Math.max(0,Math.min(lastAvailable,value.step)):0;
  return {person:value.person,recordId:record?.id||'',step,screen:value.screen==='inspect'&&record?'inspect':'home'};
 }catch{return empty}
}
export function saveWorkspace(value:Workspace){try{localStorage.setItem(workspaceKey(),JSON.stringify(value))}catch{/* Record saving does not depend on navigation storage. */}}
