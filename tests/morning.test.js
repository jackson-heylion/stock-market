import test from 'node:test';
import assert from 'node:assert/strict';
import {atMorningClose,morningScore,proposedOrder,scanMorning} from '../morning.js';

const fixture=(time,price,volume)=>({date:'2026-11-20 '+time,price,volume});
const prev=Array.from({length:22},(_,i)=>({date:'2026-10-'+String(i+1).padStart(2,'0'),close:10,volume:100}));
test('morning snapshot truncates afternoon minutes at 11:30 without look-ahead',()=>{
 const bars=[fixture('09:30',10.0,100),fixture('11:29',10.6,50),fixture('11:30',10.7,100),fixture('13:35',15.0,900)];
 const snapshot=atMorningClose(bars,'2026-11-20');
 assert.equal(snapshot.time,'2026-11-20 11:30');
 assert.equal(snapshot.price,10.7);
 assert.equal(snapshot.volume,250);
 assert.throws(()=>atMorningClose([fixture('13:01',20,100)],'2026-11-20'),/11:25/);
});
test('morning M5 checks three conditions using half-day volume estimate and last 19 completed closes',()=>{
 const stock={date:'2026-11-20',code:'600520',name:'三佳科技',sectorPct:5};
 const s=morningScore(stock,prev,{price:10.5,volume:110},1.3,{volumeMultiplier:1.5,minSectorChangePct:0});
 assert.equal(s.score,3);assert.equal(s.passed,true);
 assert.equal(s.halfDayVolumeRatio,2.2);
 assert.equal(s.provisionalMA20,10.03);
 const noBoard=morningScore(stock,prev,{price:10.5,volume:110},null,{volumeMultiplier:1.5,minSectorChangePct:0});
 assert.equal(noBoard.passed,false);
});
test('afternoon proposal is never a filled order and respects conservative price limit',()=>{
 const c={date:'2026-11-20',code:'600520',name:'三佳科技',prevClose:10,morningTime:'2026-11-20 11:30'};
 const score={passed:true,price:10.5,reasons:['板块上涨','放量','站上MA20']};
 const account={initialCash:1_000_000,models:{M5:{positionFraction:0.1}}};
 const order=proposedOrder(c,score,account);
 assert.equal(order.status,'待执行（仅拟单）');assert.equal(order.quantity%100,0);
 assert.equal(order.budgetLimit,100000);assert.equal(order.referencePrice,10.5);
 assert.match(order.note,/不是实际订单/);
 const blocked=proposedOrder(c,{...score,price:11},account);
 assert.equal(blocked.status,'阻断');
});
test('one-off morning run reports actual pool and no imagined fills when blocked or insufficient evidence',async()=>{
 const fixtureBars=[fixture('09:30',10,50),fixture('11:30',10.5,100),fixture('13:40',20,800)];
 const data=await scanMorning({
  now:new Date('2026-11-20T13:40:00+08:00'),
  getData:async()=>({date:'2026-11-20',universe:[{code:'600520',name:'三佳科技',sector:'样本板块',sectorCode:'BK1234'}]}),
  historyLoader:async()=>({bars:fixtureBars}),
  barsLoader:async()=>prev,
  sectorLoader:async()=>1.5,
  account:{initialCash:1_000_000,models:{M5:{positionFraction:0.1,volumeMultiplier:1.5,minSectorChangePct:0,maxPositions:3}}}
 });
 assert.equal(data.scanned,1);
 assert.equal(data.orders.length,1);
 assert.equal(data.candidates[0].morningTime,'2026-11-20 11:30');
 assert.equal(data.candidates[0].price,10.5);
 assert.equal(data.orders[0].status,'待执行（仅拟单）');
 assert.match(data.universeNote,/午后筛选偏差/);
});
