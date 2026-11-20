import test from 'node:test';
import assert from 'node:assert/strict';
import {SECURITIES,INITIAL_CASH,BUDGET_PER_STOCK,SNAPSHOT_DATE} from '../seed.js';
import {initialState,fees,feeTotal,positions,portfolio,budgetQuantity,executeTrade,markPrice,validateState,cloneState,modelEvidence,migrateCapital} from '../engine.js';
test('seed has 8 watchlist symbols and 7 real-quote mock trades, suspended symbol unfilled',()=>{
 const s=initialState();assert.equal(s.watchlist.length,8);assert.equal(s.trades.length,7);assert.equal(s.trades.some(t=>t.code==='000635'),false);assert.ok(s.cash>=BUDGET_PER_STOCK);assert.equal(s.trades.every(t=>t.date===SNAPSHOT_DATE),true);assert.equal(validateState(s),true);
});
test('every seed purchase uses <=100k budget incl fees and 100-share lot',()=>{
 const s=initialState();for(const t of s.trades){assert.ok(t.gross+t.fee<=100000);assert.equal(t.quantity%100,0);assert.equal(t.quantity,budgetQuantity(100000,t.price));}
 assert.ok(Math.abs(portfolio(s).total-INITIAL_CASH + s.trades.reduce((sum,t)=>sum+t.fee,0))<0.02);
});
test('commission, transfer and sell stamp tax',()=>{
 assert.deepEqual(fees('BUY',10000),{commission:5,transfer:0.10,stamp:0});
 assert.deepEqual(fees('SELL',10000),{commission:5,transfer:0.10,stamp:5});assert.equal(feeTotal(fees('SELL',10000)),10.1);
});
test('no buy without sufficient cash, fractional lots or halted securities',()=>{
 const s=initialState();const count=s.trades.length,cash=s.cash;
 assert.equal(executeTrade(s,{code:'000635',side:'BUY',price:11,quantity:100}).ok,false);
 assert.equal(executeTrade(s,{code:'601133',side:'BUY',price:17.33,quantity:1}).ok,false);
 assert.equal(executeTrade(s,{code:'601133',side:'BUY',price:17.33,quantity:100000}).ok,false);
 assert.equal(s.trades.length,count);assert.equal(s.cash,cash);
});
test('T+1 blocks sale on seed date, next trading day sells properly',()=>{
 const s=initialState();const p=positions(s).find(h=>h.code==='601133');const before=s.cash;
 assert.equal(executeTrade(s,{code:'601133',side:'SELL',price:18,quantity:100,date:SNAPSHOT_DATE}).ok,false);
 const out=executeTrade(s,{code:'601133',side:'SELL',price:18,quantity:100,date:'2026-11-20'});
 assert.equal(out.ok,true);assert.equal(s.cash,Math.round((before+1800-out.trade.fee)*100)/100);assert.equal(positions(s).find(x=>x.code==='601133').quantity,p.quantity-100);
});
test('manual price updates P&L not historical trades',()=>{
 const s=initialState(),before=s.trades[0].price;assert.equal(markPrice(s,'601133',19,'2026-11-20').ok,true);
 assert.equal(s.trades[0].price,before);assert.equal(s.prices['601133'].price,19);assert.equal(markPrice(s,'000635',12).ok,false);
});
test('import validation rejects tampering and accepts legitimate manual actions',()=>{
 const s=initialState();assert.equal(validateState(s),true);
 const bad=cloneState(s);bad.cash+=10000;assert.equal(validateState(bad),false);
 const second=cloneState(s);second.trades[0].quantity=11;assert.equal(validateState(second),false);
 const duplicate=cloneState(s);duplicate.trades.push({...duplicate.trades[0]});assert.equal(validateState(duplicate),false);
 const third=cloneState(s);third.signals['601133'].M2=[1,1,0,0];assert.equal(validateState(third),true);assert.equal(modelEvidence(third,'601133','M2').confirmed,2);
});

test('manual browser capital migration adds 200k cash and preserves all old trades without double-seeding',()=>{
 const fresh=initialState();assert.equal(fresh.initialCash,1_000_000);assert.ok(fresh.cash>300000);
 const legacy=cloneState(fresh);legacy.initialCash=800000;legacy.cash-=200000;
 assert.equal(validateState(legacy),false);
 assert.equal(validateState(legacy,800000),true);
 const upgraded=migrateCapital(legacy);
 assert.equal(upgraded.initialCash,1000000);assert.equal(upgraded.cash,fresh.cash);
 assert.deepEqual(upgraded.trades,legacy.trades);
 assert.equal(upgraded.capitalMigration.from,800000);
 assert.equal(validateState(upgraded),true);
 assert.equal(migrateCapital(upgraded),upgraded);
 const invalid=cloneState(legacy);invalid.cash-=4000;
 assert.equal(migrateCapital(invalid),null);
});
