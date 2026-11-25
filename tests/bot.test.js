import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDaily,dailyBars,m5,fillable,capPercent,stepBot,executeBot,botEquity,validateBot} from '../bot.js';
const liveSeed=JSON.parse(readFileSync(new URL('../data/bot.json',import.meta.url),'utf8'));
const seed={...structuredClone(liveSeed),cash:liveSeed.initialCash,lastDate:null,holdings:{},pending:[],trades:[],signals:[],history:[],events:[]};
const sample=(date,close=10,volume=100)=>({date,open:close,close,high:close+0.05,low:close-0.05,volume});
const baseBars=()=>Array.from({length:23},(_,i)=>sample('2026-10-'+String(i+1).padStart(2,'0'),9.9+i*.004,100));
const universe=[{code:'600520',name:'三佳科技',sector:'半导体',sectorPct:1.6}];
function m5Bars(day,close=10,vol=300){
 const arr=baseBars();
 arr.push(sample(day,close,vol));
 return arr;
}
const today='2026-11-20',next='2026-11-23';
test('paper bot starts completely empty and M1-M4 require evidence, no seeded wins',()=>{
 validateBot(liveSeed);
 assert.equal(liveSeed.initialCash,1000000);
 assert.equal(liveSeed.models.M5.enabled,true);
 for(const k of ['M1','M2','M3','M4'])assert.equal(liveSeed.models[k].enabled,false);
 assert.equal(seed.cash,1000000);
 assert.equal(seed.trades.length,0);
 assert.equal(seed.signals.length,0);
 assert.equal(seed.history.length,0);
});
test('daily OHLC parser drops bogus quotes, preserves source dates and volume',()=>{
 const input={data:{klines:['2026-11-19,10,10.1,10.2,9.9,140,140000',
 '2026-11-20,10,10.2,10.3,9.9,330,400000',
 'missing-date,1,2,3,0,100','2026-11-21,0,0,0,0,0']}};
 const bars=parseDaily(input);
 assert.deepEqual(bars.map(x=>x.date),['2026-11-19','2026-11-20']);
 assert.equal(bars[1].close,10.2);
 assert.throws(()=>parseDaily({data:null}),/absent/);
});
test('M5 is exactly the simple three conditions, adjustable volume threshold',()=>{
 const bars=m5Bars(today,10,300);
 const r=m5(universe[0],bars,seed.models.M5);
 assert.equal(r.score,3);
 assert.equal(r.passed,true);
 assert.equal(r.volumeRatio,3);
 assert.equal(m5({...universe[0],sectorPct:-1},bars,seed.models.M5).score,2);
 assert.equal(m5(universe[0],bars,{...seed.models.M5,volumeMultiplier:4}).score,2);
 assert.equal(m5(universe[0],bars.slice(-5),seed.models.M5).passed,false);
});
test('signal is recorded after close but never filled on signal date',()=>{
 const out=stepBot(seed,{date:today,universe,barsByCode:{'600520':m5Bars(today,10,300)}});
 assert.equal(out.changed,true);
 assert.equal(out.state.pending.length,1);
 assert.equal(out.state.pending[0].signalDate,today);
 assert.equal(out.state.pending[0].side,'BUY');
 assert.equal(out.state.trades.length,0);
 assert.equal(out.state.cash,1000000);
 assert.equal(out.state.signals[0].score,3);
 assert.equal(stepBot(out.state,{date:today,universe,barsByCode:{'600520':m5Bars(today,10,300)}}).changed,false);
});
test('only next trading-session close can hypothetically fill: fee, lots and 10% cap',()=>{
 const first=stepBot(seed,{date:today,universe,barsByCode:{'600520':m5Bars(today,10,300)}}).state;
 const nextBars=[...m5Bars(today,10,300),sample(next,10.1,110)];
 const second=stepBot(first,{date:next,universe,barsByCode:{'600520':nextBars}}).state;
 assert.equal(second.trades.length,1);
 assert.equal(second.trades[0].date,next);
 assert.equal(second.trades[0].signalDate,today);
 assert.equal(second.trades[0].quantity%100,0);
 assert.equal(second.trades[0].price,10.11);
 assert.ok(second.trades[0].fee>0);
 assert.ok(second.cash<1000000);
 assert.equal(Object.keys(second.holdings).length,1);
 assert.equal(second.holdings['600520'].buyDate,next);
 assert.equal(second.history.at(-1).date,next);
 assert.equal(second.pending.length,0);
 assert.equal(second.trades[0].source.includes('模拟滑点'),true);
});
test('limit-up, invalid trading date and no volume cannot claim fills',()=>{
 const order={code:'600520',name:'三佳科技',side:'BUY'};
 assert.match(fillable(order,[sample(today,10),sample(next,11,500)],next).reason,/涨停/);
 assert.equal(fillable(order,[sample(today,10)],next).ok,false);
 assert.equal(fillable(order,[sample(today,10),sample(next,10,0)],next).ok,false);
 assert.equal(capPercent('300812'),0.2);
 assert.equal(capPercent('600520'),0.1);
 assert.equal(capPercent('600520','*ST测试'),0.05);
 const first=stepBot(seed,{date:today,universe,barsByCode:{'600520':m5Bars(today,10,300)}}).state;
 const second=stepBot(first,{date:next,universe,barsByCode:{'600520':[...m5Bars(today,10,300),sample(next,11,600)]}}).state;
 assert.equal(second.trades.length,0);
 assert.equal(second.cash,1000000);
 assert.equal(second.events.at(-1).status,'未成交');
});
test('failed or delayed exchange data does not mutate account state',async()=>{
 const now=new Date('2026-11-20T16:45:00+08:00');
 const premature=await executeBot(seed,{now:new Date('2026-11-20T14:20:00+08:00'),getData:async()=>{throw Error('must not fetch');}});
 assert.equal(premature.changed,false);
 const holiday=await executeBot(seed,{now,getData:async()=>({date:'2026-11-19'})});
 assert.equal(holiday.changed,false);
 assert.deepEqual(seed.holdings,{});
 assert.equal(seed.lastDate,null);
 await assert.rejects(executeBot(seed,{now,getData:async()=>{throw Error('Provider error')}}),/Provider error/);
});
test('sell order generated only after risk signal and constrained by next session and T+1',()=>{
 const one=stepBot(seed,{date:today,universe,barsByCode:{'600520':m5Bars(today,10,300)}}).state;
 const two=stepBot(one,{date:next,universe,barsByCode:{'600520':[...m5Bars(today,10,300),sample(next,10.1,100)]}}).state;
 const falling='2026-11-24';
 const bars=[...m5Bars(today,10,300),sample(next,10.1,100),sample(falling,9.4,105)];
 const three=stepBot(two,{date:falling,universe,barsByCode:{'600520':bars}}).state;
 assert.equal(three.pending.some(o=>o.side==='SELL'),true);
 assert.equal(three.trades.length,1); // cannot retroactively sell at today's close
 const next2='2026-11-25';
 const four=stepBot(three,{date:next2,universe,barsByCode:{'600520':[...bars,sample(next2,9.35,105)]}}).state;
 assert.equal(four.trades.length,2);
 assert.equal(four.trades.at(-1).side,'SELL');
 assert.equal(Object.keys(four.holdings).length,0);
 assert.ok(Number.isFinite(four.trades.at(-1).pnl));
});

