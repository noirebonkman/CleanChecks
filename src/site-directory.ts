import {pack,unpack} from './local-storage';
import {type Site,type Staff,type State} from './inspection-model';
export type Directory={kind:'lucent-directory';version:1;published:string;sites:Site[];staff:Staff[]};
export function validateDirectory(v:unknown):Directory{
 const d=v as Directory;const str=(x:unknown)=>typeof x==='string';
 if(!d||d.kind!=='lucent-directory'||d.version!==1||!str(d.published)||!Number.isFinite(Date.parse(d.published))||!Array.isArray(d.sites)||!Array.isArray(d.staff)||d.sites.length>20000||d.staff.length>2000)throw Error('현장 설정 파일 형식이 올바르지 않습니다.');
 if(!d.sites.every(s=>s&&['id','name','zone','address','priority','cycle'].every(k=>str(s[k as keyof Site]))&&s.id&&s.name.trim()&&s.zone.trim()&&s.address.trim()))throw Error('현장 설정에 필수 항목이 빠져 있습니다.');
 if(!d.staff.every(s=>s&&['id','name','salt','hash'].every(k=>str(s[k as keyof Staff]))&&s.id&&s.name.trim()&&typeof s.active==='boolean'))throw Error('점검자 설정이 올바르지 않습니다.');
 if(new Set(d.sites.map(s=>s.id)).size!==d.sites.length||new Set(d.staff.map(s=>s.id)).size!==d.staff.length||new Set(d.staff.map(s=>s.name.trim().normalize().toLowerCase())).size!==d.staff.length)throw Error('중복된 현장 ID 또는 점검자가 있습니다.');return d;
}
export async function digest(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function encodeDirectory(state:State,password?:string){if(password!==undefined&&password.length<8)throw Error('파일 비밀번호는 8자 이상 입력해 주세요.');const d:Directory={kind:'lucent-directory',version:1,published:new Date().toISOString(),sites:state.sites,staff:[]};return JSON.stringify(password===undefined?validateDirectory(d):await pack(validateDirectory(d),password));}
export async function decodeDirectory(text:string,password=''){try{const parsed=JSON.parse(text);return validateDirectory(parsed.kind==='lucent-directory'?parsed:await unpack(text,password))}catch{throw Error('파일 비밀번호가 다르거나 현장 설정 파일이 손상되었습니다.')}}
export function applyDirectory(state:State,d:Directory,password:string,hash:string):State{
 // Inspection snapshots are intentionally untouched when a site is renamed or removed.
 return {...state,sites:d.sites,staff:state.staff,directoryDirty:false,sync:{password,digest:hash,checked:new Date().toISOString(),published:d.published}};
}
export const directoryPath='JSON/site-directory.json';
export async function fetchDirectory(){
 // Prefer the visible JSON folder while keeping earlier deployment paths compatible.
 let response=await fetch(new URL('./'+directoryPath,document.baseURI),{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(response.status===404)response=await fetch(new URL('./JSON/site-directory.enc.json',document.baseURI),{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(response.status===404)response=await fetch(new URL('./data/site-directory.enc.json',document.baseURI),{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(response.status===404)response=await fetch(new URL('./site-directory.enc.json',document.baseURI),{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(response.status===404)throw Error('GitHub의 JSON 폴더에 site-directory.json 파일을 올려주세요.');
 if(!response.ok)throw Error('현장 목록을 가져오지 못했습니다. 기존 목록은 유지됩니다.');const text=await response.text();if(text.length>15_000_000)throw Error('설정 파일이 너무 큽니다.');return text;
}

