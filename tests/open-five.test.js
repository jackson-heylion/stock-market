import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shClock,firstFiveBars,evaluateOpening,openingState,executeOpening} from '../open-five.js';

const live=JSON.parse(readFileSync(new URL('../data/bot.json',import.meta.url),'utf8'));
const base={...structuredClone(live),cash:live.initialCash,holdings:{},pending:[],trades:[],signals:[],history:[],events:[],
 openFive:{...structuredClone(live.openFive),status:'armed',results:[],checkedAt:null}};
const time=new Date('2026-11-24T09:38:00+08:00');
const daily=Array.from({length:21},(_,i)=>({date:i===20?'2026-11-23':
 '2026-10-'+String(i+1).padStart(2,'0'),close:10,volume:4000}));
const minute=[
 {date:'2026-11-24 09:30',open:10.2,price:10.2,volume:300},
 ...['09:31','09:32','09:33','09:34','09:35'].map((x,i)=>
  ({date:'2026-11-24 '+x,open:10.2,price:10.21+i*.0475,volume:100})),
 {date:'2026-11-24 09:40',open:11.5,price:20,volume:100000000}
];
const makeQuote=(code,price=10.4,at='2026-11-24T09:37:58+08:00')=>({
 code,name:base.openFive.candidates.find(c=>c.code===code)?.name,price,prevClose:10,
 pct:(price/10-1)*100,time:Date.parse(at),source:'腾讯财经'
});
const snapshot=({price=10.4,quoteTime='2026-11-24T09:37:58+08:00',boardPct=2.3}={})=>({
 date:'2026-11-24',
 candidates:Object.fromEntries(base.openFive.candidates.map(x=>[x.code,
  {daily,minute,quote:makeQuote(x.code,price,quoteTime)}])),
 sectors:boardPct==null?[]:[{name:'通信设备',pct:boardPct},{name:'印制电路板',pct:boardPct}]
});
test('plan is only armed for November 24, 2026, and manual account remains separate',()=>{
 assert.equal(live.openFive.targetDate,'2026-11-24');
 assert.equal(live.openFive.previousDate,'2026-11-23');
 assert.ok(['armed','completed','expired'].includes(live.openFive.status));
 assert.equal(base.openFive.status,'armed');
 assert.equal(base.initialCash,1000000);
 assert.equal(base.cash,1000000);
 assert.equal(base.trades.length,0);
 assert.equal(base.openFive.rules.maxPerStockFraction,0.05);
 assert.deepEqual(base.openFive.candidates.map(c=>c.code),['300308','300476']);
 assert.ok(base.openFive.candidates.every(c=>c.sectorRequired));
 assert.equal(base.openFive.rules.minOpeningVolumeRatio,1.8);
 assert.equal(base.openFive.rules.minSectorChangePct,1);
 assert.equal(base.openFive.rules.maxPullbackFrom935Pct,0.5);
});
test('first-five-minute price and volume exclude auction and any minute after 09:35',()=>{
 const f=firstFiveBars(minute,'2026-11-24');
 assert.equal(f.openingPrice,10.2);
 assert.equal(f.volume,500);
 assert.equal(f.barTime,'2026-11-24 09:35');
 assert.equal(f.closeAt935,10.4);
 assert.throws(()=>firstFiveBars(minute.slice(0,4),'2026-11-24'),/五根/);
 assert.equal(shClock(time).clock,'09:38');
});
test('both vetted candidates may paper buy only when conditions and fresh timestamps pass',()=>{
 const a=openingState(base,{now:time,market:snapshot()});
 assert.equal(a.changed,true);
 assert.equal(a.state.openFive.status,'completed');
 assert.equal(a.state.openFive.results.filter(x=>x.status==='模拟已成交').length,2);
 assert.equal(a.state.trades.length,2);
 assert.ok(a.state.cash>=900000);
 assert.ok(a.state.cash<1000000);
 assert.ok(Object.keys(a.state.holdings).length===2);
 assert.ok(a.state.trades.every(t=>t.date==='2026-11-24'&&t.quantity%100===0&&
  t.price===10.41&&t.executedAt===time.toISOString()));
 assert.equal(base.trades.length,0);
 assert.equal(openingState(a.state,{now:time,market:snapshot()}).changed,false);
});
test('sector loss cannot trigger M5 even with a valid opening momentum signal',()=>{
 const a=openingState(base,{now:time,market:snapshot({boardPct:null})});
 assert.equal(a.state.trades.length,0);
 assert.ok(a.state.openFive.results.every(x=>x.status==='未触发'));
 const weak=openingState(base,{now:time,market:snapshot({boardPct:0.9})});
 assert.equal(weak.state.trades.length,0);
});
test('failing chase/gap, stale quotes, and missing five-minute candles fail closed',()=>{
 for(const price of [9.5,10.75]){
  const a=openingState(base,{now:time,market:snapshot({price})});
  assert.equal(a.state.trades.length,0);
  assert.ok(a.state.openFive.results.every(x=>x.status==='未触发'));
 }
 const stale=openingState(base,{now:time,market:snapshot({quoteTime:'2026-11-24T09:35:00+08:00'})});
 assert.equal(stale.state.trades.length,0);
 const missing=snapshot();
 missing.candidates['300476'].minute=minute.slice(0,4);
 assert.throws(()=>openingState(base,{now:time,market:missing}),/五根完整分钟/);
 assert.equal(base.openFive.status,'armed');
});
test('outside exact date or opening window no buy; missed run is recorded without fake order',()=>{
 const early=openingState(base,{now:new Date('2026-11-24T09:35:30+08:00')});
 assert.equal(early.changed,false);
 const yesterday=openingState(base,{now:new Date('2026-11-23T09:38:00+08:00'),market:snapshot()});
 assert.equal(yesterday.changed,false);
 const tomorrow=openingState(base,{now:new Date('2026-11-25T09:38:00+08:00'),market:snapshot()});
 assert.equal(tomorrow.changed,false);
 const late=openingState(base,{now:new Date('2026-11-24T09:46:00+08:00'),market:snapshot()});
 assert.equal(late.changed,true);
 assert.equal(late.state.openFive.status,'expired');
 assert.equal(late.state.trades.length,0);
});
test('reused bot holdings cannot be double bought; after 09:35 engine never touches manual localStorage',async()=>{
 const prepared=structuredClone(base);
 prepared.holdings['300308']={code:'300308',quantity:100,cost:1000,avgCost:10,
  lastPrice:10,buyDate:'2026-11-23',modelId:'M2-OPEN5'};
 const a=openingState(prepared,{now:time,market:snapshot()});
 assert.equal(a.state.openFive.results.find(x=>x.code==='300308').status,'未下单');
 assert.equal(a.state.holdings['300308'].quantity,100);
 const outside=await executeOpening(base,{now:()=>new Date('2026-11-23T15:59:00+08:00'),
  snapshot:async()=>{throw Error('never contact exchange before target date')}});
 assert.equal(outside.changed,false);
});

test('overnight relief plan rejects post-09:35 fade, insufficient proxy volume and one-board false resonance',()=>{
 const fade=openingState(base,{now:time,market:snapshot({price:10.34})});
 assert.equal(fade.state.trades.length,0);
 const low=snapshot();
 for(const v of Object.values(low.candidates))v.minute=minute.map(b=>({...b,volume:25}));
 assert.equal(openingState(base,{now:time,market:low}).state.trades.length,0);
 const onlyPCB=snapshot();onlyPCB.sectors=[{name:'印制电路板',pct:2.3}];
 const result=openingState(base,{now:time,market:onlyPCB});
 assert.deepEqual(result.state.trades.map(t=>t.code),['300476']);
});
