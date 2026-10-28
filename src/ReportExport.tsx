import {useState} from 'react';
import {Download} from 'lucide-react';
import type {Inspection} from './inspection-model';
import {createReportImages,exportReport,type ReportImage} from './report';
import {download} from './local-storage';

export function ReportExport({record,name,onDone}:{record:Inspection;name:string;onDone:()=>void}){
 const[mode,setMode]=useState('zip'),[format,setFormat]=useState<'jpg'|'png'>('jpg'),[files,setFiles]=useState<ReportImage[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const run=async(pdf=false)=>{if(busy)return;setBusy(true);setError('');try{if(pdf){await exportReport(record,name,'pdf');onDone()}else if(mode==='zip'){await exportReport(record,name,format);onDone()}else setFiles(await createReportImages(record,name,format))}catch{setError('파일을 만들지 못했습니다. 다시 시도해 주세요.')}finally{setBusy(false)}};
 return <div className="report-export"><fieldset className="conflict-card"><legend>저장 방식</legend><div className="conflict-options">{[['zip','ZIP 묶음'],['images','이미지 직접 저장']].map(([value,label])=><label key={value}><input type="radio" name="report-mode" checked={mode===value} disabled={busy} onChange={()=>{setMode(value);setFiles([])}}/>{label}</label>)}</div></fieldset><label>이미지 형식<select value={format} disabled={busy} onChange={e=>{setFormat(e.target.value as 'jpg'|'png');setFiles([])}}><option value="jpg">JPG</option><option value="png">PNG</option></select></label><p className="hint">{mode==='zip'?'inspection 폴더에 점검표, photos 폴더에 첨부사진을 담아 한 번에 받습니다.':'점검표와 첨부사진을 각각 원하는 파일만 받을 수 있습니다.'}</p><button className="primary full" disabled={busy} onClick={()=>void run()}><Download size={18}/>{busy?'파일 만드는 중…':mode==='zip'?'ZIP 다운로드':'이미지 파일 보기'}</button>{files.length>0&&<div className="image-downloads" aria-live="polite">{files.map(file=><button key={file.path} className="setting-row" onClick={()=>download(file.blob,file.name)}><Download size={18}/>{file.label} · {file.name.split('.').pop()!.toUpperCase()} 받기</button>)}</div>}<button className="secondary full" disabled={busy} onClick={()=>void run(true)}>PDF로 받기</button>{error&&<p role="alert" className="form-error">{error}</p>}</div>
}
