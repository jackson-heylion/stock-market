import test from 'node:test';
import assert from 'node:assert/strict';
import {chartSvg,minuteSlot} from '../charts.js';
import {parseStockSuggestions,searchStocks} from '../market-center.js';
import {classifyHeadline,newsSentiment,sentimentTerms} from '../market-radar.js';
test('minute chart uses fixed slots, lunch compression and percent/volume detail',()=>{
 assert.equal(minuteSlot('2026-11-24 09:30'),0);assert.equal(minuteSlot('2026-11-24 11:30'),120);
 assert.equal(minuteSlot('2026-11-24 12:30'),null);assert.equal(minuteSlot('2026-11-24 13:00'),120);assert.equal(minuteSlot('2026-11-24 15:00'),240);
 const bars=[{date:'2026-11-24 09:31',price:10.1,avg:10.05,volume:100},{date:'2026-11-24 09:35',price:10.2,avg:10.1,volume:200}];
 const svg=chartSvg(bars,'minute',10);assert.match(svg,/15:00/);assert.match(svg,/minute-crosshair/);assert.match(svg,/涨跌 2.00%/);
 assert.equal((svg.match(/class="minute-hit"/g)||[]).length,2);assert.doesNotMatch(svg,/NaN|Infinity/);
});
test('whole market lookup rejects non-equities and uses batched quote enrichment',async()=>{
 const raw={QuotationCodeTable:{Data:[{Code:'300308',Name:'中际旭创',MktNum:'0',Classify:'AStock',PinYin:'ZJXC'},{Code:'000001',Name:'上证指数',MktNum:'1',Classify:'Index'},{Code:'600000',Name:'浦发银行',MktNum:'1',Classify:'AStock',PinYin:'PFYH'}]}};
 assert.deepEqual(parseStockSuggestions(raw,'zjxc').map(x=>x.code),['300308']);
 let url='',codes=[];const got=await searchStocks('中际',{fetchImpl:async u=>{url=String(u);return {ok:true,json:async()=>raw};},quoteLoader:async c=>{codes=c;return [{code:'300308',price:123}];}});
 assert.deepEqual(codes,['300308']);assert.equal(got.rows[0].price,123);assert.match(url,/searchapi\.eastmoney/);
 const exact=await searchStocks('sz300308',{quoteLoader:async c=>c.map(code=>({code,price:1}))});assert.equal(exact.rows[0].code,'300308');
});
test('headline sentiment is directional, mixed and deduplicated, with explicit sample window',()=>{
 assert.equal(classifyHeadline('芯片大涨').tone,'positive');assert.equal(classifyHeadline('芯片暴跌').tone,'negative');assert.equal(classifyHeadline('芯片上涨但存储下跌').tone,'mixed');
 assert.equal(classifyHeadline('公司否认砍单').tone,'neutral');
 const now=Date.parse('2026-11-24T10:00:00+08:00'),rows=['芯片上涨','芯片上涨','芯片下跌','芯片发布公告','芯片上涨但存储下跌'].map(title=>({title,time:now-1000}));
 rows.push({title:'旧新闻下跌',time:now-3*3600000});
 const r=newsSentiment(rows,{now,hours:2});assert.equal(r.total,4);assert.deepEqual(r.counts,{positive:1,negative:1,mixed:1,neutral:1});assert.equal(r.score,0);
 assert.ok(sentimentTerms(r,{now,hours:2}).some(x=>x.word==='芯片'&&x.tone==='mixed'));
});
