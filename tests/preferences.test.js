import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_PREFS,PREF_KEY,normalizePrefs,readPrefs,savePrefs,resetPrefs} from '../preferences.js';

test('browser preferences are deterministic and do not affect paper account defaults',()=>{
 assert.equal(DEFAULT_PREFS.autoQuotes,true);
 assert.equal(DEFAULT_PREFS.quoteInterval,3000);
 assert.equal(DEFAULT_PREFS.defaultBudget,100000);
 assert.equal(DEFAULT_PREFS.tablePageSize,30);
 assert.equal(readPrefs(null).defaultChartPeriod,'minute');
 const clean=normalizePrefs({quoteInterval:9000,defaultBudget:-1,
  defaultChartPeriod:'1minute',autoQuotes:'yes',tablePageSize:999,confirmTrades:false});
 assert.equal(clean.quoteInterval,3000);
 assert.equal(clean.defaultBudget,100000);
 assert.equal(clean.defaultChartPeriod,'minute');
 assert.equal(clean.tablePageSize,30);
 assert.equal(clean.autoQuotes,true);
 assert.equal(clean.confirmTrades,false);
});
test('settings save, reload and reset are controlled by local browser storage',()=>{
 const cache=new Map();
 const store={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)};
 const fresh=readPrefs(store);
 assert.equal(fresh.autoQuotes,true);
 const next=savePrefs({...fresh,quoteInterval:10000,defaultBudget:150000,tablePageSize:60},store);
 assert.equal(next.defaultBudget,150000);
 assert.equal(JSON.parse(cache.get(PREF_KEY)).tablePageSize,60);
 assert.equal(readPrefs(store).quoteInterval,10000);
 resetPrefs(store);
 assert.equal(readPrefs(store).tablePageSize,30);
 assert.equal(readPrefs({getItem(){throw Error('storage denied')}}).autoQuotes,true);
 assert.equal(savePrefs({}, {setItem(){throw Error('storage denied')}}),null);
});
test('setting page is accessible and bot parameters are clearly read-only from Pages',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
 assert.match(html,/data-page="settings"/);
 assert.match(app,/function renderSettings/);
 assert.match(app,/settings-theme/);
 assert.match(app,/data-pref/);
 assert.match(app,/stock-market\/edit\/main\/data\/bot.json/);
 assert.match(app,/migrateCapital/);
 assert.match(css,/\.settings-grid/);
 for(const action of ['settings-clear-follows','settings-clear-recent','settings-reset-prefs','export','import','reset']){
  assert.ok(app.includes("data-action=\""+action+"\""),action);
 }
});
