import {useEffect,useRef} from 'react';

type View={modal:boolean;drawer:boolean;screen:string;closeModal:()=>void;closeDrawer:()=>void;home:()=>void};
/** One in-document history entry absorbs Back for overlays or the current inner screen. */
export function useBackNavigation(view:View){
 const latest=useRef(view);latest.current=view;
 const owner=useRef(crypto.randomUUID()),armed=useRef(false),pending=useRef(false);
 const needs=()=>latest.current.modal||latest.current.drawer||latest.current.screen!=='home';
 const arm=()=>{if(armed.current||pending.current)return;window.history.pushState({...window.history.state,cleanChecksBack:owner.current},'');armed.current=true};
 useEffect(()=>{
  const pop=()=>{if(pending.current){pending.current=false;armed.current=false;if(needs())arm();return}if(!armed.current)return;armed.current=false;const v=latest.current;if(v.modal){v.closeModal();if(v.drawer||v.screen!=='home')arm()}else if(v.drawer){v.closeDrawer();if(v.screen!=='home')arm()}else if(v.screen!=='home')v.home()};
  window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);
 },[]);
 useEffect(()=>{if(needs())arm();else if(armed.current){if(window.history.state?.cleanChecksBack===owner.current){pending.current=true;window.history.back()}else armed.current=false}},[view.modal,view.drawer,view.screen]);
}
