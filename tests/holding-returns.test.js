import test from 'node:test';
import assert from 'node:assert/strict';
import {holdingReturns} from '../holding-returns.js';
const date='2026-11-24',now=Date.parse(date+'T10:00:00+08:00');
const q=(price=12,prevClose=10)=>({code:'601133',price,prevClose,time:now-1000});
const old={code:'601133',side:'BUY',quantity:100,gross:800,fee:5,date:'2026-11-23'};
const h={code:'601133',quantity:100,totalCost:805,quote:12};
test('overnight holding day P&L vs cumulative including buy fee',()=>{
 const r=holdingReturns({holdings:[h],trades:[old],quotes:{601133:q()},cash:195,initialCash:1000,date,now});
 assert.equal(r.day,200);assert.equal(r.cumulative,395);assert.equal(r.rows[0].cumulative,395);
});
test('same-day purchase uses actual execution cost, not previous close',()=>{
 const t={...old,date,gross:1100,fee:5};
 const r=holdingReturns({holdings:[{...h,totalCost:1105}],trades:[t],quotes:{601133:q()},cash:895,initialCash:2000,date,now});
 assert.equal(r.day,95);assert.equal(r.cumulative,95);
});
test('partial/full sale includes fees and no double counting',()=>{
 const t={code:'601133',side:'SELL',quantity:100,gross:1100,fee:6,date};
 const r=holdingReturns({holdings:[],trades:[old,t],quotes:{601133:q()},cash:1289,initialCash:1000,date,now});
 assert.equal(r.day,94);assert.equal(r.rows[0].quantity,0);assert.equal(r.rows[0].realized,289);assert.equal(r.cumulative,289);
});
test('stale, future or missing prior close suppress day not cumulative',()=>{
 for(const quote of [{...q(),time:now-86400000},{...q(),time:now+1},{...q(),prevClose:null}]){
  const r=holdingReturns({holdings:[h],trades:[old],quotes:{601133:quote},cash:195,initialCash:1000,date,now});
  assert.equal(r.day,null);assert.equal(r.cumulative,395);
 }
});
test('robot realized P&L uses retained sale pnl and exact holding cost',()=>{
 const r=holdingReturns({holdings:[{code:'601133',quantity:100,cost:1005,lastPrice:12}],trades:[{...old,side:'SELL',pnl:120}],quotes:{601133:q()},cash:1115,initialCash:2000,date,now,robot:true});
 assert.equal(r.rows[0].cumulative,315);assert.equal(r.day,200);
});
