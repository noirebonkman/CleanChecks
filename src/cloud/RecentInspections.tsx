import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Filter, RefreshCw, Search, X } from 'lucide-react';
import { gradeNames, sections, type Grade, type Inspection, type Site } from '../inspection-model';
import { SiteInformation } from '../SiteInformation';
import { knownValue } from '../site-details';
import { useBackNavigation } from '../useBackNavigation';
import { canDeleteInspection, type InspectionDeleteTarget } from './inspection-deletion';
import { request, type ServerUser } from './client';
import { useCalendarLive } from './calendar-live';
import './recent-inspections.css';

type Inspector = {id:string;name:string};
type RecentItem = {id:string;inspectorId:string;siteName:string;inspectorName:string;date:string;status:'draft'|'complete';modified:boolean;rating?:string;issueCount?:number;updated:string;revision:number};
type RecentPage = {items?:RecentItem[];inspectors?:Inspector[];nextCursor?:string|null;version:string;unchanged?:boolean};
type Detail = {record:Inspection;inspectorName:string;revision:number;updated:string};
type Filters = {q:string;inspector:string;from:string;until:string;status:string};
const emptyFilters:Filters={q:'',inspector:'',from:'',until:'',status:''};
const displayDate = (value:string) => value.replace('T',' ').slice(0,16).replaceAll('-','.');
function savedFilters(key:string):Filters {
    try {const value=JSON.parse(sessionStorage.getItem(key)||'{}');return Object.fromEntries(Object.keys(emptyFilters).map(key=>[key,typeof value[key]==='string'?value[key]:''])) as Filters;}
    catch{return {...emptyFilters};}
}

