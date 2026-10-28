import {useEffect,useState} from 'react';
import type {Inspection} from './inspection-model';

export function StorageInformation({records}:{records:Inspection[]}){
 const[usage,setUsage]=useState<{usage?:number;quota?:number}>({}),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;if(navigator.storage?.estimate)void navigator.storage.estimate().then(value=>{if(active)setUsage(value)}).catch(()=>{});return()=>{active=false}},[records]);
 const bytes=records.reduce((sum,r)=>sum+r.photos.reduce((n,p)=>n+Math.floor(p.data.length*.75),0),0),mb=(n:number)=>(n/1024/1024).toFixed(1);
 const nearLimit=!!usage.quota&&(usage.usage||0)/usage.quota>=.8;
 return <div className="storage-information"><p>내 점검 {records.length}건 · 사진 {records.reduce((n,r)=>n+r.photos.length,0)}장 · 사진 약 {mb(bytes)}MB</p>{usage.quota&&<p className="hint">이 사이트 저장 공간: {mb(usage.usage||0)} / {mb(usage.quota)}MB</p>}{nearLimit&&<p role="alert" className="form-error">저장 공간이 얼마 남지 않았습니다. 먼저 백업해 주세요.</p>}{navigator.storage?.persist&&<button className="text-button" onClick={async()=>{try{setMessage(await navigator.storage.persist()?'브라우저의 자동 공간 정리로부터 보호하도록 설정되었습니다.':'브라우저에서 저장 보호를 허용하지 않았습니다. 백업 파일을 보관해 주세요.')}catch{setMessage('이 브라우저에서는 저장 보호를 설정할 수 없습니다.')}}}>기기 저장 보호 요청</button>}{message&&<p role="status" className="hint">{message} 브라우저 데이터 직접 삭제까지 막지는 못합니다.</p>}</div>;
}
