import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,executeTrade,validateState,positions} from '../engine.js';
import {planManualAfternoon,applyManualAfternoon,MANUAL_VERSION} from '../manual-afternoon.js';
const now=Date.parse('2026-11-24T14:31:00+08:00'),date='2026-11-24';
function account(){const s=initialState();s.cash=s.initialCash;s.trades=[];assert.ok(executeTrade(s,{code:'601133',side:'BUY',quantity:1000,price:18,date:'2026-11-23'}).ok);return s;}
const quote={code:'601133',price:16,prevClose:17,time:now-1000,source:'测试'};
const snapshot=()=>({previousDate:'2026-11-23',stocks:[],quotes:{'601133':quote},ranks:{},daily:{},indices:['sh000001','sz399001','sz399006'].map(key=>({key,price:1000,pct:1,time:now-1000}))});
test('manual portfolio uses actual positions, clears stop loss and preserves ledger invariant',()=>{const s=account(),r=applyManualAfternoon(s,snapshot(),now);assert.ok(r.ok);assert.equal(positions(r.state).length,0);assert.equal(r.state.trades.at(-1).strategyVersion,MANUAL_VERSION);assert.ok(validateState(r.state));assert.equal(s.trades.length,1);assert.equal(applyManualAfternoon(r.state,snapshot(),now+1000).ok,false);});
test('manual execution fails closed for stale held quote, no indices or outside window',()=>{let s=snapshot();s.quotes['601133']={...quote,time:now-16000};assert.equal(applyManualAfternoon(account(),s,now).ok,false);s=snapshot();s.indices=[];assert.equal(applyManualAfternoon(account(),s,now).ok,false);assert.equal(applyManualAfternoon(account(),snapshot(),now-120000).ok,false);});
test('same-day manual purchase cannot be sold by strategy',()=>{const s=account();assert.ok(executeTrade(s,{code:'601133',side:'BUY',quantity:100,price:17,date}).ok);const r=planManualAfternoon(s,snapshot(),now);assert.equal(r.rows.find(x=>x.code==='601133').action,'HOLD');});
