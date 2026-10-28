import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
const css=readFileSync('src/inspection-workspace.css','utf8'),vc=new VirtualConsole();
const dom=new JSDOM('<html><head></head><body><div class="app" data-theme="light" data-screen="inspect"><main><div class="inspection-heading" data-tall="true"></div><div class="inspection-layout"><section class="check-panel"><div class="questions"><div class="question answered"><div class="question-text"><h3>검증용 긴 점검 항목</h3></div><div class="grades compact-grades"><button class="chosen grade-A"><b>A</b><svg></svg></button></div></div></div><div class="check-footer"><button class="mobile-basic-shortcut"></button><button class="primary">다음 구역</button></div><div class="summary"><div class="ratings"><button>양호</button></div></div></section></div></main></div></body></html>',{virtualConsole:vc});
const d=dom.window.document,style=d.createElement('style');style.textContent=css;d.head.append(style);const q=s=>d.querySelector(s),cs=s=>dom.window.getComputedStyle(q(s));
assert.equal(cs('.app>main').marginLeft,'0px');
assert.equal(cs('.questions .question').gridTemplateColumns,'minmax(0,1fr) 176px');
assert.equal(cs('.compact-grades').gridTemplateColumns,'repeat(4,minmax(0,1fr))');
assert.equal(cs('.compact-grades button').minHeight,'48px');
assert.equal(cs('.check-footer').position,'static');assert.equal(cs('.check-footer').display,'flex');
assert.equal(cs('.check-footer .primary').width,'auto');assert.equal(cs('.check-footer .primary').flexGrow,'0');
assert.equal(cs('.mobile-basic-shortcut').position,'static');
assert.equal(cs('.summary .ratings').flexDirection,'column');
const lum=h=>{h=h.replace('#','');if(h.length===3)h=[...h].map(x=>x+x).join('');const c=h.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722};
const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
for(const theme of ['light','dark']){q('.app').dataset.theme=theme;const vars=cs('.app'),v=k=>vars.getPropertyValue(k).trim();for(const [foreground,background]of [['--ink','--surface'],['--muted','--surface'],['--ink','--hover'],['--muted','--hover'],['--accent','--surface'],['--on-accent','--accent'],['--on-accent','--warning'],['--on-accent','--danger']])assert(ratio(v(foreground),v(background))>=4.5,theme+' '+foreground+'/'+background);}
console.log('PASS: approved compact survey CSS, content-sized next button, no floating editing control, vertical ratings, real light/dark palette contrast >= 4.5:1');dom.window.close();

