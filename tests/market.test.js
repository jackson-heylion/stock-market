import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTencent,parseSina,parseEastmoney,parseKline,parseTrends,chinaTimestamp,quoteState,session,getQuotes,getHistory} from '../market.js';
import {chartSvg,movingAverage} from '../charts.js';
const BASE=Date.parse('2026-11-20T09:35:02+08:00');
const textFetch=body=>async ()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(body).buffer});
test('Tencent parses real quotation shape without evaluating returned script',()=>{
 const row=Array(39).fill('0');row[1]='Stock';row[3]='17.25';row[4]='17.33';row[30]='20261120093500';
 const raw='v_sh601133="'+row.join('~')+'";';
 const q=parseTencent(raw,BASE);assert.equal(q.length,1);assert.equal(q[0].price,17.25);assert.equal(q[0].prevClose,17.33);
 assert.equal(q[0].time,BASE-2000);assert.equal(q[0].pct<0,true);
 assert.equal(parseTencent('v_sh601133="garbage";').length,0);
 assert.equal(parseTencent('v_sh601133="'+row.map((v,i)=>i===3?'0':v).join('~')+'";').length,0);
});
test('Eastmoney f86=0 must not be described as fresh',()=>{
 const q=parseEastmoney({data:{diff:[{f12:'300829',f14:'金丹科技',f2:26.8,f18:27,f86:0}]}},BASE)[0];
 assert.equal(q.time,null);assert.equal(quoteState(q,BASE).fresh,false);
 assert.equal(quoteState(q,BASE).tradable,false);
});
test('market session recognizes China trading hours',()=>{
 assert.equal(session(BASE),'open');
 assert.equal(session(Date.parse('2026-11-20T12:00:00+08:00')),'closed');
 assert.equal(session(Date.parse('2026-11-21T10:00:00+08:00')),'closed');
});
test('primary quotes complete without fallback and expired source triggers backup',async()=>{
 const row=Array(39).fill('0');row[1]='Stock';row[3]='17.2';row[4]='17.33';row[30]='20261120093500';
 const primary='v_sh601133="'+row.join('~')+'";';
 const ok=await getQuotes(['601133'],{fetchImpl:textFetch(primary),now:()=>BASE});
 assert.equal(ok.quotes.length,1);assert.equal(ok.quotes[0].source,'腾讯财经');
 let n=0;const backup=await getQuotes(['601133'],{now:()=>BASE,fetchImpl:async url=>{
  n++;if(url.includes('qt.gtimg.cn'))return {ok:true,arrayBuffer:async()=>new TextEncoder().encode('stale').buffer};
  return {ok:true,json:async()=>({data:{diff:[{f12:'601133',f14:'Stock',f2:17.4,f18:17.33,f86:0}]}})};
 }});
 assert.equal(n,2);assert.equal(backup.quotes.length,1);assert.equal(backup.quotes[0].source,'东方财富');assert.equal(quoteState(backup.quotes[0],BASE).fresh,false);
});
test('parse source minute and daily candles with no invented points',()=>{
 const trend={data:{trends:['2026-11-20 09:30,20.1,20.2,20.3,20.0,32,646400,20.15']}};
 const one=parseTrends(trend);assert.equal(one.length,1);assert.equal(one[0].price,20.2);
 const daily=parseKline({data:{klines:['2026-11-19,20,21,22,19,100,210000,5,4,1,0.4','bad-data']}});
 assert.equal(daily.length,1);assert.equal(daily[0].close,21);
 assert.equal(parseKline({data:{klines:[]}}).length,0);
 assert.match(chartSvg([], 'day'), /暂无真实行情/);
 assert.match(chartSvg(daily,'day'), /market-svg/);
 assert.equal(movingAverage(Array.from({length:5},(_,i)=>({close:i+1})),5)[4],3);
});
test('minute and day endpoints request correct periods',async()=>{
 const seen=[];
 const fetchImpl=async url=>{seen.push(url);return {ok:true,json:async()=>url.includes('trends2')?{data:{prePrice:20,trends:['2026-11-20 09:30,20,20.1,20.2,19.9,30,6030,20.1']}}:{data:{klines:['2026-11-19,20,21,22,19,100,210000']}}};};
 const minute=await getHistory('601133','minute',fetchImpl);
 const day=await getHistory('601133','day',fetchImpl);
 assert.equal(minute.bars.length,1);assert.equal(day.bars.length,1);
 assert.match(seen[1],/klt=101/);assert.match(seen[0],/trends2/);
});

test('Sina anonymous provider is parseable without invoking remote JavaScript',()=>{
 const row=Array(33).fill('0');row[0]='Example';row[2]='17.33';row[3]='17.4';row[30]='2026-11-20';row[31]='09:35:00';
 const result=parseSina('var hq_str_sh601133="'+row.join(',')+'";',BASE);
 assert.equal(result.length,1);
 assert.equal(result[0].price,17.4);
 assert.equal(result[0].time,BASE-2000);
 assert.equal(parseSina('var hq_str_sh601133="";').length,0);
});
