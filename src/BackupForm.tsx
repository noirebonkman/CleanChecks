import {useState} from 'react';
import type {Inspection} from './inspection-model';

export function BackupForm({records,onSave}:{records:Inspection[];onSave:(options:{from:string;until:string;photos:boolean;format:'json'|'zip';password:string})=>Promise<void>}){
 const[from,setFrom]=useState(''),[until,setUntil]=useState(''),[photos,setPhotos]=useState(true),[format,setFormat]=useState<'json'|'zip'>('json'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const selected=records.filter(r=>(!from||r.date.slice(0,10)>=from)&&(!until||r.date.slice(0,10)<=until)),invalid=!!from&&!!until&&from>until;
 return <form onSubmit={async e=>{e.preventDefault();if(busy||invalid)return;const form=new FormData(e.currentTarget);if(form.get('pass')!==form.get('again')){setError('비밀번호가 일치하지 않습니다.');return}setBusy(true);setError('');try{await onSave({from,until,photos,format,password:String(form.get('pass'))})}catch(e){setError(e instanceof Error?e.message:'백업하지 못했습니다.')}finally{setBusy(false)}}}>
  <p>선택한 점검자의 기록만 저장합니다. 기간을 비우면 전체 기록을 포함합니다.</p>
  <div className="form-grid"><label>시작일<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>종료일<input type="date" value={until} onChange={e=>setUntil(e.target.value)}/></label></div>
  {invalid&&<p role="alert" className="form-error">종료일을 시작일 이후로 선택해 주세요.</p>}
  <label>백업 형식<select value={format} onChange={e=>setFormat(e.target.value as 'json'|'zip')}><option value="json">JSON · 기존 방식</option><option value="zip">ZIP · 사진을 나눠 담은 압축 백업</option></select></label>
  <label className="backup-photo-option"><input type="checkbox" checked={photos} onChange={e=>setPhotos(e.target.checked)}/>사진 포함</label>
  <p className="hint">{selected.length}건 · 사진 {photos?selected.reduce((n,r)=>n+r.photos.length,0):0}장{!photos?' · 사진 없는 사본입니다. 원본 사진은 기기에 유지됩니다.':''}</p>
  <label>파일 비밀번호 (8자 이상)<input name="pass" type="password" minLength={8} required/></label><label>비밀번호 확인<input name="again" type="password" minLength={8} required/></label>
  {error&&<p role="alert" className="form-error">{error}</p>}<button className="primary full" disabled={busy||invalid}>{busy?'백업 중…':'데이터 파일 저장'}</button>
 </form>;
}
