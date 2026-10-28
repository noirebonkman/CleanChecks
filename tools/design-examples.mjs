import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {writeFileSync} from 'node:fs';
GlobalFonts.registerFromPath('C:/Windows/Fonts/malgun.ttf','Malgun Gothic');
const c=createCanvas(1260,1040),x=c.getContext('2d');
const ink='#20354d',muted='#64758b',blue='#2864b8';
function rect(px,py,w,h,color,r=0,stroke){x.beginPath();x.roundRect(px,py,w,h,r);x.fillStyle=color;x.fill();if(stroke){x.strokeStyle=stroke;x.lineWidth=1;x.stroke()}}
function text(s,px,py,size=16,color=ink,bold=false){x.font=`${bold?'bold ':''}${size}px "Malgun Gothic"`;x.textAlign='left';x.textBaseline='middle';x.fillStyle=color;x.fillText(s,px,py)}
function chevron(px,py,color=muted){x.beginPath();x.moveTo(px-5,py-3);x.lineTo(px,py+2);x.lineTo(px+5,py-3);x.strokeStyle=color;x.lineWidth=1.7;x.stroke()}
function search(px,py){x.beginPath();x.arc(px-1,py-1,5,0,Math.PI*2);x.moveTo(px+3,py+3);x.lineTo(px+7,py+7);x.strokeStyle=muted;x.lineWidth=1.5;x.stroke()}
function close(px,py){x.beginPath();x.moveTo(px-4,py-4);x.lineTo(px+4,py+4);x.moveTo(px+4,py-4);x.lineTo(px-4,py+4);x.strokeStyle=muted;x.lineWidth=1.5;x.stroke()}
rect(0,0,1260,1040,'#edf2f8');text('점검 기본정보 · 디자인 비교',38,39,26,ink,true);text('같은 기능과 입력 내용으로 비교한 시안입니다. 현재 앱 화면을 캡처한 이미지는 아닙니다.',38,76,15,muted);
const labels=['1  깔끔한 테두리형','2  부드러운 카드형','3  검색 중심형'];
const notes=['입력 칸이 또렷하고 익숙한 구성','정보를 묶어 차분하고 간결하게','현장을 찾고 고르는 기능을 강조'];
for(let v=0;v<3;v++){
 const left=30+v*412,w=388,px=left+24,pw=w-48;
 text(labels[v],left+5,122,21,ink,true);text(notes[v],left+5,154,14,muted);
 rect(left,184,w,780,v===1?'#f3f5f9':'#ffffff',24,'#d5dfeb');
 text('기본정보 수정',px,224,23,ink,true);close(left+w-28,224);text('점검 중에도 변경할 수 있습니다.',px,260,14,muted);
 if(v===0){
  text('현장명',px,300,14,ink,true);text('필수',px+53,300,12,blue);
  rect(px,318,pw,75,'#fff',12,'#aebfd3');text('예시 현장',px+14,341,18,ink,true);text('서울 · 예시 주소',px+14,367,13,muted);chevron(px+pw-22,354);
  const fields=[['점검 일시','2026. 10. 20.  15:20'],['점검 관리자','김관리'],['점검 유형','선택 입력'],['담당기사','선택 입력'],['작업 주기','주 2회']];
  let y=421;for(const [label,value] of fields){text(label,px,y,13,ink,true);rect(px,y+16,pw,50,label==='점검 관리자'?'#f3f6fa':'#fff',10,'#d6e0eb');text(value,px+14,y+42,16,value==='선택 입력'?'#78889b':ink);y+=91}
 }else if(v===1){
  text('현장',px,301,13,muted,true);rect(px,321,pw,88,'#fff',15);text('예시 현장',px+17,346,18,ink,true);text('서울 · 예시 주소',px+17,376,13,muted);chevron(px+pw-22,365);
  text('점검 정보',px,445,13,muted,true);rect(px,466,pw,146,'#fff',15);
  [['점검 일시','10. 20. 15:20'],['점검 관리자','김관리']].forEach(([label,value],i)=>{const y=502+i*72;text(label,px+17,y,15);text(value,px+pw-150,y,15,blue);if(i===0)rect(px+17,y+36,pw-34,1,'#edf0f4')});
  text('추가 정보 · 선택',px,648,13,muted,true);rect(px,668,pw,189,'#fff',15);
  [['점검 유형','미입력'],['담당기사','미입력'],['작업 주기','주 2회']].forEach(([label,value],i)=>{const y=701+i*62;text(label,px+17,y,15);text(value,px+pw-90,y,15,i===2?blue:muted);if(i<2)rect(px+17,y+30,pw-34,1,'#edf0f4')});
 }else{
  text('현장명',px,301,14,ink,true);rect(px,320,pw,52,'#fff',8,blue);search(px+19,346);text('예시',px+42,346,16);chevron(px+pw-20,346);
  rect(px,380,pw,144,'#fff',8,'#d6e0eb');rect(px+5,386,pw-10,67,'#edf4ff',5);text('예시 현장',px+15,407,16,blue,true);text('서울 · 예시 주소',px+15,434,12,muted);text('예시 두 번째 현장',px+15,474,16);text('경기 · 예시 주소',px+15,501,12,muted);
  text('점검 일시',px,557,13,ink,true);rect(px,574,pw,49,'#f4f6f9',5);text('2026. 10. 20.  15:20',px+14,599,16);
  text('점검 관리자',px,654,13,ink,true);rect(px,670,pw,49,'#f4f6f9',5);text('김관리',px+14,695,16);
  for(const [label,off] of [['점검 유형',0],['담당기사',1]]){const bx=px+off*(pw/2+7);text(label,bx,750,13,ink,true);rect(bx,768,pw/2-7,48,'#f4f6f9',5);text('선택 입력',bx+12,792,14,muted)}
  text('작업 주기',px,842,13,ink,true);text('주 2회',px+85,842,15);
 }
 rect(px,897,pw,45,blue,v===1?13:9);text('변경사항 적용',px+pw/2-59,920,16,'#fff',true);
}
text('추천: 1번의 명확한 입력 칸 + 2번의 간결한 여백',38,1006,17,ink,true);
writeFileSync('../../outputs/CleanChecks-기본정보-디자인-3안.png',c.toBuffer('image/png'));
console.log('Design comparison preview created');
