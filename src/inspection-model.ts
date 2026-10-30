import type {CloudLink} from './cloud/synchronization';
export const sections=[
 {title:'바닥 및 출입구',items:['바닥에 먼지·머리카락·이물질이 없음','모서리·벽면 가장자리에 먼지가 쌓이지 않음','얼룩·발자국·끈적임이 남아 있지 않음','바닥 물기·세제 잔여물로 인한 미끄럼 위험이 없음','출입문·유리문·손잡이·매트 주변이 청결함']},
 {title:'화장실',items:['변기 안팎에 오염이 없음','세면대·수전·거울에 물때와 얼룩이 없음','바닥·배수구 주변이 청결하고 배수 상태가 양호함','악취가 없고 휴지통 및 주변이 깨끗함','휴지·비누·핸드타월 등 소모품이 적정하게 비치됨','문손잡이 등 자주 접촉하는 부분이 청결함']},
 {title:'사무실 및 공용 공간',items:['공용 테이블·안내 데스크·의자 주변이 청결함','눈에 띄는 창틀·모서리·가구 표면의 먼지가 제거됨','문손잡이·스위치 등 접촉 부위가 청결함','쓰레기통을 비우고 주변을 정리함','탕비실·싱크대·정수기 주변이 청결함','청소 후 비품과 가구가 제자리에 정돈됨']},
 {title:'계단·복도·엘리베이터',items:['계단·복도 바닥과 구석이 청결함','난간·손잡이에 먼지와 얼룩이 없음','엘리베이터 바닥·벽면·거울이 청결함(해당 시)','거미줄 및 눈에 띄는 먼지가 제거됨','청소도구·물품이 통행로나 비상구를 막지 않음']},
 {title:'분리수거장 및 쓰레기 관리',items:['일반쓰레기와 재활용품이 기준에 맞게 구분됨','배출 일정과 현장 규칙에 맞게 정리됨','바닥에 흩어진 쓰레기·잔여물이 없음','악취·오염수·벌레 발생 흔적이 없음','수거 지연·배출 문제를 관리자에게 보고함']},
 {title:'작업 기준 및 직원 관리',items:['정해진 요일·시간에 작업을 실시함','계약 범위의 청소 구역과 작업 항목을 빠짐없이 수행함','작업 순서·청소 방법·약품 사용 기준을 준수함','청소도구를 세척하고 지정 장소에 보관함','고객 요청사항 및 이전 지적사항을 반영함','시설 이상·파손·고객 불편 사항을 관리자에게 보고함']},
 {title:'안전 및 특이사항',items:['청소 후 미끄럼·걸림 등 안전 위험이 없음','약품이 표시·용도에 맞게 사용되고 안전하게 보관됨','전선·누수·파손 등 위험 요소 발견 시 보고함','고객 물품 및 시설에 손상이 발생하지 않도록 작업함','현장 출입·보안 규칙을 준수함']}
];
export const grades=['A','B','C','N/A'] as const;
export const gradeNames={'A':'양호','B':'개선 필요','C':'불량','N/A':'해당 없음'};
export type Grade=typeof grades[number];
export type Site={inactive?:boolean;id:string;name:string;zone:string;address:string;priority:string;cycle:string};
export type Staff={id:string;name:string;salt:string;hash:string;active:boolean};
export type Photo={id:string;data:string;name:string};
export type Inspection={serverPhotoCount?:number;id:string;staffId:string;site:Site;date:string;type:string;cycle:string;technician:string;answers:Record<string,Grade>;rating:string;issues:string;action:string;assignee:string;due:string;actionState:string;notes:string;photos:Photo[];status:'draft'|'complete';modified:boolean;updated:string;completed?:string;history:{at:string}[]};
export type Cipher={iv:string;data:string};
export type Sealed=Cipher&{key:string};
export type State={cloud?:CloudLink;version:1;installId:string;staff:Staff[];sites:Site[];records:Inspection[];logs:Sealed[];publicKey:JsonWebKey;admin?:{salt:string;hash:string;privateKey:Cipher;recoverySalt:string;recoveryPrivate:Cipher};lastBackup?:string;backups?:Record<string,{at:string;revision:string}>;sync?:{password:string;digest:string;checked:string;published:string};directoryDirty?:boolean};
export const uid=()=>crypto.randomUUID();
export const localDate=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
export const itemKey=(s:number,i:number)=>`${s}-${i}`;
export const count=(r:Inspection)=>Object.keys(r.answers).length;
export const total=sections.reduce((n,s)=>n+s.items.length,0);