export function RecentInspections({user,sites,mode='recent',onViewAll,onBack,onDetailState,onDelete}: {
    onDelete?:(targets:InspectionDeleteTarget[])=>void;user:ServerUser;sites:Site[];mode?:'recent'|'all';onViewAll?:()=>void;onBack?:()=>void;onDetailState?:(open:boolean,close:()=>void)=>void;
}) {
    const all=mode==='all',preferenceKey='lucent-recent-collapsed:'+user.id;
    const filterKey='lucent-inspection-filters:'+user.id;
    const [collapsed,setCollapsed]=useState(()=>{try{return !all&&localStorage.getItem(preferenceKey)==='true';}catch{return false;}});
    const [filters,setFilters]=useState<Filters>(()=>savedFilters(filterKey));
    const [search,setSearch]=useState(filters.q),[filtersOpen,setFiltersOpen]=useState(false);
    const [people,setPeople]=useState<Inspector[]>([]);
    const [selectionMode,setSelectionMode]=useState(false),[selectedIds,setSelectedIds]=useState<string[]>([]);
    const [items,setItems]=useState<RecentItem[]>([]),[nextCursor,setNextCursor]=useState<string|null>(null);
    const [busy,setBusy]=useState(false),[error,setError]=useState(''),[checkedAt,setCheckedAt]=useState('');
    const [selected,setSelected]=useState<RecentItem|null>(null);
    const [detail,setDetail]=useState<Detail|null>(null),[detailError,setDetailError]=useState('');
    const [detailTick,setDetailTick]=useState(0),[photo,setPhoto]=useState('');
    const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLElement|null>(null),returnScroll=useRef(0);
    const pages=useRef(1),selectedRef=useRef(selected);selectedRef.current=selected;
    const refreshRef=useRef<(force?:boolean)=>void>(()=>{});
    const close=()=>{setSelected(null);setPhoto('');setDetail(null);setDetailError('');};
    useBackNavigation({modal:!!selected&&!onDetailState,drawer:false,screen:'home',closeModal:close,closeDrawer:()=>{},home:close});
    const {connected:live}=useCalendarLive(()=>refreshRef.current(),null,'inspections-changed',!collapsed);
    useEffect(()=>{const timer=setTimeout(()=>setSearch(filters.q),250);return()=>clearTimeout(timer);},[filters.q]);
    useEffect(()=>{try{sessionStorage.setItem(filterKey,JSON.stringify(filters));}catch{}},[filterKey,filters]);
    const activeFilters=Object.values(filters).filter(Boolean).length;
    const invalidRange=all&&!!filters.from&&!!filters.until&&filters.from>filters.until;
    const params=new URLSearchParams(all?{q:search,inspector:filters.inspector,from:filters.from,until:filters.until,status:filters.status}:{});
    const queryKey=params.toString();
    useEffect(()=>{
        if(collapsed||invalidRange)return;
        let stopped=false,pending=false,queued=false,version='',checked=0;
        const abort=new AbortController();pages.current=1;setSelectedIds([]);setItems([]);setNextCursor(null);setError('');
        async function pull(force=false){
            if(stopped||!navigator.onLine||document.visibilityState==='hidden')return;
            if(pending){queued=true;return;}pending=true;setBusy(true);
            try{
                const head=await request<RecentPage>('recent-inspections?'+queryKey+(!force&&version?'&since='+encodeURIComponent(version):''),{signal:abort.signal});
                if(stopped)return;
                if(!head.unchanged){
                    let rows=head.items||[],cursor=head.nextCursor||null;
                    if(all)for(let page=1;page<pages.current&&cursor;page++){
                        const next=await request<RecentPage>('recent-inspections?'+queryKey+'&cursor='+encodeURIComponent(cursor),{signal:abort.signal});
                        if(next.version!==head.version)throw Error('점검 목록이 갱신 중입니다. 다시 확인해 주세요.');
                        rows=[...rows,...(next.items||[])];cursor=next.nextCursor||null;
                    }
                    if(stopped)return;
                    setItems(rows);setNextCursor(cursor);version=head.version;
                    if(head.inspectors)setPeople(head.inspectors.sort((a,b)=>a.name.localeCompare(b.name,'ko')));
                    if(selectedRef.current)setDetailTick(value=>value+1);
                }
                checked=Date.now();setError('');setCheckedAt(new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));
            }catch(cause){if(!stopped)setError(cause instanceof Error?cause.message:'점검을 불러오지 못했습니다.');}
            finally{pending=false;if(!stopped){setBusy(false);if(queued){queued=false;void pull();}}}
        }
        refreshRef.current=(force=false)=>void pull(force);void pull(true);
        const refresh=()=>void pull(),offline=()=>setError('인터넷 연결이 끊겼습니다. 연결되면 다시 확인합니다.');
        const timer=window.setInterval(()=>{if(!live.current||Date.now()-checked>=30000)refresh();},5000);
        document.addEventListener('visibilitychange',refresh);window.addEventListener('online',refresh);window.addEventListener('offline',offline);window.addEventListener('cleanchecks:inspections-changed',refresh);
        return()=>{stopped=true;abort.abort();refreshRef.current=()=>{};window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('online',refresh);window.removeEventListener('offline',offline);window.removeEventListener('cleanchecks:inspections-changed',refresh);};
    },[queryKey,collapsed,all,invalidRange,live]);
    useEffect(()=>{
        if (!selected) return;
        const abort=new AbortController();
        setDetailError('');
        void request<Detail>('recent-inspections/'+encodeURIComponent(selected.id),{signal:abort.signal}).then(value=>{
            if(!abort.signal.aborted){setDetail(value);}
        }).catch(cause=>{if(!abort.signal.aborted){setDetail(null);setDetailError(cause instanceof Error?cause.message:'점검표를 열지 못했습니다.');}});
        return()=>abort.abort();
    },[selected?.id,detailTick]);
    useEffect(()=>{
        if(!selected)return;
        onDetailState?.(true,close);
        dialog.current?.showModal();
        const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
        return()=>{onDetailState?.(false,close);document.body.style.overflow=overflow;requestAnimationFrame(()=>{window.scrollTo({top:returnScroll.current,behavior:'instant'});opener.current?.focus({preventScroll:true});});};
    },[!!selected]);
    function toggle(){setCollapsed(value=>{const next=!value;try{localStorage.setItem(preferenceKey,String(next));}catch{}return next;});}
    function open(item:RecentItem,button:HTMLButtonElement){opener.current=button;returnScroll.current=window.scrollY;setDetail(null);setPhoto('');setSelected(item);}
    const deletionTarget=(item:RecentItem):InspectionDeleteTarget=>({id:item.id,ownerId:item.inspectorId,siteName:item.siteName,date:item.date,revision:item.revision});
    const deletable=onDelete?items.filter(item=>canDeleteInspection(user,deletionTarget(item))):[];
    const selectedForDeletion=deletable.filter(item=>selectedIds.includes(item.id));
    const title=all?'전체 점검 기록':'최근 점검';
    function changeFilter(key:keyof Filters,value:string){setFilters(current=>({...current,[key]:value}));}
    return <section className={all?'recent-page':'recent-inspections'} aria-label={title}>
        {all?<header className="all-inspections-heading"><button className="inspection-home-link" onClick={onBack}><ArrowLeft size={18} aria-hidden="true"/>현장점검</button><h1>전체 점검 기록</h1><p>점검표를 누르면 내용을 바로 확인합니다.</p></header>:<header className="recent-heading">
            <button type="button" className="recent-toggle" aria-label={title} onClick={toggle} aria-expanded={!collapsed} aria-controls="recent-inspection-items"><ChevronDown size={18} aria-hidden="true"/><span className="recent-title">{title}</span><span>전체 점검자</span></button>
            <button className="text-button" onClick={onViewAll}>전체 기록<ChevronRight size={15} aria-hidden="true"/></button>
        </header>}
        {all&&<div className="all-inspections-search">
            <label className="recent-search"><Search size={18} aria-hidden="true"/><span className="sr-only">현장 검색</span><input type="search" placeholder="현장명·지역·주소 검색" value={filters.q} maxLength={100} onChange={event=>changeFilter('q',event.target.value)}/></label>
            <button className="secondary recent-filter-toggle" aria-expanded={filtersOpen} aria-controls="all-inspection-filters" onClick={()=>setFiltersOpen(value=>!value)}><Filter size={17} aria-hidden="true"/>필터{activeFilters?' '+activeFilters:''}</button>
            <div id="all-inspection-filters" className="all-inspection-filters" data-open={filtersOpen}>
                <label>점검자<select value={filters.inspector} onChange={event=>changeFilter('inspector',event.target.value)}><option value="">전체 점검자</option>{people.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
                <label>상태<select value={filters.status} onChange={event=>changeFilter('status',event.target.value)}><option value="">전체 상태</option><option value="complete">완료</option><option value="draft">작성 중</option></select></label>
                <label>시작일<input type="date" value={filters.from} onChange={event=>changeFilter('from',event.target.value)}/></label>
                <label>종료일<input type="date" value={filters.until} onChange={event=>changeFilter('until',event.target.value)}/></label>
            </div>
            {!!activeFilters&&<button className="text-button recent-reset" onClick={()=>{setSearch('');setFilters({...emptyFilters});}}>검색·필터 초기화</button>}
            {invalidRange&&<p role="alert" className="recent-filter-error">종료일은 시작일 이후로 선택해 주세요.</p>}
        </div>}
        <div className="recent-collapse" data-collapsed={collapsed&&!all} inert={collapsed&&!all} aria-hidden={collapsed&&!all}><div id="recent-inspection-items">
            <div className="recent-list-controls"><div className="recent-list-status"><span role="status">{busy?'확인 중…':checkedAt?checkedAt+' 확인':''}</span><button className="icon" aria-label="최근 점검 새로고침" disabled={busy||invalidRange} onClick={()=>refreshRef.current(true)}><RefreshCw size={15}/></button></div>
            {all&&onDelete&&deletable.length>0&&<div className="inspection-selection-toolbar">
                {!selectionMode?<button className="secondary" onClick={()=>setSelectionMode(true)}>선택 삭제</button>:<><label><input type="checkbox" aria-label="표시된 삭제 가능 기록 전체 선택" checked={deletable.length>0&&selectedForDeletion.length===deletable.length} onChange={event=>setSelectedIds(event.target.checked?deletable.map(item=>item.id):[])}/>표시된 기록</label><span>{selectedForDeletion.length}건 선택</span><button className="secondary danger" disabled={!selectedForDeletion.length||invalidRange} onClick={()=>onDelete?.(selectedForDeletion.map(deletionTarget))}>선택 삭제</button><button className="text-button" onClick={()=>{setSelectionMode(false);setSelectedIds([]);}}>취소</button></>}
            </div>}
            </div>
            {error&&<div className="recent-error" role="alert"><span>{error}{items.length?' 기존 목록을 유지합니다.':''}</span><button className="secondary" onClick={()=>refreshRef.current(true)} disabled={busy}>다시 확인</button></div>}
            {!invalidRange&&<><div className="recent-table-head" aria-hidden="true"><span>현장·점검 결과</span><span>점검자</span><span>점검일시</span><span>상태</span></div>
            <div className="recent-rows" data-expanded={all}>
                {items.map(item=><div className="recent-entry" key={item.id}>{all&&selectionMode&&onDelete&&canDeleteInspection(user,deletionTarget(item))&&<label className="recent-select"><input type="checkbox" aria-label={item.siteName+' 삭제 선택'} checked={selectedIds.includes(item.id)} onChange={event=>setSelectedIds(ids=>event.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/></label>}<button className="recent-row" onClick={event=>open(item,event.currentTarget)} aria-label={item.siteName+' · '+item.inspectorName+' · '+displayDate(item.date)+' · '+(item.status==='complete'?'완료':'작성 중')}>
                    <span className="recent-site"><span>{item.siteName}{item.modified&&<small>수정됨</small>}</span><span className="recent-result-preview">{item.rating|| (item.status==='draft'?'점검 작성 중':'종합평가 없음')}{item.issueCount?' · 지적 '+item.issueCount+'건':''}</span></span>
                    <span className="recent-person">{item.inspectorName}</span><time dateTime={item.date}>{displayDate(item.date)}</time>
                    <span className="recent-state" data-state={item.status}>{item.status==='complete'?<Check size={12} aria-hidden="true"/>:null}{item.status==='complete'?'완료':'작성 중'}</span>
                </button></div>)}
            </div>
            {!items.length&&!busy&&!error&&<p className="recent-empty">{all?'조건에 맞는 점검 기록이 없습니다.':'저장된 점검이 없습니다.'}</p>}
            {all&&nextCursor&&<button className="secondary recent-load-more" disabled={busy} onClick={()=>{pages.current++;refreshRef.current(true);}}>이전 점검 더 보기</button>}</>}
        </div></div>
        {selected&&<dialog ref={dialog} className="recent-inspection-dialog" aria-labelledby="recent-detail-heading" onCancel={event=>{event.preventDefault();if(photo)setPhoto('');else close();}}>
            <header className="recent-detail-toolbar"><button className="inspection-home-link" onClick={close}><ArrowLeft size={17} aria-hidden="true"/>현장점검</button><span>조회 전용</span><button className="icon" aria-label="점검 목록으로 돌아가기" onClick={close}><X size={21}/></button></header>
            <div className="recent-detail-body"><h2 id="recent-detail-heading">{detail?.record.site.name||selected.siteName}</h2>
                {detailError?<div role="alert" className="recent-error"><p>{detailError}</p><button className="secondary" onClick={()=>setDetailTick(value=>value+1)}>다시 확인</button></div>:!detail?<p role="status">점검표를 여는 중입니다…</p>:photo?<div className="recent-full-photo"><button className="secondary" onClick={()=>setPhoto('')}>점검표로 돌아가기</button><img src={photo} alt="점검 현장 사진 전체 보기"/></div>:<>
                    <p className="recent-readonly-note">{detail.inspectorName} · {displayDate(detail.record.date)} · 다른 점검표의 내용은 이 화면에서 수정하지 않습니다.</p>
                    <section className="recent-result"><h3>점검 종합 결과</h3><dl>{[
                        ['종합평가',detail.record.rating],['주요 지적사항',detail.record.issues],['개선 조치 내용',detail.record.action],['조치 담당자',detail.record.assignee],['완료 예정일',detail.record.due],['조치 확인',detail.record.actionState],['특이사항',detail.record.notes],
                    ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{knownValue(value)}</dd></div>)}</dl></section>
                    <details className="recent-site-details"><summary>현장 상세정보</summary><SiteInformation inspection={detail.record} inspectorName={detail.inspectorName} currentSite={sites.find(site=>site.id===detail.record.site.id)}/></details>
                    <div className="recent-checklist">{sections.map((section,sectionIndex)=><section key={section.title}><h3>{sectionIndex+1}. {section.title}</h3><dl>{section.items.map((item,itemIndex)=>{const grade=detail.record.answers[sectionIndex+'-'+itemIndex] as Grade|undefined;return <div key={item}><dt>{item}</dt><dd data-grade={grade}>{grade?grade+' · '+gradeNames[grade]:'미확인'}</dd></div>;})}</dl></section>)}</div>
                    {!!detail.record.photos.length&&<section className="recent-photos"><h3>첨부사진</h3><div>{detail.record.photos.map(image=>{const src='/api/recent-inspections/'+encodeURIComponent(detail.record.id)+'/photos/'+encodeURIComponent(image.id);return <button key={image.id} onClick={()=>setPhoto(src)} aria-label={image.name+' 크게 보기'}><img src={src} alt={image.name} loading="lazy"/></button>;})}</div></section>}
                </>}
                <button className="secondary recent-return" onClick={close}><ArrowLeft size={17} aria-hidden="true"/>목록으로</button>
            </div>
        </dialog>}
    </section>;
}
