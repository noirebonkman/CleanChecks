import {jsPDF} from 'jspdf';
import type {Inspection} from './inspection-model';
import {renderReportPages,reportSize} from './report-layout';
import {download} from './local-storage';
import JSZip from 'jszip';
import {decodePhoto} from './site-import-and-photos';

// Canvas renders Korean with the same fonts available to the device; no remote font requests.
export type ReportImage={name:string;path:string;label:string;blob:Blob};
export async function createReportImages(r:Inspection,name:string,format:'png'|'jpg'):Promise<ReportImage[]>{
 const files:ReportImage[]=[];
 const add=(path:string,label:string,data:string)=>{const binary=atob(data.split(',')[1]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));files.push({name:path.split('/').pop()!,path,label,blob:new Blob([bytes],{type:data.slice(5,data.indexOf(';'))})})};
 renderReportPages(r,name).forEach((page,i)=>add(`inspection/sheet_${String(i+1).padStart(2,'0')}.${format}`,`점검표 ${i+1}`,page.toDataURL(format==='png'?'image/png':'image/jpeg',.94)));
 for(let i=0;i<r.photos.length;i++){
  const data=await reportPhoto(r.photos[i].data,format);
  add('photos/photo_'+String(i+1).padStart(2,'0')+'.'+format,'첨부사진 '+(i+1),data);
 }
 return files;
}
export async function createReportPdf(r:Inspection,name:string){
 const {width,height}=reportSize;
 const pages=renderReportPages(r,name),pdf=new jsPDF({unit:'px',format:[width,height]});
 pages.forEach((page,i)=>{if(i)pdf.addPage();pdf.addImage(page.toDataURL('image/jpeg',.9),'JPEG',0,0,width,height)});
 for(const photo of r.photos){
  const data=await reportPhoto(photo.data,'jpg'),image=new Image();image.src=data;await image.decode();
  const scale=Math.min((width-160)/image.width,(height-160)/image.height);
  pdf.addPage();pdf.addImage(data,'JPEG',(width-image.width*scale)/2,(height-image.height*scale)/2,image.width*scale,image.height*scale);
 }
 return pdf;
}
export async function exportReport(r:Inspection,name:string,format:'pdf'|'png'|'jpg'){
 const base=`${r.site.name}_${r.date.slice(0,10)}`.replace(/[\\/:*?"<>|]/g,'_');
 if(format==='pdf'){const pdf=await createReportPdf(r,name);pdf.save(base+'.pdf');}
 else {const zip=new JSZip();for(const file of await createReportImages(r,name,format))zip.file(file.path,await file.blob.arrayBuffer());download(await zip.generateAsync({type:'blob'}),base+'_'+format+'.zip');}
}


export async function reportPhoto(data:string,format:'png'|'jpg'){
 const mime=format==='png'?'image/png':'image/jpeg';
 if(data.startsWith('data:'+mime+';base64,'))return data;
 const raw=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));
 const image=await decodePhoto(new Blob([raw],{type:data.slice(5,data.indexOf(';'))}));
 try{
  const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
  const ctx=c.getContext('2d');if(!ctx)throw Error('사진 내보내기를 준비하지 못했습니다.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image.image,0,0);
  const result=c.toDataURL(mime,.94);
  if(!result.startsWith('data:'+mime+';base64,'))throw Error('선택한 사진 형식으로 변환하지 못했습니다.');
  return result;
 }finally{image.close();}
}
