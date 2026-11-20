import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {THEME_KEY, DEFAULT_THEME, normalizeTheme, readTheme, applyTheme, initTheme} from '../theme.js';

test('theme defaults to original dark site and treats corrupted settings as dark',()=>{
 assert.equal(DEFAULT_THEME,'dark');
 assert.equal(normalizeTheme('light'),'light');
 assert.equal(normalizeTheme('auto'),'dark');
 assert.equal(readTheme(null),'dark');
 assert.equal(readTheme({getItem:()=> 'invalid'}),'dark');
 assert.equal(readTheme({getItem:()=> {throw Error('blocked');}}),'dark');
});

test('clicking topbar switch toggles all-page root attribute and persists choice independently',()=>{
 const values=new Map([[THEME_KEY,'light']]);
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const root={dataset:{}}, icon={textContent:''},label={textContent:''},attrs={};
 let clicked;
 const button={
  setAttribute(k,v){attrs[k]=v;},
  querySelector(x){return x==='.theme-icon'?icon:x==='.theme-label'?label:null;},
  addEventListener(ev,fn){assert.equal(ev,'click');clicked=fn;},
 };
 const meta={setAttribute(k,v){attrs['meta:'+k]=v;}};
 initTheme({root,button,meta,storage});
 assert.equal(root.dataset.theme,'light');
 assert.equal(attrs['aria-pressed'],'true');
 assert.equal(label.textContent,'暗色');
 assert.equal(icon.textContent,'☾');
 assert.equal(attrs['meta:content'],'#f4f7fb');
 clicked();
 assert.equal(root.dataset.theme,'dark');
 assert.equal(values.get(THEME_KEY),'dark');
 assert.equal(attrs['aria-pressed'],'false');
 assert.equal(label.textContent,'亮色');
 assert.equal(attrs['meta:content'],'#080f1b');
 clicked();
 assert.equal(root.dataset.theme,'light');
 assert.equal(values.get(THEME_KEY),'light');
});

test('theme fallback remains usable when browser storage is unavailable',()=>{
 const root={dataset:{}}, attrs={};
 let clicked;
 const button={setAttribute:(k,v)=>{attrs[k]=v;},querySelector:()=>null,addEventListener:(_,fn)=>clicked=fn};
 initTheme({root,button,storage:{getItem(){throw Error('denied')},setItem(){throw Error('denied')}}});
 assert.equal(root.dataset.theme,'dark');
 assert.doesNotThrow(clicked);
 assert.equal(root.dataset.theme,'light');
 assert.equal(attrs['aria-pressed'],'true');
});

test('HTML loads theme layer after base CSS and provides topbar switch with accessible label',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/<html[^>]+data-theme="dark"/);
 assert.ok(html.indexOf('style.css')<html.indexOf('theme.css'));
 assert.match(html,/id="theme-toggle"/);
 assert.match(html,/aria-pressed="false"/);
 assert.match(html,/stock-market-theme-v1/);
});
test('every major view, table and chart has light/dark support',()=>{
 const css=readFileSync(new URL('../theme.css',import.meta.url),'utf8');
 const chart=readFileSync(new URL('../charts.js',import.meta.url),'utf8');
 for(const key of ['.sidebar','.workspace','.panel','.modal','.index-card','.market-terminal','.mt-table th','.mt-table tbody tr:nth-child(even)','.chart-canvas']){
  assert.ok(css.includes(key),key);
 }
 for(const prop of ['--chart-grid','--chart-label','--chart-ma5','--mt-bg','--mt-up','--mt-down']){
  assert.ok(css.includes(prop),prop);
 }
 assert.match(chart,/var\(--chart-grid\)/);
 assert.match(chart,/var\(--chart-label\)/);
});
