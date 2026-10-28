import {derive,encrypt,decrypt,unpack} from './local-storage';
import {validInspection} from './record-validation';
import {photoExtension} from './site-import-and-photos';

export async function archivePersonal(payload:any,password:string){
 const {default:JSZip}=await import('jszip');
 const salt=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),key=await derive(password,salt),zip=new JSZip();
 const records=[];
 for(let ri=0;ri<payload.records.length;ri++){
  const r=payload.records[ri],photos=[];
  for(let pi=0;pi<r.photos.length;pi++){
   const photo=r.photos[pi],path=`photos/${ri}_${pi}.${photoExtension(photo.data)}.enc`;
   zip.file(path,JSON.stringify(await encrypt(photo.data,key)));
   photos.push({id:photo.id,name:photo.name,archivePath:path});
  }
  records.push({...r,photos});
 }
 zip.file('records.enc',JSON.stringify(await encrypt({...payload,records},key)));
 zip.file('manifest.json',JSON.stringify({format:'lucent-personal-archive',version:1,salt}));
 return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
}
export async function readPersonalBackup(file:File,password:string){
 if(!file.name.toLowerCase().endsWith('.zip'))return unpack(await file.text(),password);
 const {default:JSZip}=await import('jszip');
 const zip=await JSZip.loadAsync(await file.arrayBuffer()),manifest=JSON.parse(await zip.file('manifest.json')?.async('string')||'null');
 if(manifest?.format!=='lucent-personal-archive'||manifest.version!==1||typeof manifest.salt!=='string')throw Error('지원하는 점검 백업 파일이 아닙니다.');
 const key=await derive(password,manifest.salt),recordFile=zip.file('records.enc');if(!recordFile)throw Error('점검 데이터가 없습니다.');
 const payload=await decrypt<any>(JSON.parse(await recordFile.async('string')),key);
 if(payload?.kind!=='lucent-personal'||!Array.isArray(payload.records))throw Error('점검 데이터가 올바르지 않습니다.');
 for(const r of payload.records){
  if(!Array.isArray(r.photos))throw Error('사진 정보가 올바르지 않습니다.');
  for(const p of r.photos){
   if(typeof p.archivePath!=='string'||!/^photos\/\d+_\d+\.(webp|jpg|png|gif)\.enc$/.test(p.archivePath))throw Error('사진 경로가 올바르지 않습니다.');
   const entry=zip.file(p.archivePath);if(!entry)throw Error('백업의 첨부사진이 누락되었습니다.');
   p.data=await decrypt<string>(JSON.parse(await entry.async('string')),key);delete p.archivePath;
  }
  if(!validInspection(r))throw Error('백업의 점검 내용이 손상되었습니다.');
 }
 return payload;
}
