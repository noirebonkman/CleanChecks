import type {Site,Photo} from './inspection-model';
import {uid} from './inspection-model';
import {download} from './local-storage';
export async function readSites(file:File){const XLSX=await import('xlsx');const w=XLSX.read(await file.arrayBuffer(),{type:'array'}),sheet=w.Sheets[w.SheetNames[0]],end=XLSX.utils.decode_range(sheet['!ref']||'A1:F1').e,rows=XLSX.utils.sheet_to_json<any[]>(sheet,{header:1,defval:'',raw:false,range:{s:{r:0,c:0},e:{r:end.r,c:Math.max(5,end.c)}}});const valid:Site[]=[],invalid:{row:number;reason:string}[]=[];rows.forEach((r,i)=>{const values=[r[1],r[2],r[3],r[4],r[5]].map(v=>String(v??'').trim());if(!values.some(Boolean))return;if(['현장명','현장이름'].includes(values[0]))return;const [name,zone,address,priority,cycle]=values;if(!name||!zone||!address){invalid.push({row:i+1,reason:'현장명·구역·상세주소 중 빈칸이 있습니다.'});return;}valid.push({id:uid(),name,zone,address,priority,cycle});});return {valid,invalid};}
export function planSiteImport(existing:Site[],incoming:Site[]){
 let next=[...existing],added=0,corrected=0,duplicate=0;
 const seen=new Set<string>();
 for(const site of incoming){
  const key=JSON.stringify([site.name,site.address]);if(seen.has(key)){duplicate++;continue}seen.add(key);
  const same=next.find(x=>x.name===site.name&&x.address===site.address);
  // Repair only the exact old B-origin shift, corroborated by all three old fields.
  // Two source names sharing the same fingerprint are ambiguous and never auto-repaired.
  const sourceMatches=incoming.filter(x=>x.zone===site.zone&&x.address===site.address&&x.priority===site.priority);
  const shifted=sourceMatches.length===1&&site.priority?next.filter(x=>x.id!==same?.id&&x.name===site.zone&&x.zone===site.address&&x.address===site.priority):[];
  if(shifted.length){
   const ids=new Set(shifted.map(x=>x.id));
   if(same)next=next.filter(x=>!ids.has(x.id));
   else{const keep=shifted[0].id;next=next.filter(x=>!ids.has(x.id)||x.id===keep).map(x=>x.id===keep?{...site,id:keep}:x)}
   corrected+=shifted.length;
  }else if(same)duplicate++;
  else{next.push(site);added++}
 }
 return {next,added,corrected,duplicate};
}
export async function exportSites(sites:Site[]){const XLSX=await import('xlsx');const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['','현장명','구역','상세주소','우선도','작업주기'],...sites.map(s=>['',s.name,s.zone,s.address,s.priority,s.cycle])]),'현장 목록');download(new Blob([XLSX.write(wb,{type:'array',bookType:'xlsx'})]),'현장목록.xlsx');}
export async function compress(file:File):Promise<Photo>{
 if(!file.type.startsWith('image/'))throw Error('사진 파일을 선택해 주세요.');
 const img=await decodePhoto(file);
 try{
  const scale=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));
  const context=c.getContext('2d');if(!context)throw Error('사진을 처리하지 못했습니다.');
  context.fillStyle='#fff';context.fillRect(0,0,c.width,c.height);context.drawImage(img.image,0,0,c.width,c.height);
  let data='';try{data=c.toDataURL('image/webp',.8)}catch{}
  if(!data.startsWith('data:image/webp;base64,'))data=c.toDataURL('image/jpeg',.82);
  if(!/^data:image\/(webp|jpeg);base64,/.test(data))throw Error('사진을 압축하지 못했습니다. 다시 선택해 주세요.');
  return {id:uid(),data,name:file.name};
 }finally{img.close()}
}
export function photoExtension(data:string){return data.startsWith('data:image/webp;')?'webp':data.startsWith('data:image/png;')?'png':data.startsWith('data:image/gif;')?'gif':'jpg'}


export async function decodePhoto(blob:Blob):Promise<{image:CanvasImageSource;width:number;height:number;close:()=>void}>{
 if(typeof createImageBitmap==='function'){
  try{const image=await createImageBitmap(blob);return {image,width:image.width,height:image.height,close:()=>image.close()};}catch{/* Try the browser's image decoder as a fallback. */}
 }
 const url=URL.createObjectURL(blob);
 try{
  const image=new Image();
  const ready=typeof image.decode==='function'?null:new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('image decode'));});
  image.src=url;
  if(ready)await ready;else await image.decode();
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  if(!width||!height)throw Error('image size');
  return {image,width,height,close:()=>URL.revokeObjectURL(url)};
 }catch{URL.revokeObjectURL(url);throw Error('사진을 열지 못했습니다. JPG 또는 PNG 사진으로 다시 선택해 주세요.');}
}
