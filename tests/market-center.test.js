import test from 'node:test';
import assert from 'node:assert/strict';
import {INDEXES,SCOPES,RANK_MODES,SORT_COLUMNS,getWatchQuotes,parseIndices,parseRanking,parseSinaRanking,parseMarketBreadth,parseTencentWatchQuotes,parseTencentBreadth,parseTencentSectors,getMarketIndices,getRankings,getSectors,getIndexHistory,getMarketBreadth} from '../market-center.js';
const qq=Array(50).fill('0');qq[1]='上证指数';qq[3]='3514.92';qq[4]='3577.62';qq[30]='20261120095712';
const indexData='v_sh000001="'+qq.join('~')+'";';
const rank={data:{total:5565,diff:[
 {f12:'300812',f13:0,f14:'易天股份',f2:18,f3:20,f5:199220,f6:341992183.54,f15:18,f16:14.61,f17:15,f18:15},
 {f12:'600520',f13:1,f14:'三佳科技',f2:22.17,f3:10.02,f5:2000,f6:12345,f15:23,f16:20,f17:22,f18:20.15},
 {f12:'junk',f13:1,f14:'无效',f2:14,f3:5},
 {f12:'300829',f13:0,f14:'坏报价',f2:'-',f3:3}
]}};
const board={data:{total:496,diff:[{f12:'BK1340',f13:90,f14:'印制电路板',f2:8982.93,f3:0.72,f6:17276315664}]}};
const fakeReply=data=>({ok:true,json:async()=>data,arrayBuffer:async()=>new TextEncoder().encode(typeof data==='string'?data:JSON.stringify(data)).buffer});
test('major-index list uses qualified exchange keys, no 000001 ambiguity',()=>{
 assert.equal(INDEXES.length,5);
 assert.equal(INDEXES.find(x=>x.key==='sh000001').secid,'1.000001');
 assert.equal(parseIndices(indexData).length,1);
 const ix=parseIndices(indexData)[0];
 assert.equal(ix.key,'sh000001');assert.equal(ix.price,3514.92);assert.ok(ix.pct<0);
 assert.equal(ix.time,Date.parse('2026-11-20T09:57:12+08:00'));
 assert.equal(parseIndices('v_sz000001="'+qq.join('~')+'";').length,0);
});
test('A-share ranking rejects invalid quotes and preserves source totals',()=>{
 const result=parseRanking(rank);
 assert.equal(result.total,5565);assert.equal(result.rows.length,2);
 assert.equal(result.rows[0].name,'易天股份');assert.equal(result.rows[0].pct,20);
 assert.equal(result.rows[0].turnover,341992183.54);
 assert.equal(result.rows[0].quoteTime,null);
 assert.equal(parseRanking(null).rows.length,0);
 assert.equal(parseRanking({data:{total:0,diff:[]}}).total,0);
});
test('sector boards are parsed separately and excluded from stock orders',()=>{
 assert.equal(parseRanking(board).rows.length,0);
 assert.equal(parseRanking(board,{board:true}).rows[0].exchange,'BOARD');
 assert.equal(parseRanking(board,{board:true}).rows[0].code,'BK1340');
});
test('market breadth displays unavailable when source contains nonnumeric placeholders',()=>{
 assert.equal(parseMarketBreadth({data:{f104:'-',f105:'-',f106:100}}),null);
 assert.deepEqual(parseMarketBreadth({data:{f104:1200,f105:900,f106:100}}),
 {up:1200,down:900,flat:100,name:''});
});
test('rank requests use correct exchange filters and sort direction',async()=>{
 const seen=[];
 const fetchImpl=async url=>{seen.push(String(url));return fakeReply(rank);};
 const r=await getRankings('losers','gem',{fetchImpl,page:1,size:60});
 assert.equal(r.rows.length,2);
 assert.match(seen[0],/po=0/);
 assert.match(decodeURIComponent(seen[0]),/m:0\+t:80/);
 await getRankings('turnover','all',{fetchImpl});
 assert.match(seen[1],/fid=f6/);
 assert.ok(SCOPES.all.fs.includes('m:1+t:23'));
 assert.deepEqual(Object.keys(RANK_MODES),['gainers','losers','turnover','volume','speed']);
 await assert.rejects(getRankings('invalid','all',{fetchImpl}));
});
test('index history uses exchange-qualified secids, without using stock marketPrefix',async()=>{
 const seen=[],fetchImpl=async url=>{
  seen.push(String(url));
  return fakeReply(url.includes('trends2')?{data:{prePrice:3000,trends:['2026-11-20 09:30,3000,3010,3020,2990,30,10000,3005']}}:
  {data:{klines:['2026-11-19,3000,3010,3020,2990,100,300000']}});
 };
 const a=await getIndexHistory('sh000001','minute',fetchImpl),b=await getIndexHistory('sz399006','day',fetchImpl);
 assert.equal(a.bars.length,1);assert.equal(b.bars.length,1);
 assert.match(seen[0],/secid=1.000001/);
 assert.match(seen[1],/secid=0.399006/);
 assert.match(seen[1],/fqt=0/);
});
test('index / sector / breadth handlers tolerate independently unavailable data',async()=>{
 const ok=await getMarketIndices(async()=>fakeReply(indexData));
 assert.equal(ok[0].name,'上证指数');
 const sectors=await getSectors(async()=>fakeReply(board));
 assert.equal(sectors.rows.length,1);
 const nullBreadth=await getMarketBreadth(async()=>fakeReply({data:{f104:'-',f105:'-',f106:100}}));
 assert.equal(nullBreadth,null);
});

