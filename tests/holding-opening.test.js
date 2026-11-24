import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,positions,validateState} from '../engine.js';
import {assessHolding,applyLocalOpening,HOLD_POLICY,holdWindow} from '../holding-opening.js';
const now=Date.parse('2026-11-24T09:38:00+08:00'),date=HOLD_POLICY.date;
const holding={code:'601133',quantity:1000,avgCost:10,buyDate:'2026-11-19'};
const q=(price,prevClose=10,code='601133')=>({code,price,prevClose,time:now-1000,source:'测试报价'});
const trend=(open=10,close=10,prevClose=10)=>({prevClose,bars:['09:31','09:32','09:33','09:34','09:35'].map(t=>({date:date+' '+t,open,price:close,volume:100}))});
test('opening risk is limited to date and window',()=>{
 assert.ok(holdWindow(now));assert.ok(!holdWindow(now-3*60000));assert.ok(!holdWindow(now+7*60000));assert.ok(!holdWindow(now+86400000));
});
test('stop, weak opening, gap fade and profit protection',()=>{
 assert.equal(assessHolding(holding,q(9.3),trend(10,9.3),{now}).suggestedQty,500);
 assert.equal(assessHolding({...holding,avgCost:9.8},q(9.45),trend(10,9.45),{now}).suggestedQty,500);
 assert.equal(assessHolding(holding,q(10.12),trend(10.4,10.12),{now}).suggestedQty,300);
 assert.equal(assessHolding({...holding,avgCost:8.5},q(10),trend(10.3,10),{now}).suggestedQty,300);
 assert.equal(assessHolding(holding,q(10.5),trend(10.3,10.5),{now}).side,'HOLD');
});
test('T+1, stale/future quote, limit-down, missing data and mismatched previous close fail closed',()=>{
 for(const [h,quote,t] of [[{...holding,buyDate:date},q(9.3),trend()],[holding,{...q(9.3),time:now-16000},trend()],
 [holding,{...q(9.3),time:now+1},trend()],[holding,q(9),trend()],[holding,q(9.3),null],[holding,q(9.3),trend(10,10,9.5)]]){
  assert.equal(assessHolding(h,quote,t,{now}).status,'阻断');
 }
});
test('browser ledger changes atomically, preserves seed and records one sale per code with at most three orders',()=>{
 const s=initialState(),quotes={},trends={};
 for(const p of positions(s)){const avg=p.totalCost/p.quantity,price=avg*.93;quotes[p.code]=q(price,avg,p.code);trends[p.code]=trend(avg,price,avg);}
 const r=applyLocalOpening(s,quotes,trends,{now});
 assert.ok(r.changed);assert.equal(r.state.trades.length,s.trades.length+3);
 assert.ok(r.state.cash>s.cash);assert.ok(validateState(r.state));assert.equal(s.trades.length,7);
 assert.deepEqual(r.state.trades.slice(0,7),s.trades);
 assert.ok(r.state.trades.slice(7).every(t=>t.side==='SELL'&&t.strategyVersion===HOLD_POLICY.version&&t.price>0));
 const again=applyLocalOpening(r.state,quotes,trends,{now:now+1000});
 assert.equal(again.changed,false);assert.equal(again.state.trades.length,r.state.trades.length);
});
test('no trade if no source or after window',()=>{
 const s=initialState();assert.equal(applyLocalOpening(s,{}, {},{now}).changed,false);
 assert.equal(applyLocalOpening(s,{}, {},{now:now+600000}).changed,false);
});
