import type {State,Staff,Inspection} from './inspection-model';
import {uid} from './inspection-model';
import {validInspection} from './record-validation';
export const personalRevision=(records:Inspection[])=>JSON.stringify(records.map(r=>[r.id,r.updated,r.status]).sort((a,b)=>a[0].localeCompare(b[0])));
export function personalData(state:State,person:string){const staff=state.staff.find(p=>p.id===person);if(!staff)throw Error('먼저 점검자를 선택해 주세요.');return {kind:'lucent-personal',version:1,staff:{...staff,salt:'',hash:''},records:state.records.filter(r=>r.staffId===person)};}
export function personalFiles(input:any){
 if(input?.kind==='lucent-personal')return [input];
 if(input?.kind==='lucent-backup'&&input.version===1&&Array.isArray(input.state?.staff)&&Array.isArray(input.state?.records)){
  return input.state.staff.map((s:Staff)=>({kind:'lucent-personal',version:1,staff:{...s,salt:'',hash:''},records:input.state.records.filter((r:Inspection)=>r.staffId===s.id)}));
 }
 throw Error('개인 데이터 또는 이전 버전의 백업 파일을 선택해 주세요.');
}
export function inspectPersonal(state:State,input:any){
 if(input?.kind!=='lucent-personal'||input.version!==1||typeof input.staff?.name!=='string'||!input.staff.name.trim()||!Array.isArray(input.records)||!input.records.every(validInspection))throw Error('개인 점검 데이터에 누락되거나 손상된 항목이 있습니다. 기존 기록은 변경하지 않았습니다.');
 if(new Set(input.records.map((r:Inspection)=>r.id)).size!==input.records.length)throw Error('파일 안에 중복된 점검표 ID가 있습니다. 원본 파일을 확인해 주세요.');
 const name=input.staff.name.trim();const staff:Staff=state.staff.find(p=>p.name.normalize().toLowerCase()===name.normalize().toLowerCase())||{id:uid(),name,salt:'',hash:'',active:true};
 const incoming:Inspection[]=input.records.map((r:Inspection)=>({...r,staffId:staff.id}));
 if(incoming.some(r=>state.records.some(x=>x.id===r.id&&x.staffId!==staff.id)))throw Error('다른 점검자의 기록과 ID가 겹칩니다. 기존 기록을 보호하기 위해 중단했습니다.');
 const conflicts=incoming.filter(r=>state.records.some(x=>x.id===r.id&&JSON.stringify(x)!==JSON.stringify(r)));
 return {staff,incoming,conflicts,name};
}
export type ConflictChoices=Record<string,'local'|'incoming'>;
export function mergePersonal(state:State,input:any,choices:ConflictChoices={}){
 const {staff,incoming,conflicts,name}=inspectPersonal(state,input);
 if(conflicts.some(r=>!choices[r.id]))throw Error(`내용이 다른 동일 점검표 ${conflicts.length}건이 있습니다. 각 기록에서 유지할 내용을 선택해 주세요.`);
 const records=new Map(state.records.map(r=>[r.id,r]));let updated=0;
 for(const r of incoming){if(!records.has(r.id))records.set(r.id,r);else if(conflicts.some(x=>x.id===r.id)&&choices[r.id]==='incoming'){records.set(r.id,r);updated++}}
 const merged=Array.from(records.values());
 return {next:{...state,staff:state.staff.some(p=>p.id===staff.id)?state.staff:[...state.staff,staff],records:merged},person:staff.id,name,added:merged.length-state.records.length,updated};
}
