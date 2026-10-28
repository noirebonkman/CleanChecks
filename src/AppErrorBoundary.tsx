import {Component,type ReactNode} from 'react';
export class AppErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  if(!this.state.failed)return this.props.children;
  return <div className="setup" role="alert"><h1>화면을 다시 열어 주세요.</h1><p>화면을 표시하는 중 문제가 발생했습니다. 저장된 점검 기록은 삭제하지 않았습니다.</p><p>저장되지 않은 입력은 다시 확인해 주세요. 브라우저의 사이트 데이터를 삭제하지 마세요.</p><button className="primary" onClick={()=>window.location.reload()}>다시 열기</button></div>;
 }
}
