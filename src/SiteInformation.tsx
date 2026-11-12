import { useState, type ReactNode } from 'react';
import { Copy, MapPin, Phone } from 'lucide-react';
import type { Inspection, Site } from './inspection-model';
import { isContractExpired, knownValue, siteCompany } from './site-details';
import './site-information.css';

export function SiteInformation({ inspection, inspectorName, currentSite, children }: {
    inspection:Inspection;inspectorName:string;currentSite?:Site;children?:ReactNode;
}) {
    const [latest,setLatest] = useState(false);
    const [feedback,setFeedback] = useState('');
    const differs = !!currentSite && JSON.stringify(currentSite) !== JSON.stringify(inspection.site);
    const site = latest && currentSite ? currentSite : inspection.site;
    const phone = site.contact?.match(/\+?\d[\d\s()-]{6,}\d/)?.[0].replace(/[^\d+]/g,'');
    return <div className="site-information">
        <header className="site-information-hero"><span>{siteCompany(site.company)}</span><h3>{site.name}</h3><p><MapPin size={16} aria-hidden="true"/>{knownValue(site.zone)}</p></header>
        {differs && <div className="site-source" role="group" aria-label="현장 정보 기준">
            <button type="button" aria-pressed={!latest} onClick={()=>setLatest(false)}>점검 당시 정보</button>
            <button type="button" aria-pressed={latest} onClick={()=>setLatest(true)}>현재 등록 정보</button>
        </div>}
        <p className="hint">{latest?'현재 현장 목록의 정보입니다. 저장된 점검표는 변경하지 않습니다.':'점검표에 저장된 당시의 현장 정보입니다.'}</p>
        <section aria-labelledby="site-contact-heading"><h4 id="site-contact-heading">위치·연락처</h4>
            <dl className="site-information-grid">
                <div className="site-information-wide"><dt>상세주소</dt><dd>{knownValue(site.address)}</dd></div>
                <div><dt>현장 연락처</dt><dd>{knownValue(site.contact)}</dd></div>
                <div><dt>중요도</dt><dd>{knownValue(site.priority)}</dd></div>
            </dl>
            <div className="site-information-actions">
                {site.address?.trim() && <button className="secondary" type="button" onClick={async()=>{
                    try { await navigator.clipboard.writeText(site.address);setFeedback('주소를 복사했습니다.'); }
                    catch { setFeedback('주소를 길게 누르거나 선택해서 복사해 주세요.'); }
                }}><Copy size={16} aria-hidden="true"/>주소 복사</button>}
                {phone && <a className="secondary" href={'tel:'+phone}><Phone size={16} aria-hidden="true"/>전화</a>}
            </div><p className="site-information-feedback" role="status">{feedback}</p>
        </section>
        <section aria-labelledby="site-work-heading"><h4 id="site-work-heading">계약·근무 정보</h4><dl className="site-information-grid">
            <div className="site-information-wide"><dt>계약기간</dt><dd>{knownValue(site.contractPeriod)}{isContractExpired(site)&&<span className="site-contract-expired">계약기간 지남</span>}</dd></div>
            <div><dt>근무형태·작업 주기</dt><dd>{knownValue(site.cycle)}</dd></div>
            <div><dt>근무 요일</dt><dd>{knownValue(site.workDays)}</dd></div>
        </dl></section>
        <section aria-labelledby="site-inspection-heading"><h4 id="site-inspection-heading">이번 점검</h4><dl className="site-information-grid">
            <div><dt>점검자</dt><dd>{knownValue(inspectorName)}</dd></div>
            <div><dt>점검일시</dt><dd>{inspection.date.replace('T',' ').slice(0,16)}</dd></div>
            <div><dt>점검 유형</dt><dd>{knownValue(inspection.type)}</dd></div>
            <div><dt>담당기사</dt><dd>{knownValue(inspection.technician)}</dd></div>
            <div><dt>점검표 작업 주기</dt><dd>{knownValue(inspection.cycle)}</dd></div>
            <div><dt>상태</dt><dd>{inspection.status==='complete'?'완료':'작성 중'}{inspection.modified?' · 수정됨':''}</dd></div>
        </dl></section>
        <section><h4>점검 구역·현장 메모</h4><p className="site-information-note">{knownValue(site.inspectionNotes)}</p></section>
        {children}
    </div>;
}
