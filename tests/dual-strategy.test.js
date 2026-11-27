import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,validateState} from '../engine.js';
import {limitStreak,evidenceFor,planStrategy,applyShort,applyWave,analyzeSymbol,marketRegime} from '../dual-strategy.js';
const now=Date.parse('2026-11-26T14:31:00+08:00'),code='300502',name='新易盛',s={code,name,sector:'通信设备',sectorPct:2,sectorTime:now-1000,peerRank:1,peerCount:20};
const bars=Array.from({length:130},(_,i)=>{const date=new Date(Date.UTC(2026,6,19+i)).toISOString().slice(0,10);return {date,open:10,close:10,high:10.1,low:9.9,volume:1000};});
const cut=bars.at(-1).date;
const q={code,name,price:10.8,prevClose:10,time:now-1000,source:'fixture'};
const snap={stocks:[s],completedDate:cut,benchmark:bars,daily:{[code]:bars},quotes:{[code]:q},ranks:{[code]:{code,price:10.8,quoteTime:now-1000,volume:1500,high:10.85,open:10.1}},indices:['sh000001','sz399001','sz399006'].map(key=>({key,price:1000,pct:1,time:now-1000})),evidence:{}};
const empty=()=>{const a=initialState();a.trades=[];a.cash=a.initialCash;return a;};
test('short candidate passes breakouts and selected execution admits new symbol with replay integrity',()=>{const a=empty(),p=planStrategy(a,snap,'short',now);assert.ok(p.rows[0].passed.includes('S1'));assert.equal(p.rows[0].executable,true);const r=applyShort(a,snap,[code+':OPEN'],now);assert.ok(r.ok);assert.equal(r.state.trades.length,1);assert.ok(validateState(r.state));assert.equal(a.trades.length,0);assert.equal(applyShort(r.state,snap,[code+':OPEN'],now).state.trades.length,1);});
test('auction and closed refresh plans cannot fabricate fills',()=>{for(const t of ['2026-11-26T09:20:00+08:00','2026-11-26T16:00:00+08:00']){const n=Date.parse(t),p=planStrategy(empty(),snap,'short',n);assert.equal(p.rows[0].executable,false);assert.equal(applyShort(empty(),snap,[code+':OPEN'],n).state.trades.length,0);}});
test('wave requires dated evidence and 120-day data for cycle leader',()=>{const a={initialCash:1e6,cash:1e6,holdings:{},trades:[]};assert.equal(planStrategy(a,snap,'wave',now).rows[0].passed.length,0);assert.equal(applyWave(a,snap,[code+':OPEN'],now).state.trades.length,0);assert.equal(evidenceFor({cycle:{pass:true,source:'https://example.com',note:'fixture',asOf:'2025-01-01'}},now).cycle.pass,null);});
test('limit streak uses completed bars not intraday price',()=>{const b=bars.slice(-25).map(x=>({...x}));b.at(-2).close=12;b.at(-1).close=14.4;assert.equal(limitStreak(b,code,name),2);assert.equal(limitStreak(b,code,'ST测试'),null);});
test('unselected symbols and stale quote do not trade',()=>{const a=empty();assert.equal(applyShort(a,snap,[],now).state.trades.length,0);assert.equal(applyShort(a,{...snap,quotes:{[code]:{...q,time:now-16000}}},[code+':OPEN'],now).state.trades.length,0);});

test('v3 short relative strength, normalized growth cap and same-day version compatibility',()=>{
 const p=planStrategy(empty(),snap,'short',now);assert.equal(p.version,'SHORT-v3');assert.equal(p.regime.cap,.70);assert.equal(p.rows[0].checkScore.score,100);
 const weak={...snap,stocks:[{...s,sectorPct:9}]};assert.ok(!planStrategy(empty(),weak,'short',now).rows[0].passed.includes('S1'));
 const mode=analyzeSymbol(s,{...snap,quotes:{[code]:{...q,price:11.2}},ranks:{[code]:{...snap.ranks[code],price:11.2,high:11.25}}},'short',now).modes.find(x=>x.id==='S3');assert.equal(mode.checks.find(x=>x.name.includes('涨停幅度')).pass,true);
});
test('v3 market regimes are separate and missing or stale evidence blocks new buys',()=>{
 const mixed={...snap,indices:snap.indices.map((q,i)=>({...q,pct:i===2?-1:1}))};
 assert.equal(marketRegime(mixed,'short',now).cap,.40);
 assert.equal(marketRegime(mixed,'wave',now).cap,.80);
 const bad={...snap,indices:snap.indices.map(q=>({...q,pct:-2.1}))};
 assert.equal(marketRegime(bad,'short',now).cap,0);
 assert.equal(planStrategy(empty(),bad,'short',now).rows[0].executable,false);
 assert.equal(marketRegime({...snap,indices:[]},'wave',now).verified,false);
 assert.equal(marketRegime({...snap,benchmark:bars.slice(-20)},'wave',now).verified,false);
});
test('v3 W1 requires real earnings surprise rather than AI membership',()=>{
 const evidence={pass:true,source:'https://example.com/fixture',asOf:'2026-11-20',note:'synthetic test evidence'};
 const snapshot={...snap,evidence:{[code]:{ai:evidence,growth:evidence,valuation:evidence}}};
 assert.ok(!analyzeSymbol(s,snapshot,'wave',now).passed.includes('W1'));
 snapshot.evidence[code].surprise=evidence;
 assert.ok(analyzeSymbol(s,snapshot,'wave',now).passed.includes('W1'));
});
test('v3 pullback does not confuse early low cumulative volume with contraction',()=>{
 const t=Date.parse('2026-11-26T09:40:00+08:00');
 const x={...snap,stocks:[{...s,sectorTime:t-1000}],quotes:{[code]:{...q,time:t-1000}},ranks:{[code]:{...snap.ranks[code],volume:30,quoteTime:t-1000}}};
 const m=analyzeSymbol(x.stocks[0],x,'short',t).modes.find(m=>m.id==='S2');
 assert.equal(m.checks.find(c=>c.name.startsWith('缩量')).pass,null);
});
test('v3 W4 is not just any stock above MA20',()=>{
 const evidence={pass:true,source:'https://example.com/fixture',asOf:'2026-11-20',note:'synthetic test evidence'};
 const rising=bars.map((b,i)=>({...b,close:8+i*.015,open:8+i*.015,high:8+i*.015+.1,low:8+i*.015-.1}));
 const x={...snap,daily:{[code]:rising},evidence:{[code]:{growth:evidence,valuation:evidence}}};
 assert.ok(!analyzeSymbol(s,x,'wave',now).passed.includes('W4'));
});
