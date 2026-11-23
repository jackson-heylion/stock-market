import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,positions,executeTrade,cloneState} from '../engine.js';
import {TAIL_POLICY,proposeTailOrders} from '../tail-strategy.js';

const t=Date.parse('2026-11-23T14:50:00+08:00');
const q=(price,prevClose,now=t)=>({price,prevClose,pct:(price/prevClose-1)*100,time:now-2000,source:'腾讯财经'});
test('fresh near-close actual holdings produce at most 3 defensive paper sell proposals',()=>{
 const account=initialState();
 const quotes={'600520':q(19.9,20.9),'600156':q(8.0,8.02),'002579':q(14.4,13.39)};
 const r=proposeTailOrders(account,quotes,{now:t});
 assert.equal(r.orders.length,3);
 assert.deepEqual(r.orders.map(x=>x.code),['600520','600156','002579']);
 assert.equal(r.orders.find(x=>x.code==='600520').suggestedQty,2200);
 assert.equal(r.orders.find(x=>x.code==='600156').suggestedQty,5600);
 assert.equal(r.orders.find(x=>x.code==='002579').suggestedQty,2700);
 assert.ok(r.orders.every(x=>x.side==='SELL'));
 assert.equal(r.rows.length,7);
 assert.equal(account.trades.length,7);
 assert.equal(account.cash,initialState().cash);
 assert.equal(TAIL_POLICY.maxOrders,3);
});
test('stale quote, closed exchange, and same-day bought stock are strictly non-executable',()=>{
 const account=initialState();
 const stale={'600520':q(19.9,20.9,t-60_000)};
 assert.equal(proposeTailOrders(account,stale,{now:t}).orders.length,0);
 assert.equal(proposeTailOrders(account,{'600520':q(19.9,20.9)},{now:Date.parse('2026-11-23T15:02:00+08:00')}).orders.length,0);
 const adjusted=cloneState(account);
 const b=executeTrade(adjusted,{code:'600520',side:'BUY',quantity:100,price:19.9,date:'2026-11-23'});
 assert.equal(b.ok,true);
 assert.equal(proposeTailOrders(adjusted,{'600520':q(18.0,20.9)},{now:t}).orders.length,0);
});
test('limit-down guard requires previous close, and small holdings cannot be oversold',()=>{
 const account=initialState();
 assert.equal(proposeTailOrders(account,{'600520':{...q(18.81,20.9)}},{now:t}).orders.length,0);
 assert.equal(proposeTailOrders(account,{'600520':{...q(19.9,20.9),prevClose:null}},{now:t}).orders.length,0);
});
test('rendered app requires explicit per-stock confirm and engine transaction',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.match(app,/function renderTailStrategy/);
 assert.match(app,/function executeTailRecommendation/);
 assert.match(app,/data-action="tail-sell"/);
 assert.match(app,/confirm\('确认按/);
 assert.match(app,/transaction\(next=>/);
 assert.match(app,/case'tail-sell'/);
 assert.match(app,/refreshed\.suggestedQty!==order\.suggestedQty/);
});
