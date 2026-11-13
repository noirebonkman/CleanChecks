import type {Site,Photo} from './inspection-model';
import {uid} from './inspection-model';
import {download} from './local-storage';
import {siteDetailFields} from './site-details';

const headers = ['순번','구분','지역','계약기간','업체명','근무형태','요일','주소','중요도','현장 연락처','점검 구역·특이사항','현장 담당자','담당자 연락처'];
const detailColumns = {company:1,contractPeriod:3,workDays:6,contact:9,inspectionNotes:10,contactName:11,contactPhone:12};
const totals = new Set(['계','합계','소계','총계','요약','서머리']);

export async function readSites(file:File) {
 const XLSX=await import('xlsx');
 const workbook=XLSX.read(await file.arrayBuffer(),{type:'array'});
 const sheet=workbook.Sheets[workbook.SheetNames[0]];
 if(!sheet) return {valid:[],invalid:[]};
 const end=XLSX.utils.decode_range(sheet['!ref']||'A1:J1').e;
 const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:false,range:{s:{r:0,c:0},e:{r:end.r,c:Math.max(10,end.c)}}})
  .map(row=>row.map(value=>String(value??'').trim()));
 const headerIndex=rows.findIndex(row=>row[0]==='순번'&&row[4]==='업체명');
 const modern=headerIndex>=0;
 const valid:Site[]=[],invalid:{row:number;reason:string}[]=[];
 rows.forEach((row,index)=>{
  if(modern&&index<=headerIndex)return;
  const [name,zone,address,priority,cycle]= (modern?[4,2,7,8,5]:[1,2,3,4,5]).map(i=>row[i]||'');
  if(totals.has(name.replace(/\s/g,''))||(!modern&&['현장명','현장이름'].includes(name)))return;
  if(!(modern?row.slice(1,11):row.slice(1,6)).some(Boolean))return;
  if(!name){invalid.push({row:index+1,reason:'업체명이 비어 있습니다.'});return;}
  const details=modern?Object.fromEntries(siteDetailFields.flatMap(({key})=>{
   const value=row[detailColumns[key]];
   return value?[[key,value]]:[];
  })):{};
  valid.push({id:uid(),name,zone,address,priority,cycle,...details});
 });
 return {valid,invalid};
}
export function planSiteImport(existing:Site[],incoming:Site[]){
 let next=[...existing],added=0,corrected=0,duplicate=0,updated=0;
 const seen=new Set<string>();
 for(const site of incoming){
  const key=JSON.stringify([site.name,site.address]);if(seen.has(key)){duplicate++;continue}seen.add(key);
  const names=next.filter(x=>x.name===site.name);
  const same=names.find(x=>x.address===site.address) ||
   (names.length===1&&(!site.address||!names[0].address)&&incoming.filter(x=>x.name===site.name).length===1?names[0]:undefined);
  // Repair only the exact old B-origin shift, corroborated by all three old fields.
  // Two source names sharing the same fingerprint are ambiguous and never auto-repaired.
  const sourceMatches=incoming.filter(x=>x.zone===site.zone&&x.address===site.address&&x.priority===site.priority);
  const shifted=sourceMatches.length===1&&site.priority?next.filter(x=>x.id!==same?.id&&x.name===site.zone&&x.zone===site.address&&x.address===site.priority):[];
  if(shifted.length){
   const ids=new Set(shifted.map(x=>x.id));
   if(same)next=next.filter(x=>!ids.has(x.id));
   else{const keep=shifted[0].id;next=next.filter(x=>!ids.has(x.id)||x.id===keep).map(x=>x.id===keep?{...site,id:keep}:x)}
   corrected+=shifted.length;
  }else if(same){
   const fields=['zone','address','priority','cycle',...siteDetailFields.map(({key})=>key)] as const;
   const changes=fields.filter(field=>site[field]&&site[field]!==same[field]);
   if(!changes.length)duplicate++;
   else{
    const refreshed={...same};
    for(const field of changes)refreshed[field]=site[field]!;
    next=next.map(item=>item.id===same.id?refreshed:item);
    updated++;
   }
  }else{next.push(site);added++}
 }
 return {next,added,corrected,duplicate,updated};
}
export async function exportSites(sites:Site[]){
 const XLSX=await import('xlsx'),workbook=XLSX.utils.book_new();
 const sheet=XLSX.utils.aoa_to_sheet([headers,...sites.map((s,i)=>[i+1,s.company||'',s.zone,s.contractPeriod||'',s.name,s.cycle,s.workDays||'',s.address,s.priority,s.contact||'',s.inspectionNotes||'',s.contactName||'',s.contactPhone||''])]);
 sheet['!cols']=[8,18,12,27,32,16,19,55,10,23,48,18,23].map(wch=>({wch}));
 sheet['!autofilter']={ref:sheet['!ref']!};
 XLSX.utils.book_append_sheet(workbook,sheet,'현장 목록');
 download(new Blob([XLSX.write(workbook,{type:'array',bookType:'xlsx'})]),'현장목록.xlsx');
}
export async function exportSiteImportErrors(errors:{row:number;reason:string}[]) {
 const XLSX=await import('xlsx'),book=XLSX.utils.book_new();
 const sheet=XLSX.utils.aoa_to_sheet([['원본 엑셀 행','등록하지 못한 이유'],...errors.map(error=>[error.row,error.reason])]);
 sheet['!cols']=[{wch:18},{wch:60}];
 XLSX.utils.book_append_sheet(book,sheet,'등록 오류');
 download(new Blob([XLSX.write(book,{type:'array',bookType:'xlsx'})]),'현장등록_오류목록.xlsx');
}
export async function compress(file:File):Promise<Photo>{
 if(!file.type.startsWith('image/'))throw Error('사진 파일을 선택해 주세요.');
 const img=await decodePhoto(file);
 try{
  let scale=Math.min(1,1600/Math.max(img.width,img.height));
  const canvas=document.createElement('canvas');
  for(let attempt=0;attempt<7;attempt++,scale*=.75){
   canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
   const context=canvas.getContext('2d');if(!context)throw Error('사진을 처리하지 못했습니다.');
   context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img.image,0,0,canvas.width,canvas.height);
   for(const quality of [.8,.65,.5]){
    let data='';try{data=canvas.toDataURL('image/webp',quality)}catch{}
    if(!data.startsWith('data:image/webp;base64,'))data=canvas.toDataURL('image/jpeg',quality);
    if(/^data:image\/(webp|jpeg);base64,/.test(data)&&data.split(',')[1].length<=400_000)return {id:uid(),data,name:file.name};
   }
  }
  throw Error('사진을 300KB 이하로 압축하지 못했습니다.');
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
