import test from 'node:test';
import assert from 'node:assert/strict';
import {getRankings,parseRanking} from '../market-center.js';
import {CHANGE_LABELS,CHANGE_TYPES,parseChangeEvents,parseFastNews,getNewsTerms,treemapLayout,
 getLiveSectors,getLiveNews,getLiveChanges} from '../market-radar.js';
import {radarState,renderRadar,handleRadarClick,radarSourceStatus} from '../radar-view.js';

const fake=data=>({ok:true,json:async()=>data,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify(data)).buffer});
test('speed ranking directly sorts the provider f22 field, not invented 3s snapshots',async()=>{
 let url='';
 const data={data:{total:5565,diff:[{f12:'300812',f13:0,f14:'易天股份',f2:18,f3:20,f22:3.45,f6:341000000}]}};
 const result=await getRankings('speed','all',{fetchImpl:async u=>{url=String(u);return fake(data)},sortKey:'speed',descending:true,size:30});
 assert.equal(result.rows[0].speed,3.45);
 assert.equal(parseRanking(data).rows[0].speed,3.45);
 assert.match(url,/fid=f22/);assert.match(url,/po=1/);
 assert.equal(result.total,5565);
});
test('price anomaly tape parses real event HHMMSS and mapping without making up date',()=>{
 const payload={data:{tc:91,allstock:[
  {c:'002095',n:'生 意 宝',m:0,tm:103818,t:8202,i:'-0.057502,14.26000,-0.057502'},
  {c:'600520',n:'三佳科技',m:1,tm:103815,t:8203,i:'2,30.01,3'},
  {c:'600520',n:'三佳科技',m:1,tm:103815,t:8203,i:'2,30.01,3'},
  {c:'invalid',n:'bad',tm:103818,t:8201,i:''},
  {c:'002095',n:'test',tm:256199,t:8201,i:''}
 ]}};
 const rows=parseChangeEvents(payload);
 assert.equal(rows.length,2);
 assert.equal(rows[0].time,'10:38:18');
 assert.equal(rows[0].label,'快速反弹');
 assert.equal(rows[0].category,'up');
 assert.equal(rows[1].category,'down');
 assert.equal(rows[1].market,'SH');
 assert.equal(rows[0].id.includes('2026'),false);
 assert.equal(CHANGE_LABELS[8193],'大笔买入');
 assert.equal(CHANGE_TYPES.split(',').length,22);
 assert.deepEqual(parseChangeEvents({data:{allstock:[]}}),[]);
});
test('news title parser respects actual provider publish time and rejects empty responses',()=>{
 const news={data:{fastNewsList:[
  {code:'202611203935944259',title:'智元机器人入股芯片热管理公司',showTime:'2026-11-20 10:36:39'},
  {code:'202611203935944260',title:'机器人概念盘中拉升',showTime:'2026-11-20 10:35:39'},
  {code:'202611203935944259',title:'智元机器人入股芯片热管理公司',showTime:'2026-11-20 10:36:39'},
  {code:'bad',title:'',showTime:'2026-11-20 10:36:39'}
 ]}};
 const rows=parseFastNews(news);
 assert.equal(rows.length,2);
 assert.equal(rows[0].time,Date.parse('2026-11-20T10:36:39+08:00'));
 const terms=getNewsTerms(rows,{now:Date.parse('2026-11-20T10:40:00+08:00')});
 assert.ok(terms.some(x=>x.word==='机器人'&&x.count===2));
 assert.deepEqual(getNewsTerms(rows,{now:Date.parse('2026-11-21T12:40:00+08:00')}),[]);
 assert.deepEqual(parseFastNews({code:1,data:null}),[]);
});
test('news request carries req_trace, otherwise 200 with null data is rejected',async()=>{
 let url='';const body={data:{fastNewsList:[{title:'机器人概念盘中拉升',showTime:'2026-11-20 10:35:39',code:'1'}]}};
 const data=await getLiveNews(async u=>{url=String(u);return fake(body)},{trace:()=> 'test-trace-1'});
 assert.equal(data.rows.length,1);assert.match(url,/req_trace=test-trace-1/);
 await assert.rejects(getLiveNews(async()=>fake({code:0,data:null}),{trace:()=> 'trace'}));
});
test('sector heatmap data uses actual turnover and preserves valid boards only',async()=>{
 const body={data:{total:496,diff:[
  {f12:'BK1340',f13:90,f14:'印制电路板',f2:8982.93,f3:1.2,f6:17276315664},
  {f12:'BK1295',f13:90,f14:'其他数字媒体',f2:1218.74,f3:-1.4,f6:804245112},
  {f12:'300812',f13:0,f14:'individual stock',f2:18,f3:20,f6:100000}
 ]}};
 const out=await getLiveSectors(async()=>fake(body));
 assert.equal(out.rows.length,2);assert.equal(out.rows[0].code,'BK1340');
 assert.equal(out.rows[1].pct,-1.4);
});
test('treemap partitions area deterministically without negative or overlapping regions',()=>{
 const base=[{code:'BK0001',turnover:1000000000,pct:3},{code:'BK0002',turnover:700000000,pct:-2},
 {code:'BK0003',turnover:300000000,pct:1},{code:'BK0004',turnover:100000000,pct:0}];
 const rectangles=treemapLayout(base,100,100);
 assert.equal(rectangles.length,base.length);
 const sum=rectangles.reduce((s,x)=>s+x.w*x.h,0);
 assert.ok(Math.abs(sum-10000)<.00001,sum);
 for(const a of rectangles){
  assert.ok(a.w>0&&a.h>0&&a.x>=0&&a.y>=0);
  assert.ok(a.x+a.w<=100.000001&&a.y+a.h<=100.000001);
 }
 for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){
  const a=rectangles[i],b=rectangles[j],intersect=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*
   Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  assert.ok(intersect<.00001);
 }
 assert.deepEqual(treemapLayout([]),[]);
});
test('source-backed anomalies and radar UI never fabricate feeds, allow direct stock navigation',async()=>{
 let endpoint='';
 const payload={data:{tc:2,allstock:[{c:'002095',n:'生 意 宝',m:0,tm:103818,t:8202,i:'x'}]}};
 const info=await getLiveChanges(async u=>{endpoint=String(u);return fake(payload)});
 assert.equal(info.rows[0].label,'快速反弹');assert.match(endpoint,/getAllStockChanges/);
 const old=radarState.changes.rows;
 radarState.changes.rows=info.rows;
 assert.match(renderRadar(),/盘口异动/);
 assert.match(renderRadar(),/生 意 宝/);
 let clicked='';
 handleRadarClick({dataset:{action:'radar-stock',code:'002095',name:'生 意 宝'}},{openStock:code=>clicked=code});
 assert.equal(clicked,'002095');
 radarState.changes.rows=old;
});

test('failed feed is clearly marked stale and never changes last success timestamp',()=>{
 const old={...radarState.news};
 radarState.news.updatedAt=Date.parse('2026-11-20T10:00:00+08:00');
 radarState.news.checkedAt=Date.parse('2026-11-20T10:15:00+08:00');
 radarState.news.error='API unavailable';
 const label=radarSourceStatus('news');
 assert.match(label,/源异常/);
 assert.match(label,/沿用10:00成功快照/);
 assert.match(label,/API unavailable/);
 Object.assign(radarState.news,old);
});
