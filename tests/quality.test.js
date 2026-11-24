import test from 'node:test';
import assert from 'node:assert/strict';
import {editLedger,LEDGER_LOCK} from '../ledger-store.js';
import {STORAGE_KEY,executeTrade,initialState,validateState,markPrice} from '../engine.js';
import {referencePrice,verifiedQuote} from '../valuation.js';
import {holdingReturns} from '../holding-returns.js';
const now=Date.parse('2026-11-24T10:00:00+08:00');
test('unified lock reads latest ledger and prevents concurrent lost updates',async()=>{
 const memory=new Map([[STORAGE_KEY,JSON.stringify(initialState())]]),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 let queue=Promise.resolve();const locks={request:(name,opts,fn)=>{assert.equal(name,LEDGER_LOCK);const p=queue.then(()=>fn({}));queue=p.catch(()=>{});return p;}};
 await Promise.all([editLedger(s=>executeTrade(s,{code:'601133',side:'SELL',quantity:100,price:18,date:'2026-11-24'}),{storage,locks}),editLedger(s=>executeTrade(s,{code:'601133',side:'SELL',quantity:100,price:18,date:'2026-11-24'}),{storage,locks})]);
 const end=JSON.parse(memory.get(STORAGE_KEY));assert.equal(end.trades.length,9);assert.ok(validateState(end));
 const failed=await editLedger(()=>({}),{storage,locks:null});assert.equal(failed.ok,false);
});
test('stale same-day quotes cannot produce day return; manual estimate survives older quote',()=>{
 const q={code:'601133',price:18,prevClose:17,time:now-16000};
 assert.equal(verifiedQuote(q,now),false);
 const saved={price:19,date:'2026-11-24',source:'用户手动维护（未经核验）',markedAt:now-1000};
 assert.equal(referencePrice(saved,q,now).price,19);
 assert.equal(referencePrice(saved,{...q,time:now},now).price,18);
 const r=holdingReturns({holdings:[{code:'601133',quantity:100,quote:19,totalCost:1700}],quotes:{601133:q},cash:0,initialCash:1700,date:'2026-11-24',now});
 assert.equal(r.day,null);assert.equal(r.cumulative,200);
});
test('archived robot realized returns survive ledger trimming',()=>{
 const r=holdingReturns({holdings:[{code:'601133',quantity:100,cost:1000,lastPrice:12}],quotes:{},cash:0,initialCash:1000,date:'2026-11-24',now,robot:true,realizedByCode:{601133:500}});
 assert.equal(r.rows[0].cumulative,700);
});
