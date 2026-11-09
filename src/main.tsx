import { publishAppUpdate, watchForAppUpdates } from './app-updates';
import {AppErrorBoundary} from './AppErrorBoundary';
import {createRoot} from 'react-dom/client';
import { LoginApplication } from './cloud/LoginApplication';
import './base-layout.css';
import './interaction-feedback.css';
import './theme-and-components.css';
import './record-journal.css';
import './mobile-inspection.css';
import './inspection-workspace.css';
import './responsive-layout.css';
import './inspection-studio.css';
import './workspace-surfaces.css';

import {registerSW} from 'virtual:pwa-register';
createRoot(document.getElementById('root')!).render(<AppErrorBoundary><LoginApplication/></AppErrorBoundary>);
let stopUpdateChecks = () => {};
const updateSW = registerSW({
    onNeedRefresh: () => publishAppUpdate(() => updateSW(true)),
    onRegisteredSW: (_url, registration) => {
        stopUpdateChecks();
        if (registration) stopUpdateChecks = watchForAppUpdates(registration);
    },
});
if (import.meta.hot) import.meta.hot.dispose(() => stopUpdateChecks());
