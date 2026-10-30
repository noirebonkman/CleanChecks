import {AppErrorBoundary} from './AppErrorBoundary';
import {createRoot} from 'react-dom/client';
import { LoginApplication } from './cloud/LoginApplication';
import './base-layout.css';
import './interaction-feedback.css';
import './theme-and-components.css';
import './record-journal.css';
import './mobile-inspection.css';
import './inspection-workspace.css';

import {registerSW} from 'virtual:pwa-register';
createRoot(document.getElementById('root')!).render(<AppErrorBoundary><LoginApplication/></AppErrorBoundary>);
const announceUpdate=()=>{window.dispatchEvent(new CustomEvent('lucent:update',{detail:()=>updateSW(true)}));};
const updateSW=registerSW({onNeedRefresh:announceUpdate});
