import Dexie,{type Table} from 'dexie';
import type {State,Cipher,Sealed,Staff} from './inspection-model';
const enc=new TextEncoder(),dec=new TextDecoder();
const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const b64=(b:ArrayBuffer|Uint8Array)=>{const a=new Uint8Array(b);let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.slice(i,i+8192));return btoa(s)};
const source=(x:Uint8Array)=>x as unknown as BufferSource;
const salt=()=>b64(crypto.getRandomValues(new Uint8Array(16)));
export async function derive(password:string,s:string){const raw=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:source(bytes(s)),iterations:250000,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);}
export async function encrypt(value:unknown,key:CryptoKey):Promise<Cipher>{const iv=crypto.getRandomValues(new Uint8Array(12));return {iv:b64(iv),data:b64(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(value))))};}
export async function decrypt<T>(v:Cipher,key:CryptoKey):Promise<T>{return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:source(bytes(v.iv))},key,source(bytes(v.data)))))}
export async function pinHash(pin:string,s:string){const k=await derive(pin,s);return b64(await crypto.subtle.digest('SHA-256',await crypto.subtle.exportKey('raw',k)));}
export async function makeStaff(name:string,pin:string):Promise<Staff>{const s=salt();return {id:crypto.randomUUID(),name:name.trim(),salt:s,hash:await pinHash(pin,s),active:true};}
export async function makeAdmin(password:string){const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);const priv=await crypto.subtle.exportKey('jwk',pair.privateKey),s=salt(),rs=salt(),recovery=b64(crypto.getRandomValues(new Uint8Array(24)));return {publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey),admin:{salt:s,hash:await pinHash(password,s),privateKey:await encrypt(priv,await derive(password,s)),recoverySalt:rs,recoveryPrivate:await encrypt(priv,await derive(recovery,rs))},recovery,privateKey:pair.privateKey};}
export async function unlockAdmin(state:State,password:string){if(!state.admin)throw Error('이 기기는 점검자용입니다.');const jwk=await decrypt<JsonWebKey>(state.admin.privateKey,await derive(password,state.admin.salt));return crypto.subtle.importKey('jwk',jwk,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);}
export async function recoverAdmin(state:State,code:string,password:string){if(!state.admin)throw Error('관리자 설정이 없습니다.');const jwk=await decrypt<JsonWebKey>(state.admin.recoveryPrivate,await derive(code,state.admin.recoverySalt));const s=salt();return {...state.admin,salt:s,hash:await pinHash(password,s),privateKey:await encrypt(jwk,await derive(password,s))};}
export async function sealLog(value:unknown,jwk:JsonWebKey):Promise<Sealed>{const pub=await crypto.subtle.importKey('jwk',jwk,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);const k=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);const c=await encrypt(value,k);return {...c,key:b64(await crypto.subtle.encrypt({name:'RSA-OAEP'},pub,await crypto.subtle.exportKey('raw',k)))};}
export async function openLog(c:Sealed,key:CryptoKey){const raw=await crypto.subtle.decrypt({name:'RSA-OAEP'},key,source(bytes(c.key)));return decrypt<Record<string,unknown>>(c,await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']));}
class Store extends Dexie{kv!:Table<{id:string;value:unknown;revision?:number},string>;constructor(){super('lucent-inspection-v1');this.version(1).stores({kv:'id'});}}
let accountNamespace='';
export const storageAccount=()=>accountNamespace;
const rowId=(name:string)=>accountNamespace?'account:'+accountNamespace+':'+name:name;
export async function selectAccountStorage(accountId:string){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(accountId))throw Error('계정을 확인해 주세요.');await queue.catch(()=>{});accountNamespace=accountId;expectedRevision=0;}
const db=new Store();let key:CryptoKey;let queue=Promise.resolve(),expectedRevision=0;
export class StorageConflictError extends Error{constructor(){super('다른 탭에서 데이터가 변경되었습니다. 이 화면의 기록을 백업한 후 최신 기록을 불러와 주세요.');this.name='StorageConflictError'}}
const channel=typeof window!=='undefined'&&typeof window.BroadcastChannel==='function'?new window.BroadcastChannel('lucent-inspection-saves'):null;
if(channel)channel.onmessage=e=>{if(e.data?.type==='saved'&&(e.data.account||'')===accountNamespace&&typeof e.data.revision==='number'&&e.data.revision>expectedRevision)window.dispatchEvent(new Event('lucent:external-write'))};
export async function load():Promise<State|null>{await queue.catch(()=>{});let row=await db.kv.get(rowId('device-key'));if(!row){const candidate=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);try{await db.kv.add({id:rowId('device-key'),value:candidate});row={id:rowId('device-key'),value:candidate}}catch(error){if(!(error instanceof Error)||error.name!=='ConstraintError')throw error;row=await db.kv.get(rowId('device-key'))}}if(!row)throw Error('기기 저장 키를 준비하지 못했습니다.');key=row.value as CryptoKey;const v=await db.kv.get(rowId('vault'));const result=v?await decrypt<State>(v.value as Cipher,key):null;expectedRevision=v?.revision??0;return result;}
export function save(s:State){const snapshot=structuredClone(s);queue=queue.catch(()=>{}).then(async()=>{const value=await encrypt(snapshot,key),revision=expectedRevision+1;await db.transaction('rw',db.kv,async()=>{const current=await db.kv.get(rowId('vault'));if((current?.revision??0)!==expectedRevision)throw new StorageConflictError();await db.kv.put({id:rowId('vault'),value,revision})});expectedRevision=revision;channel?.postMessage({type:'saved',account:accountNamespace,revision})});return queue;}
export async function pack(value:unknown,password:string){const s=salt();return {format:'lucent-encrypted-v1',salt:s,...await encrypt(value,await derive(password,s))};}
export async function unpack(text:string,password:string){const v=JSON.parse(text);if(v.format!=='lucent-encrypted-v1')throw Error('루센트 암호화 파일이 아닙니다.');return decrypt<any>(v,await derive(password,v.salt));}
export const download=(blob:Blob,name:string)=>{const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.hidden=true;document.body.appendChild(a);try{a.click()}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)}};

export async function readLegacyWorkspace():Promise<State|null>{
 const rows=await db.transaction('r',db.kv,async()=>({key:await db.kv.get('device-key'),value:await db.kv.get('vault')}));
 if(!rows.key||!rows.value)return null;
 return decrypt<State>(rows.value.value as Cipher,rows.key.value as CryptoKey);
}
