import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,validateState,positions} from '../engine.js';
import {manualQuoteCheck,applyManualOrder} from '../manual-order.js';
const now=Date.parse('2026-11-27T10:33:00+08:00'),security={code:'600519',name:'贵州茅台'},quote={...security,price:100,prevClose:99,time:now-1000,source:'fixture'};
const order=(overrides={})=>({security,quote,side:'BUY',quantity:100,previewPrice:100,now,...overrides});
test('new symbol enters only successful short paper ledger with real quote metadata and replay',()=>{
 const a=initialState(),r=applyManualOrder(a,order());assert.ok(r.ok);assert.equal(a.securities,undefined);assert.equal(r.state.securities[security.code].name,security.name);assert.equal(r.trade.code,security.code);assert.equal(r.trade.price,100);assert.equal(r.state.prices[security.code].price,100);assert.ok(validateState(r.state));assert.equal(r.state.trades.length,a.trades.length+1);
});
test('unknown sell, mismatched identity, absent or stale quote, future quote, non-open and limit price reject',()=>{
 const a=initialState();for(const o of [order({side:'SELL'}),order({quote:null}),order({quote:{...quote,name:'别的股票'}}),order({quote:{...quote,time:now-16000}}),order({quote:{...quote,time:now+1}}),order({now:Date.parse('2026-11-27T16:00:00+08:00')}),order({quote:{...quote,price:108.90}}),order({quote:{...quote,price:101},previewPrice:100})])assert.equal(applyManualOrder(a,o).ok,false);assert.equal(a.securities,undefined);
});
test('cash, lot and T+1 rules survive new symbol registration; failures do not mutate input',()=>{
 const a=initialState(),before=JSON.stringify(a);
 for(const o of [order({quantity:1}),order({quantity:10000000}),order({security:{code:'688001',name:'华兴源创'},quote:{...quote,code:'688001',name:'华兴源创'}})])assert.equal(applyManualOrder(a,o).ok,false);
 assert.equal(JSON.stringify(a),before);
 const b=applyManualOrder(a,order()).state;assert.equal(applyManualOrder(b,order({side:'SELL'})).ok,false);
 const tomorrow=Date.parse('2026-11-30T10:33:00+08:00'),sold=applyManualOrder(b,order({side:'SELL',now:tomorrow,quote:{...quote,time:tomorrow-1000}}));assert.ok(sold.ok);assert.ok(!positions(sold.state).some(x=>x.code===security.code));assert.ok(validateState(sold.state));
});
test('seed halted and special securities do not admit orders',()=>{
 const a=initialState();for(const s of [{code:'000635',name:'英力特'},{code:'600111',name:'ST测试'},{code:'830001',name:'北交所测试'}])assert.equal(manualQuoteCheck(a,s,{...quote,...s},now).ok,false);
});
test('search and chart UI route into shared manual execution path',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/id="trade-search"/);assert.match(html,/id="trade-submit"/);assert.match(app,/searchDirectoryStocks\(term/);assert.match(app,/data-side="BUY"/);assert.match(app,/data-side="SELL"/);assert.match(app,/applyManualOrder\(next/);assert.match(app,/token!==tradeEpoch/);
});