test('extended market table fields, placeholders and server sort column allowlist',async()=>{
 const payload={data:{total:5565,diff:[{f12:'002579',f13:0,f14:'中京电子',f2:13.39,f3:10.02,f4:1.22,f5:701076,f6:916000000,f8:12.02,f9:'-',f23:1.17,f20:8832000000,f25:9.93}]}};
 const data=parseRanking(payload).rows[0];
 assert.equal(data.change,1.22);
 assert.equal(data.ytdPct,9.93);
 assert.equal(data.turnoverRate,12.02);
 assert.equal(data.peTtm,null);
 assert.equal(data.pb,1.17);
 assert.equal(data.marketCap,8832000000);
 let called='';
 const fetchImpl=async url=>{called=String(url);return fakeReply(payload);};
 const r=await getRankings('gainers','main',{fetchImpl,sortKey:'ytdPct',descending:true,page:2,size:90});
 assert.equal(r.page,2);
 assert.match(called,/fid=f25/);
 assert.match(called,/pn=2/);
 assert.match(called,/pz=90/);
 assert.ok(SCOPES.main.fs.includes('m:1+t:2'));
 assert.ok(SORT_COLUMNS.name);
 await assert.rejects(getRankings('gainers','all',{fetchImpl,sortKey:'nonsense'}));
 await assert.rejects(getRankings('gainers','all',{fetchImpl,page:-1}));
});
test('followed stock prices are requested by exact symbol, never fabricated',async()=>{
 const data={data:{diff:[{f12:'601133',f13:1,f14:'柏诚股份',f2:16.81,f3:-3.0,f4:-0.52,f5:1100,f6:1900000}]}};
 let url='';
 const quotes=await getWatchQuotes(['601133'],async u=>{url=u;return fakeReply(data);});
 assert.equal(quotes.length,1);assert.equal(quotes[0].code,'601133');
 assert.match(String(url),/1.601133/);
 assert.deepEqual(await getWatchQuotes([]),[]);
});
test('rankUrl requests f9 peTtm and watch/breadth/indexHistory fall back to Tencent when Eastmoney drops',async()=>{
 let rankSeen='';
 await getRankings('gainers','all',{fetchImpl:async u=>{rankSeen=String(u);return fakeReply(rank);}});
 assert.match(rankSeen,/f9/);
 const tRow=Array(50).fill('0');
 tRow[1]='柏诚股份';tRow[2]='601133';tRow[3]='16.62';tRow[4]='16.80';tRow[5]='16.54';
 tRow[30]='20261125101000';tRow[31]='-0.18';tRow[32]='-1.07';tRow[33]='16.65';tRow[34]='15.78';
 tRow[36]='64004';tRow[37]='10360';tRow[38]='1.22';tRow[39]='41.98';tRow[45]='87.45';tRow[46]='2.85';
 const wRows=await getWatchQuotes(['601133'],async u=>{
  if(String(u).includes('eastmoney.com'))throw Error('ERR_EMPTY_RESPONSE');
  return fakeReply('v_sh601133="'+tRow.join('~')+'";');
 });
 assert.equal(wRows.length,1);
 assert.equal(wRows[0].source,'腾讯财经');
 assert.equal(wRows[0].peTtm,41.98);
 assert.equal(wRows[0].pb,2.85);
 assert.equal(wRows[0].turnover,103600000);
 assert.equal(wRows[0].marketCap,8745000000);
 const starRow=[...tRow];starRow[1]='中芯国际';starRow[2]='688981';starRow[36]='19349980';
 assert.equal(parseTencentWatchQuotes('v_sh688981="'+starRow.join('~')+'";')[0].volume,193499.8);
 const breadth=await getMarketBreadth(async u=>{
  if(String(u).includes('eastmoney.com'))throw Error('ERR_EMPTY_RESPONSE');
  return fakeReply('v_bkqtRank_A_sh="Rank_A_sh~Rank_A_sh~1444~50~825~2319";\nv_bkqtRank_A_sz="Rank_A_sz~Rank_A_sz~1995~65~845~2905";');
 });
 assert.deepEqual(breadth,{up:3439,down:1670,flat:115,source:'腾讯财经两市涨跌家数'});
 assert.equal(parseTencentBreadth('v_bkqtRank_A_sh="bad";'),null);
 const idxMin=await getIndexHistory('sh000001','minute',async u=>{
  if(String(u).includes('eastmoney.com'))throw Error('ERR_EMPTY_RESPONSE');
  return fakeReply({code:0,data:{sh000001:{data:{date:'20261125',data:['0930 3522.59 4577424 6415154864.50']},qt:{sh000001:['1','上证指数','000001','3522.59','3548.37']}}}});
 });
 assert.equal(idxMin.source,'腾讯财经');assert.equal(idxMin.prevClose,3548.37);
 const idxDay=await getIndexHistory('sh000001','day',async u=>{
  if(String(u).includes('eastmoney.com'))throw Error('ERR_EMPTY_RESPONSE');
  return fakeReply({code:0,data:{sh000001:{day:[['2026-11-25','3522.59','3517.70','3526.34','3508.39','158791962']]}}});
 });
 assert.equal(idxDay.source,'腾讯财经');assert.equal(idxDay.bars[0].close,3517.70);
 const ptRow=Array(40).fill('0');
 ptRow[1]='食品饮料';ptRow[2]='01801120';ptRow[3]='14700.71';ptRow[4]='14691.99';ptRow[30]='20261125102949';ptRow[31]='8.72';ptRow[32]='0.06';ptRow[36]='6301388';ptRow[37]='959222.0';
 const secFallback=await getSectors(async u=>{
  if(String(u).includes('eastmoney.com'))throw Error('ERR_EMPTY_RESPONSE');
  return fakeReply('v_pt01801120="'+ptRow.join('~')+'";');
 });
 assert.equal(secFallback.source,'腾讯财经行业板块');
 assert.equal(secFallback.rows[0].code,'pt01801120');
 assert.equal(secFallback.rows[0].turnover,9592220000);
 assert.equal(parseTencentSectors('v_pt01801120="bad";').length,0);
});

