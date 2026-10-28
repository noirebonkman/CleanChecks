export function readTheme(): 'system'|'light'|'dark'{
 try{const theme=localStorage.getItem('lucent-theme');return theme==='light'||theme==='dark'?theme:'system';}
 catch{return 'system';}
}
