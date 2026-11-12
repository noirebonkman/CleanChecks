import {useState,useEffect} from 'react';
import {ArrowRight,CalendarDays,Check,ChevronRight,ClipboardCheck,Cloud,Download,Trash2,HardDrive,MapPin,Plus,Search} from 'lucide-react';
import {firstIncompleteSection,grades,sections,total,type Inspection} from './inspection-model';
import {knownValue,siteLocation} from './site-details';
import './record-list-controls.css';

type Props={
 records:Inspection[];name:string;query:string;filter:string;canCreate?:boolean;editableStaffId?:string;
 onQuery:(value:string)=>void;onFilter:(value:string)=>void;
 onNew:()=>void;onOpen:(record:Inspection)=>void;onExport:(record:Inspection)=>void;
 onDeleteMany?:(records:Inspection[])=>void;canDelete?:(record:Inspection)=>boolean;
 emptyAction:React.ReactNode;recent?:React.ReactNode;
};
const formatDate=(date:string)=>date.slice(0,10).replaceAll('-','.');
const checked=(record:Inspection)=>sections.reduce((sum,section,si)=>sum+section.items.filter((_,i)=>grades.includes(record.answers[`${si}-${i}`])).length,0);
function draftStepLabel(record:Inspection){
 if(record.pendingCompletion)return '서버 전송 대기';
 const index=firstIncompleteSection(record.answers);
 return index>=0?`이어갈 곳 · ${sections[index].title}`:record.rating?'완료 확인 대기':'이어갈 곳 · 종합평가';
}