test('getRankings falls back to Sina Market_Center and maps Tencent pt sector boards to sw1 nodes',async()=>{
 const sinaSample=[
  {symbol:'bj430017',code:'430017',name:'北交忽略',trade:'10.00',changepercent:5},
  {symbol:'sh601939',code:'601939',name:'建设银行',trade:'12.59',pricechange:0.16,changepercent:1.29,settlement:'12.43',open:'12.42',high:'12.67',low:'12.12',volume:215801056,amount:2680097180,per:9.69,pb:0.9,mktcap:329354880.26,turnoverratio:2.25}
 ];
 const seen=[];
 const fallback=await getRankings('gainers','all',{page:1,size:30,sortKey:'peTtm',descending:true,fetchImpl:async u=>{
  seen.push(String(u));
  if(String(u).includes('eastmoney.com'))throw Error('ERR_EMPTY_RESPONSE');
  return fakeReply(sinaSample);
 }});
 assert.equal(fallback.source,'新浪财经');
 assert.equal(fallback.rows.length,1);
 assert.equal(fallback.rows[0].code,'601939');
 assert.equal(fallback.rows[0].volume,2158010.56);
 assert.equal(fallback.rows[0].marketCap,3293548802600);
 assert.equal(fallback.rows[0].peTtm,9.69);
 assert.match(seen.at(-1),/vip\.stock\.finance\.sina\.com\.cn.*sort=per.*asc=0.*node=hs_a/);

 let ptUrl='';
 const ptRank=await getRankings('turnover','all',{sectorCode:'pt01801120',size:30,fetchImpl:async u=>{
  ptUrl=String(u);
  return fakeReply(sinaSample);
 }});
 assert.match(ptUrl,/node=sw1_340000/);
 assert.equal(ptRank.rows[0].code,'601939');

 assert.equal(parseSinaRanking(null).length,0);
 await assert.rejects(getRankings('speed','all',{fetchImpl:async()=>{throw Error('ERR_EMPTY_RESPONSE');}}),/暂不支持/);
});
