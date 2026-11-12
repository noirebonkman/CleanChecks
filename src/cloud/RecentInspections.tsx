import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react';
import { gradeNames, sections, type Grade, type Inspection, type Site } from '../inspection-model';
import { SiteInformation } from '../SiteInformation';
import { knownValue } from '../site-details';
import { useBackNavigation } from '../useBackNavigation';
import { request, type ServerUser } from './client';
import { useCalendarLive } from './calendar-live';
import './recent-inspections.css';

type RecentItem = {id:string;siteName:string;inspectorName:string;date:string;status:'draft'|'complete';modified:boolean;updated:string;revision:number};
type RecentPage = {items?:RecentItem[];nextCursor?:string|null;version:string;unchanged?:boolean};
type Detail = {record:Inspection;inspectorName:string;revision:number;updated:string};
const displayDate = (value:string) => value.replace('T',' ').slice(0,16).replaceAll('-','.');

export function RecentInspections({user,sites}: {user:ServerUser;sites:Site[]}) {
    const preferenceKey = 'lucent-recent-collapsed:' + user.id;
    const [collapsed,setCollapsed] = useState(()=>{try{return localStorage.getItem(preferenceKey)==='true';}catch{return false;}});
    const [showAll,setShowAll] = useState(false);
    const [items,setItems] = useState<RecentItem[]>([]);
    const [nextCursor,setNextCursor] = useState<string|null>(null);
    const [busy,setBusy] = useState(false), [error,setError] = useState('');
    const [checkedAt,setCheckedAt] = useState('');
    const [selected,setSelected] = useState<RecentItem|null>(null);
    const [detail,setDetail] = useState<Detail|null>(null),[detailError,setDetailError] = useState('');
    const [detailTick,setDetailTick] = useState(0),[photo,setPhoto] = useState('');
    const dialog = useRef<HTMLDialogElement>(null);
    const opener = useRef<HTMLElement|null>(null), returnScroll = useRef(0);
    const alive = useRef(true), pending = useRef(false), queued = useRef(false);
    const version = useRef(''), pages = useRef(1), checkedTime = useRef(0);
    const selectedRef = useRef(selected);selectedRef.current=selected;
    const collapsedRef = useRef(collapsed);collapsedRef.current=collapsed;
    const controller = useRef<AbortController|null>(null);
    const pullRef = useRef<(force?:boolean)=>Promise<void>>(async()=>{});
    const close = () => {setSelected(null);setPhoto('');setDetail(null);setDetailError('');};
    useBackNavigation({modal:!!selected,drawer:false,screen:'home',closeModal:close,closeDrawer:()=>{},home:close});
    const {connected:live} = useCalendarLive(()=>void pullRef.current(),null,'inspections-changed',!collapsed);
    const pull = useCallback(async(force=false)=>{
        if (!alive.current || collapsedRef.current || !navigator.onLine || document.visibilityState==='hidden') return;
        if (pending.current) {queued.current=true;return;}
        pending.current=true;setBusy(true);
        try {
            const signal = controller.current?.signal;
            const head = await request<RecentPage>('recent-inspections'+(!force&&version.current?'?since='+encodeURIComponent(version.current):''),{signal});
            if (signal?.aborted || !alive.current) return;
            if (!head.unchanged) {
                let rows=head.items || [],cursor=head.nextCursor || null;
                for(let page=1;page<pages.current&&cursor;page++) {
                    const next=await request<RecentPage>('recent-inspections?cursor='+encodeURIComponent(cursor),{signal});
                    if (next.version!==head.version) throw Error('점검 목록이 갱신 중입니다. 다시 확인해 주세요.');
                    rows=[...rows,...(next.items || [])];cursor=next.nextCursor || null;
                }
                if (signal?.aborted || !alive.current) return;
                setItems(rows);setNextCursor(cursor);version.current=head.version;
                if (selectedRef.current) setDetailTick(value=>value+1);
            }
            checkedTime.current=Date.now();setError('');setCheckedAt(new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));
        } catch(cause) {if(alive.current&&!controller.current?.signal.aborted)setError(cause instanceof Error?cause.message:'최근 점검을 불러오지 못했습니다.');}
        finally {pending.current=false;if(alive.current)setBusy(false);if(queued.current){queued.current=false;void pullRef.current();}}
    },[]);
    pullRef.current=pull;
    useEffect(()=>{
        alive.current=true;controller.current=new AbortController();
        const refresh=()=>void pullRef.current();
        const timer=window.setInterval(()=>{if(!live.current||Date.now()-checkedTime.current>=30000)refresh();},5000);
        const offline=()=>setError('인터넷 연결이 끊겼습니다. 연결되면 다시 확인합니다.');
        document.addEventListener('visibilitychange',refresh);window.addEventListener('online',refresh);window.addEventListener('offline',offline);
        return()=>{alive.current=false;controller.current?.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('online',refresh);window.removeEventListener('offline',offline);};
    },[pull,live]);
    useEffect(()=>{if(!collapsed)void pullRef.current(true);},[collapsed]);
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
        dialog.current?.showModal();
        const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
        return()=>{document.body.style.overflow=overflow;requestAnimationFrame(()=>{window.scrollTo({top:returnScroll.current,behavior:'instant'});opener.current?.focus({preventScroll:true});});};
    },[!!selected]);
    function toggle(){setCollapsed(value=>{const next=!value;try{localStorage.setItem(preferenceKey,String(next));}catch{}return next;});}
    function open(item:RecentItem,button:HTMLButtonElement){opener.current=button;returnScroll.current=window.scrollY;setDetail(null);setPhoto('');setSelected(item);}
    return <section className="recent-inspections" aria-label="전체 점검자 최근 점검">
        <header className="recent-heading">
            <button type="button" className="recent-toggle" aria-label="최근 점검 전체 점검자" onClick={toggle} aria-expanded={!collapsed} aria-controls="recent-inspection-items"><ChevronDown size={18} aria-hidden="true"/><span className="recent-title">최근 점검</span><span>전체 점검자</span></button>
            {!collapsed&&<button className="text-button" onClick={()=>setShowAll(value=>!value)}>{showAll?'간단히':'전체 보기'}<ChevronRight size={15} aria-hidden="true"/></button>}
        </header>
        <div className="recent-collapse" data-collapsed={collapsed} inert={collapsed} aria-hidden={collapsed}><div id="recent-inspection-items">
            <div className="recent-list-status"><span>최근 저장순</span><span role="status">{busy?'확인 중…':checkedAt?checkedAt+' 기준':''}</span><button className="icon" aria-label="최근 점검 새로고침" disabled={busy} onClick={()=>void pull(true)}><RefreshCw size={15}/></button></div>
            {error&&<div className="recent-error" role="alert"><span>{error}{items.length?' 기존 목록을 유지합니다.':''}</span><button className="secondary" onClick={()=>void pull(true)} disabled={busy}>다시 확인</button></div>}
            <div className="recent-table-head" aria-hidden="true"><span>현장</span><span>점검자</span><span>점검일시</span><span>상태</span></div>
            <div className="recent-rows" data-expanded={showAll}>
                {items.map(item=><button key={item.id} className="recent-row" onClick={event=>open(item,event.currentTarget)} aria-label={`${item.siteName} · ${item.inspectorName} · ${displayDate(item.date)} · ${item.status==='complete'?'완료':'작성 중'}`}>
                    <span className="recent-site">{item.siteName}{item.modified&&<small>수정됨</small>}</span>
                    <span className="recent-person">{item.inspectorName}</span><time dateTime={item.date}>{displayDate(item.date)}</time>
                    <span className="recent-state" data-state={item.status}>{item.status==='complete'?<Check size={12} aria-hidden="true"/>:null}{item.status==='complete'?'완료':'작성 중'}</span>
                </button>)}
            </div>
            {!items.length&&!busy&&!error&&<p className="recent-empty">아직 저장된 점검이 없습니다.</p>}
            {showAll&&nextCursor&&<button className="secondary recent-load-more" disabled={busy} onClick={()=>{pages.current++;void pull(true);}}>이전 점검 더 보기</button>}
        </div></div>
        {selected&&<dialog ref={dialog} className="recent-inspection-dialog" aria-labelledby="recent-detail-heading" onCancel={event=>{event.preventDefault();if(photo)setPhoto('');else close();}}>
            <header className="recent-detail-toolbar"><button className="inspection-home-link" onClick={close}><ArrowLeft size={17} aria-hidden="true"/>현장점검</button><span>조회 전용</span><button className="icon" aria-label="점검 목록으로 돌아가기" onClick={close}><X size={21}/></button></header>
            <div className="recent-detail-body"><h2 id="recent-detail-heading">{selected.siteName}</h2>
                {detailError?<div role="alert" className="recent-error"><p>{detailError}</p><button className="secondary" onClick={()=>setDetailTick(value=>value+1)}>다시 확인</button></div>:!detail?<p role="status">점검표를 여는 중입니다…</p>:photo?<div className="recent-full-photo"><button className="secondary" onClick={()=>setPhoto('')}>점검표로 돌아가기</button><img src={photo} alt="점검 현장 사진 전체 보기"/></div>:<>
                    <p className="recent-readonly-note">{detail.inspectorName} · {displayDate(detail.record.date)} · 다른 점검표의 내용은 이 화면에서 수정하지 않습니다.</p>
                    <details className="recent-site-details"><summary>현장 상세정보</summary><SiteInformation inspection={detail.record} inspectorName={detail.inspectorName} currentSite={sites.find(site=>site.id===detail.record.site.id)}/></details>
                    <div className="recent-checklist">{sections.map((section,sectionIndex)=><section key={section.title}><h3>{sectionIndex+1}. {section.title}</h3><dl>{section.items.map((item,itemIndex)=>{const grade=detail.record.answers[sectionIndex+'-'+itemIndex] as Grade|undefined;return <div key={item}><dt>{item}</dt><dd data-grade={grade}>{grade?grade+' · '+gradeNames[grade]:'미확인'}</dd></div>;})}</dl></section>)}</div>
                    <section className="recent-result"><h3>점검 종합 결과</h3><dl>{[
                        ['종합평가',detail.record.rating],['주요 지적사항',detail.record.issues],['개선 조치 내용',detail.record.action],['조치 담당자',detail.record.assignee],['완료 예정일',detail.record.due],['조치 확인',detail.record.actionState],['특이사항',detail.record.notes],
                    ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{knownValue(value)}</dd></div>)}</dl></section>
                    {!!detail.record.photos.length&&<section className="recent-photos"><h3>첨부사진</h3><div>{detail.record.photos.map(image=>{const src='/api/recent-inspections/'+encodeURIComponent(detail.record.id)+'/photos/'+encodeURIComponent(image.id);return <button key={image.id} onClick={()=>setPhoto(src)} aria-label={image.name+' 크게 보기'}><img src={src} alt={image.name} loading="lazy"/></button>;})}</div></section>}
                </>}
                <button className="secondary recent-return" onClick={close}><ArrowLeft size={17} aria-hidden="true"/>목록으로</button>
            </div>
        </dialog>}
    </section>;
}