export function RecordJournal({canCreate=true,editableStaffId,records,name,query,filter,onQuery,onFilter,onNew,onOpen,onExport,emptyAction,recent,onDeleteMany,canDelete}:Props){
 const [selectionMode,setSelectionMode]=useState(false),[selectedIds,setSelectedIds]=useState<string[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [from,setFrom]=useState(''),[until,setUntil]=useState('');
 const invalidRange=!!from&&!!until&&from>until;
 const search=query.trim().normalize().toLocaleLowerCase('ko-KR');
 const matching=records.filter(r=>!invalidRange&&(!from||r.date.slice(0,10)>=from)&&(!until||r.date.slice(0,10)<=until)&&[r.site.name,r.site.zone,r.site.address].join(' ').normalize().toLocaleLowerCase('ko-KR').includes(search));
 const visible=matching.filter(r=>filter==='전체'||r.status===(filter==='완료'?'complete':'draft')).sort((a,b)=>b.date.localeCompare(a.date)||b.updated.localeCompare(a.updated));
 useEffect(()=>setSelectedIds([]),[query,filter,from,until]);
 const deletable=onDeleteMany?visible.filter(record=>canDelete?.(record)):[];
 const selectedForDeletion=deletable.filter(record=>selectedIds.includes(record.id));
 const selected=visible.find(r=>r.id===selectedId)||visible[0];
 const canResume=(record:Inspection)=>record.status==='draft'&&canCreate&&(!editableStaffId||record.staffId===editableStaffId);
 const counts={전체:matching.length,'작성 중':matching.filter(r=>r.status==='draft').length,완료:matching.filter(r=>r.status==='complete').length};
 const reset=()=>{onQuery('');onFilter('전체');setFrom('');setUntil('')};
 const groups=Array.from(new Set(visible.map(r=>r.date.slice(0,10))));
 const choose=(record:Inspection)=>{
  setSelectedId(record.id);
  if(matchMedia('(max-width: 1100px)').matches)onOpen(record);
 };
 const heading=<header className="journal-heading">
     <div><p className="eyebrow">현장점검</p><h1>점검 기록</h1><p className="journal-intro">{recent?'전체 점검 현황과 내 기록을 확인하세요.':name?`${name}님의 현장 점검을 확인하세요.`:'본인의 이름을 선택하고 점검을 시작하세요.'}</p></div>
     {canCreate&&<button className="primary" onClick={onNew}><Plus size={20}/>새 점검</button>}
    </header>;
 return <div className="content journal-home page-enter">
  {recent&&<>{heading}{recent}</>}
  <div className="journal-layout">
   <section className="journal-list" data-selecting={selectionMode} aria-label="점검 기록 목록">
    {recent?<h2 className="journal-own-heading">{name?name+'님의 점검 기록':'점검 기록'}</h2>:heading}
    <div className="journal-tools"><label className="search journal-search"><Search size={20} aria-hidden="true"/><input aria-label="현장 이름 검색" placeholder="현장명·구역·주소로 찾기" value={query} onChange={e=>onQuery(e.target.value)}/></label>
    <details className="journal-period"><summary><CalendarDays size={17} aria-hidden="true"/>기간 선택{(from||until)&&<span>적용 중</span>}</summary><div className="journal-date-fields"><label>시작일<input type="date" value={from} aria-invalid={invalidRange} aria-describedby={invalidRange?'journal-period-error':undefined} onChange={e=>setFrom(e.target.value)}/></label><label>종료일<input type="date" value={until} aria-invalid={invalidRange} aria-describedby={invalidRange?'journal-period-error':undefined} onChange={e=>setUntil(e.target.value)}/></label></div>{invalidRange&&<p id="journal-period-error" role="alert" className="form-error">종료일을 시작일과 같거나 이후로 선택해 주세요.</p>}{(from||until)&&<button className="text-button" onClick={()=>{setFrom('');setUntil('')}}>기간 해제</button>}</details>
    </div><div className="journal-filters" role="group" aria-label="점검 상태 필터">{(['전체','작성 중','완료'] as const).map(value=><button key={value} aria-pressed={filter===value} onClick={()=>onFilter(value)}>{value}<span>{counts[value]}</span></button>)}</div>
    <div className="journal-list-controls" data-selecting={selectionMode}>
     {selectionMode&&deletable.length>0?<><label className="journal-select-all"><input type="checkbox" aria-label="표시된 삭제 가능 기록 전체 선택" checked={selectedForDeletion.length===deletable.length} onChange={event=>setSelectedIds(event.target.checked?deletable.map(record=>record.id):[])}/>전체 선택</label><span className="journal-selection-count" role="status">{selectedForDeletion.length}건 선택</span><button className="secondary danger" disabled={!selectedForDeletion.length} onClick={()=>onDeleteMany?.(selectedForDeletion)}><Trash2 size={16} aria-hidden="true"/>선택 삭제</button><button className="text-button" onClick={()=>{setSelectionMode(false);setSelectedIds([]);}}>취소</button></>:<><p role="status">{visible.length}건{query.trim()||from||until?' 검색됨':''}</p><div>{(query.trim()||from||until||filter!=='전체')&&<button className="text-button" aria-label="조건 초기화" onClick={reset}>초기화</button>}{deletable.length>0&&<button className="text-button journal-start-selection" onClick={()=>setSelectionMode(true)}>선택 삭제</button>}</div></>}
    </div>
    <div className="journal-records">
     {groups.map(day=><section className="journal-day" key={day} aria-label={formatDate(day)+' 점검'}><div className="journal-day-heading"><h2>{formatDate(day)}</h2><span>{visible.filter(r=>r.date.startsWith(day)).length}건</span></div>{visible.filter(r=>r.date.startsWith(day)).map(r=><div className="journal-selectable-entry" key={r.id}>{selectionMode&&canDelete?.(r)&&<label className="recent-select"><input type="checkbox" aria-label={r.site.name+' 삭제 선택'} checked={selectedIds.includes(r.id)} onChange={event=>setSelectedIds(ids=>event.target.checked?[...ids,r.id]:ids.filter(id=>id!==r.id))}/></label>}<button className={'journal-record '+(selected?.id===r.id?'is-selected':'')} aria-pressed={selected?.id===r.id} aria-label={`${r.site.name} ${r.status==='complete'?'완료':'작성 중'} ${r.date.replace('T',' ').slice(0,16)}`} key={r.id} onClick={()=>choose(r)}><time className="journal-time" dateTime={r.date}>{r.date.slice(11,16)}</time><span className="journal-record-copy"><strong>{r.site.name}</strong><span className="journal-record-meta"><span className={'journal-status '+(r.status==='complete'?'complete':'draft')}>{r.status==='complete'?<Check size={13} aria-hidden="true"/>:null}{r.status==='complete'?'완료':'작성 중'}</span><span>{r.status==='draft'?`${checked(r)} / ${total}항목`:r.rating||r.type||'점검 완료'}</span>{r.modified&&<span className="journal-modified">수정됨</span>}</span><span className="journal-zone">{knownValue(r.site.zone)}</span>{canResume(r)&&<span className="journal-resume-hint">{draftStepLabel(r)}</span>}</span><ChevronRight size={18} aria-hidden="true"/></button>{!selectionMode&&onDeleteMany&&canDelete?.(r)&&<button className="journal-delete-button" aria-label={r.site.name+' 점검표 삭제'} title="점검표 삭제" onClick={()=>onDeleteMany([r])}><Trash2 size={18} aria-hidden="true"/></button>}</div>)}</section>)}
     {!!records.length&&!visible.length&&<div className="empty"><Search size={32}/><h2>조건에 맞는 점검이 없습니다</h2><p>검색어·기간·점검 상태를 바꿔보세요.</p><button className="secondary" onClick={reset}>전체 기록 보기</button></div>}
     {!records.length&&<div className="empty"><ClipboardCheck size={36}/><h2>{name?(canCreate?'첫 점검을 시작해 보세요':'저장된 점검이 없습니다'):'점검자를 선택해 주세요'}</h2><p>{name?(canCreate?'새 점검을 누르면 현장을 선택할 수 있습니다.':'조회 전용 계정입니다. 작성 권한은 어드민에게 문의해 주세요.'):'본인의 이름을 눌러 선택합니다.'}</p>{name?(canCreate&&<button className="secondary" onClick={onNew}>첫 점검 작성</button>):emptyAction}</div>}
    </div>
    <p className="journal-local">{editableStaffId?<><Cloud size={14} aria-hidden="true"/>서버와 동기화되는 점검 기록</>:<><HardDrive size={14} aria-hidden="true"/>이 기기에 저장되는 개인 점검 기록</>}</p>
   </section>
   <section className="journal-detail" aria-label="선택한 점검 요약">
    {selected?<div className="journal-detail-content page-enter" key={selected.id}>
     <div className="journal-detail-label"><span className={'journal-status '+(selected.status==='complete'?'complete':'draft')}>{selected.status==='complete'?<Check size={13}/>:null}{selected.status==='complete'?'완료':'작성 중'}</span><span>점검 요약</span></div>
     <h2>{selected.site.name}</h2><p className="journal-detail-date">{formatDate(selected.date)} · {selected.date.slice(11,16)}{selected.modified?' · 수정됨':''}</p>
     <p className="journal-address"><MapPin size={16} aria-hidden="true"/>{knownValue(siteLocation(selected.site))}</p>
     <dl className="journal-info"><div><dt>점검 관리자</dt><dd>{name}</dd></div><div><dt>점검 유형</dt><dd>{knownValue(selected.type)}</dd></div><div><dt>담당 기사</dt><dd>{knownValue(selected.technician)}</dd></div><div><dt>작업 주기</dt><dd>{knownValue(selected.cycle)}</dd></div></dl>
     <div className="journal-progress"><div><span>{selected.status==='complete'?'점검 완료':'점검 진행'}</span><strong>{checked(selected)} / {total}항목</strong></div><div className="progress" role="progressbar" aria-label="선택한 점검의 항목 진행률" aria-valuemin={0} aria-valuemax={total} aria-valuenow={checked(selected)}><i style={{width:`${checked(selected)/total*100}%`}}/></div></div>
     <h3 className="journal-section-title">구역별 점검</h3><ul className="journal-sections">{sections.map((section,si)=>{const done=section.items.filter((_,i)=>grades.includes(selected.answers[`${si}-${i}`])).length;const issues=section.items.filter((_,i)=>['B','C'].includes(selected.answers[`${si}-${i}`])).length;return <li key={section.title}><span>{section.title}</span><span className={issues?'journal-needs-action':''}>{issues?`B·C ${issues}개`:done===section.items.length?<><Check size={15} aria-hidden="true"/>확인 완료</>:`${done} / ${section.items.length}`}</span></li>})}</ul>
     {selected.rating&&<div className="journal-result"><span>종합평가</span><strong>{selected.rating}</strong></div>}
     {selected.issues?.trim()&&<div className="journal-issues"><h3>주요 지적사항</h3><p>{selected.issues}</p></div>}
     {(selected.action?.trim()||selected.actionState||selected.assignee?.trim()||selected.due)&&<div className="journal-followup"><h3>개선 조치</h3>{selected.action?.trim()&&<p>{selected.action}</p>}<dl>
      <div><dt>조치 상태</dt><dd>{knownValue(selected.actionState)}</dd></div>
      <div><dt>조치 담당자</dt><dd>{knownValue(selected.assignee)}</dd></div>
      <div><dt>완료 예정일</dt><dd>{selected.due?<time dateTime={selected.due}>{formatDate(selected.due)}</time>:'미확인'}</dd></div>
     </dl></div>}
     <div className="journal-actions"><button className="primary" onClick={()=>onOpen(selected)}>{canResume(selected)?(selected.pendingCompletion?'전송 이어서 하기':'이어서 점검하기'):'점검표 열기'}<ArrowRight size={18}/></button>{selected.status==='complete'&&<button className="secondary" onClick={()=>onExport(selected)}><Download size={18}/>내보내기</button>}</div>
    </div>:<div className="journal-detail-empty"><ClipboardCheck size={38}/><h2>점검 기록을 한눈에</h2><p>왼쪽에서 기록을 선택하면 현장 정보와<br/>구역별 점검 결과를 확인할 수 있습니다.</p></div>}
   </section>
  </div>
 </div>;
}
