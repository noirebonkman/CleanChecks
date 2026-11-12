import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { transformSync } from 'esbuild';

const files = ['base-layout', 'interaction-feedback', 'theme-and-components', 'record-journal', 'mobile-inspection', 'inspection-workspace']
    .map(name => 'src/' + name + '.css')
    .concat(['src/cloud/cloud-settings.css', 'src/cloud/login-and-access.css', 'src/responsive-layout.css']);
const css = files.map(file => readFileSync(file, 'utf8')).join('\n');
assert.equal(transformSync(css, { loader: 'css', minify: true }).warnings.length, 0);
const html = '<!doctype html><html><head><style>' + css + '</style></head><body>' +
    '<div class="app"><main><div class="content settings server-settings">' +
    '<header class="page-heading"><div><h1>설정</h1></div></header>' +
    '<div class="settings-account"><section class="cloud-settings setting-card">' +
    '<details class="cloud-account" open><summary>긴 이름의 사용자 계정</summary>' +
    '<form class="cloud-form"><fieldset><label>이름<input></label><label><input type="checkbox">동의</label><button>저장</button></fieldset></form>' +
    '</details></section></div></div></main></div>' +
    '<div class="login-shell"><main class="login-card">로그인<div class="login-challenge"></div></main></div></body></html>';
const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
const style = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector));
try {
    assert.equal(style('.login-card').marginLeft, '0px', 'Login must not inherit the application sidebar offset');
    assert.equal(style('.login-challenge').minHeight, '0px', 'Invisible checks must not reserve an empty row');
    assert.equal(style('.login-challenge').position, 'absolute');
    assert.equal(style('.server-settings').marginTop, '0px', 'Auto flex margins must not create the large blank setting header');
    assert.equal(style('.server-settings').width, '100%');
    assert.equal(style('.cloud-account').display, 'block', 'Open native details must not arrange forms in a horizontal flex row');
    assert.equal(style('.cloud-form fieldset').display, 'grid');
    assert.equal(style('.cloud-form fieldset').minWidth, '0px');
    assert.equal(style('.cloud-settings input:not([type=checkbox])').borderTopStyle, 'solid');
    assert.equal(style('.cloud-settings input:not([type=checkbox])').width, '100%');
    assert.notEqual(style('.cloud-settings input[type=checkbox]').width, '100%');
    assert.equal(style('.cloud-settings button').borderTopStyle, 'solid');
    assert.equal(style('.page-heading').flexWrap, 'wrap');
    const entry = readFileSync('src/main.tsx', 'utf8');
    assert(entry.includes("import './responsive-layout.css'"));
    console.log('PASS: complete CSS cascade keeps settings top-aligned, login centered, account forms vertical, inputs styled and checkboxes bounded');
} finally { dom.window.close(); }

// Reproduce the real import order: component styles first, then global themes.
const recordCss = ['src/record-list-controls.css', ...files, 'src/inspection-studio.css', 'src/workspace-surfaces.css', 'src/cloud/recent-inspections.css'].map(file => readFileSync(file,'utf8')).join('\n');
const recordDom = new JSDOM('<!doctype html><html><head><style>'+recordCss+'</style></head><body><div class="app"><section class="journal-list"><div class="journal-tools"><label class="journal-search"><input></label></div><div class="journal-selectable-entry"><label class="recent-select"><input type="checkbox"></label><button class="journal-record"><time class="journal-time">22:15</time><span class="journal-record-copy">현장 이름</span></button><button class="journal-delete-button">삭제</button></div></section></div></body></html>',{virtualConsole:new VirtualConsole()});
try {
    const computed = selector => recordDom.window.getComputedStyle(recordDom.window.document.querySelector(selector));
    assert.equal(computed('.journal-record').display,'grid','Later generic button styles must not center the record as a flex row');
    assert.equal(computed('.journal-record').justifyContent,'normal');
    assert.equal(computed('.journal-record-copy').textAlign,'left');
    assert.equal(computed('.journal-delete-button').minWidth,'44px');
    assert.equal(computed('.recent-select').display,'flex');
    assert.equal(computed('.recent-select').alignItems,'center');
    console.log('PASS: record list retains grid/left alignment, separate 44px delete control and vertically centered selection after the full CSS cascade');
} finally { recordDom.window.close(); }