test('missed workflow session expires pending order rather than pretending next-day fill',()=>{
 const first=stepBot(seed,{date:today,universe,barsByCode:{'600520':m5Bars(today,10,300)}}).state;
 const late='2026-11-24';
 const history=[...m5Bars(today,10,300),sample(next,10.1,250),sample(late,10.2,250)];
 const r=stepBot(first,{date:late,previousMarketDate:next,universe,barsByCode:{'600520':history}}).state;
 assert.equal(r.trades.length,0);
 assert.equal(r.cash,1000000);
 assert.equal(r.events.some(e=>e.code==='600520'&&e.status==='过期'),true);
 assert.equal(r.pending.every(o=>o.signalDate===late),true);
});
test('dailyBars falls back to Tencent unadjusted kline when Eastmoney drops connection',async()=>{
 const bars=await dailyBars('600520',{fetchImpl:async url=>{
  if(String(url).includes('push2his.eastmoney.com'))throw Error('Remote end closed connection');
  return {ok:true,json:async()=>({code:0,data:{sh600520:{day:[['2026-11-24','19.5','20.1','20.3','19.4','12000'],['2026-11-25','20.1','20.5','20.6','20.0','8000']]}}})};
 }});
 assert.equal(bars.length,2);
 assert.equal(bars[1].date,'2026-11-25');
 assert.equal(bars[1].close,20.5);
});
