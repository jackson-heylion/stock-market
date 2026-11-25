import {fetchTimeout,fetchEastmoneyJson,parseTrends,parseKline,parseTencentMinute,parseTencentKline,validPrice,chinaTimestamp} from './market.js';

// Stable exchange-qualified index keys: 000001 alone is ambiguous between the SSE index and an SZ stock.
export const INDEXES=Object.freeze([
 {key:'sh000001',name:'上证指数',secid:'1.000001'},
 {key:'sz399001',name:'深证成指',secid:'0.399001'},
 {key:'sz399006',name:'创业板指',secid:'0.399006'},
 {key:'sh000688',name:'科创50',secid:'1.000688'},
 {key:'sh000300',name:'沪深300',secid:'1.000300'}
]);
export const SCOPES=Object.freeze({
 all:{label:'沪深A股',fs:'m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'},
 sh:{label:'沪市',fs:'m:1+t:2,m:1+t:23'},
 sz:{label:'深市',fs:'m:0+t:6,m:0+t:80'},
 gem:{label:'创业板',fs:'m:0+t:80'},
 star:{label:'科创板',fs:'m:1+t:23'},
 main:{label:'沪深主板',fs:'m:0+t:6,m:1+t:2'}
});
export const RANK_MODES=Object.freeze({
 gainers:{label:'涨幅榜',fid:'f3',po:1},
 losers:{label:'跌幅榜',fid:'f3',po:0},
 turnover:{label:'成交额榜',fid:'f6',po:1},
 volume:{label:'成交量榜',fid:'f5',po:1},
 speed:{label:'涨速排行',fid:'f22',po:1}
});
export const SORT_COLUMNS=Object.freeze({
 code:{label:'股票代码',fid:'f12'},name:{label:'股票名称',fid:'f14'},price:{label:'当前价',fid:'f2'},
 change:{label:'涨跌额',fid:'f4'},pct:{label:'涨跌幅',fid:'f3'},speed:{label:'涨速',fid:'f22'},
 ytdPct:{label:'年初至今',fid:'f25'},volume:{label:'成交量',fid:'f5'},
 turnover:{label:'成交额',fid:'f6'},turnoverRate:{label:'换手率',fid:'f8'},
 peTtm:{label:'市盈率(TTM)',fid:'f9'},pb:{label:'市净率',fid:'f23'},
 marketCap:{label:'总市值',fid:'f20'}
});
const num=x=>(x===null||x===undefined||x===''||x==='-'||x==='--')?NaN:typeof x==='number'?x:Number(x);
const validPct=x=>Number.isFinite(x)&&x>=-100&&x<=100;
const rankUrl=(fs,fid,po,page,size)=>{
 const q=new URLSearchParams({pn:String(page),pz:String(size),po:String(po),np:'1',fltt:'2',invt:'2',fid,fs,
 fields:'f2,f3,f4,f5,f6,f7,f8,f9,f12,f13,f14,f15,f16,f17,f18,f20,f21,f22,f23,f25,f124'});
 return 'https://push2.eastmoney.com/api/qt/clist/get?'+q;
};
export function parseIndices(raw,receivedAt=Date.now()){
 const found=new Map();
 for(const match of String(raw).matchAll(/v_((?:sh|sz)\d{6})="([^"\r\n]*)"/g)){
  const index=INDEXES.find(x=>x.key===match[1]);if(!index)continue;
  const fields=match[2].split('~'),price=num(fields[3]),previous=num(fields[4]);
  if(fields.length<31||!validPrice(price))continue;
  const prevClose=validPrice(previous)?previous:null;
  found.set(index.key,{...index,price,prevClose,change:prevClose?price-prevClose:null,
    pct:prevClose?(price-prevClose)/prevClose*100:null,
    time:chinaTimestamp(fields[30]),receivedAt,source:'腾讯财经'});
 }
 return [...found.values()];
}
export function parseRanking(data,{board=false}={}){
 const diff=data?.data?.diff,total=num(data?.data?.total);
 if(!Array.isArray(diff))return {rows:[],total:Number.isInteger(total)&&total>=0?total:null};
 const rows=diff.map(x=>{
  const code=String(x?.f12||''),name=String(x?.f14||'').trim(),price=num(x?.f2),pct=num(x?.f3);
  if(!name||!validPrice(price)||!validPct(pct))return null;
  if(board?!/^BK\d{3,6}$/.test(code):!/^[0-9]{6}$/.test(code))return null;
  if(!board&&![0,1].includes(Number(x.f13)))return null;
  const n=k=>{const v=num(x[k]);return Number.isFinite(v)&&v>=0?v:null;};
  const priceOrNull=k=>{const v=num(x[k]);return validPrice(v)?v:null;};
  const signedNumber=k=>{const v=num(x[k]);return Number.isFinite(v)&&v>-1e13&&v<1e13?v:null;};
  const ratio=k=>{const v=signedNumber(k);return v===null||v<-100||v>10000?null:v;};
  return {code,name,price,pct,exchange:board?'BOARD':Number(x.f13)===1?'SH':'SZ',
   volume:n('f5'),turnover:n('f6'),high:priceOrNull('f15'),low:priceOrNull('f16'),
   open:priceOrNull('f17'),prevClose:priceOrNull('f18'),marketCap:n('f20'),
   change:signedNumber('f4'),speed:ratio('f22'),ytdPct:ratio('f25'),turnoverRate:ratio('f8'),
   peTtm:signedNumber('f9'),pb:ratio('f23'),
   quoteTime:chinaTimestamp(x.f124),source:'东方财富'};
 }).filter(Boolean);
 return {rows,total:Number.isInteger(total)&&total>=0?total:null};
}
export function parseMarketBreadth(raw){
 const data=raw?.data;
 if(!data||typeof data!=='object')return null;
 const numbers=['f104','f105','f106'].map(x=>num(data[x]));
 if(!numbers.every(x=>Number.isInteger(x)&&x>=0&&x<=10000)||numbers.reduce((s,x)=>s+x,0)===0)return null;
 return {up:numbers[0],down:numbers[1],flat:numbers[2],name:String(data.f58||'')};
}
export function parseTencentWatchQuotes(raw){
 const rows=[];
 for(const match of String(raw).matchAll(/v_(sh|sz)(\d{6})="([^"\r\n]*)"/g)){
  const f=match[3].split('~'),code=match[2],name=String(f[1]||'').trim(),price=num(f[3]);
  if(f.length<38||!name||!validPrice(price))continue;
  const prevClose=validPrice(num(f[4]))?num(f[4]):null;
  const open=validPrice(num(f[5]))?num(f[5]):null;
  const high=validPrice(num(f[33]))?num(f[33]):null;
  const low=validPrice(num(f[34]))?num(f[34]):null;
  const rawPct=num(f[32]),pct=validPct(rawPct)?rawPct:(prevClose?(price-prevClose)/prevClose*100:null);
  if(pct===null||!validPct(pct))continue;
  const rawChange=num(f[31]),change=Number.isFinite(rawChange)&&Math.abs(rawChange)<1e6?rawChange:(prevClose?price-prevClose:null);
  const isStar=/^(?:688|689)/.test(code);
  const rawVol=num(f[36]),volume=Number.isFinite(rawVol)&&rawVol>=0?(isStar?rawVol/100:rawVol):null;
  const rawTurn=num(f[37]),turnover=Number.isFinite(rawTurn)&&rawTurn>=0?rawTurn*10000:null;
  const rawRate=num(f[38]),turnoverRate=Number.isFinite(rawRate)&&rawRate>=-100&&rawRate<=10000?rawRate:null;
  const rawPe=num(f[39]),peTtm=Number.isFinite(rawPe)&&Math.abs(rawPe)<1e10?rawPe:null;
  const rawCap=num(f[45]),marketCap=Number.isFinite(rawCap)&&rawCap>=0?rawCap*1e8:null;
  const rawPb=num(f[46]),pb=Number.isFinite(rawPb)&&rawPb>=-100&&rawPb<=10000?rawPb:null;
  rows.push({
   code,name,price,pct,exchange:match[1]==='sh'?'SH':'SZ',
   volume,turnover,high,low,open,prevClose,marketCap,change,
   speed:null,ytdPct:null,turnoverRate,peTtm,pb,
   quoteTime:chinaTimestamp(f[30]),source:'腾讯财经'
  });
 }
 return rows;
}
export function parseTencentBreadth(raw){
 const parts=[];
 for(const key of ['bkqtRank_A_sh','bkqtRank_A_sz']){
  const m=String(raw).match(new RegExp('v_'+key+'="([^"\\r\\n]*)"'));
  if(!m)return null;
  const f=m[1].split('~');
  const up=num(f[2]),flat=num(f[3]),down=num(f[4]),total=num(f[5]);
  if(![up,flat,down,total].every(v=>Number.isInteger(v)&&v>=0&&v<=10000)||total===0||up+flat+down!==total)return null;
  parts.push({up,flat,down});
 }
 const up=parts.reduce((s,x)=>s+x.up,0),down=parts.reduce((s,x)=>s+x.down,0),flat=parts.reduce((s,x)=>s+x.flat,0);
 if(up+down+flat<500)return null;
 return {up,down,flat,source:'腾讯财经两市涨跌家数'};
}
export async function getMarketIndices(fetchImpl=fetch){
 const raw=await fetchTimeout('https://qt.gtimg.cn/q='+INDEXES.map(x=>x.key).join(','),'text',fetchImpl,7500);
 const indices=parseIndices(raw);
 if(!indices.length)throw Error('主要指数报价暂不可用');
 return indices;
}
export async function getRankings(mode='gainers',scope='all',{fetchImpl=fetch,page=1,size=50,sortKey=null,descending=null,sectorCode=null}={}){
 if(!Object.hasOwn(RANK_MODES,mode))throw Error('不支持的榜单类型');
 const sector=sectorCode!==null;
 if(sector?!/^(?:BK\d{3,6}|pt\d{6,10})$/.test(sectorCode):!Object.hasOwn(SCOPES,scope))throw Error('不支持的行情分类');
 if(sortKey!==null&&!Object.hasOwn(SORT_COLUMNS,sortKey))throw Error('不支持的排序字段');
 if(!Number.isInteger(page)||page<1||page>2000)throw Error('无效页码');
 if(!Number.isInteger(size)||![30,50,60,90,100].includes(size))throw Error('无效每页数量');
 const definition=RANK_MODES[mode];
 const fs=sector?'b:'+sectorCode:SCOPES[scope].fs;
 const fid=sortKey?SORT_COLUMNS[sortKey].fid:definition.fid;
 const po=descending===null?definition.po:(descending?1:0);
 if(sector&&/^pt\d{6,10}$/.test(sectorCode)){
  return getSinaRankings(mode,scope,{fetchImpl,page,size,sortKey,po,sectorCode});
 }
 try{
  const raw=await fetchEastmoneyJson(rankUrl(fs,fid,po,page,size),fetchImpl,6500,{retries:2});
  const parsed=parseRanking(raw);
  if(!parsed.rows.length)throw Error('股票行情当前页暂无有效数据');
  return {...parsed,mode,scope,receivedAt:Date.now(),source:'东方财富',page,size,sortKey:sortKey||mode,descending:po===1};
 }catch(err){
  return getSinaRankings(mode,scope,{fetchImpl,page,size,sortKey,po,sectorCode,primaryErr:err});
 }
}

const SINA_SCOPE_NODES=Object.freeze({all:'hs_a',sh:'sh_a',sz:'sz_a',gem:'cyb',star:'kcb'});
const SINA_SORT_FIELDS=Object.freeze({
 pct:'changepercent',price:'trade',change:'pricechange',volume:'volume',
 turnover:'amount',turnoverRate:'turnoverratio',peTtm:'per',pb:'pb',marketCap:'mktcap',code:'code'
});
export const TENCENT_TO_SINA_SW1=Object.freeze({
 pt01801120:'sw1_340000',pt01801110:'sw1_330000',pt01801150:'sw1_370000',pt01801730:'sw1_630000',
 pt01801210:'sw1_460000',pt01801080:'sw1_270000',pt01801050:'sw1_240000',pt01801880:'sw1_280000',
 pt01801710:'sw1_610000',pt01801780:'sw1_480000',pt01801770:'sw1_730000',pt01801750:'sw1_710000',
 pt01801030:'sw1_220000',pt01801950:'sw1_740000',pt01801230:'sw1_510000',pt01801980:'sw1_770000',
 pt01801010:'sw1_110000',pt01801960:'sw1_750000',pt01801160:'sw1_410000',pt01801170:'sw1_420000',
 pt01801040:'sw1_230000',pt01801140:'sw1_360000',pt01801890:'sw1_640000',pt01801720:'sw1_620000',
 pt01801790:'sw1_490000',pt01801200:'sw1_450000',pt01801180:'sw1_430000',pt01801970:'sw1_760000',
 pt01801130:'sw1_350000',pt01801740:'sw1_650000',pt01801760:'sw1_720000'
});
export function parseSinaRanking(items){
 if(!Array.isArray(items))return [];
 const validPriceOrNull=v=>{const x=num(v);return validPrice(x)?x:null;};
 const ratio=v=>{const x=num(v);return Number.isFinite(x)&&x>=-100&&x<=10000?x:null;};
 return items.map(x=>{
  const m=String(x?.symbol||'').match(/^(sh|sz)((?:60|68|00|30)\d{4})$/);
  const name=String(x?.name||'').trim(),price=num(x?.trade),pct=num(x?.changepercent);
  if(!m||!name||!validPrice(price)||!validPct(pct))return null;
  const code=m[2],exchange=m[1]==='sh'?'SH':'SZ';
  const prevClose=validPriceOrNull(x?.settlement);
  const rawChange=num(x?.pricechange);
  const change=Number.isFinite(rawChange)&&rawChange>-1e13&&rawChange<1e13?rawChange:(prevClose?price-prevClose:null);
  const rawVol=num(x?.volume),rawAmt=num(x?.amount),rawPe=num(x?.per),rawCap=num(x?.mktcap);
  return {
   code,name,price,pct,exchange,
   volume:Number.isFinite(rawVol)&&rawVol>=0?rawVol/100:null,
   turnover:Number.isFinite(rawAmt)&&rawAmt>=0?rawAmt:null,
   high:validPriceOrNull(x?.high),low:validPriceOrNull(x?.low),open:validPriceOrNull(x?.open),prevClose,
   marketCap:Number.isFinite(rawCap)&&rawCap>=0?rawCap*10000:null,
   change,speed:null,ytdPct:null,turnoverRate:ratio(x?.turnoverratio),
   peTtm:Number.isFinite(rawPe)&&rawPe>-1e13&&rawPe<1e13?rawPe:null,
   pb:ratio(x?.pb),quoteTime:null,source:'新浪财经'
  };
 }).filter(Boolean);
}
async function getSinaRankings(mode,scope,{fetchImpl,page,size,sortKey,po,sectorCode=null,primaryErr=null}){
 const sector=sectorCode!==null;
 const node=sector?(Object.hasOwn(TENCENT_TO_SINA_SW1,sectorCode)?TENCENT_TO_SINA_SW1[sectorCode]:null):
  (Object.hasOwn(SINA_SCOPE_NODES,scope)?SINA_SCOPE_NODES[scope]:null);
 const modeSort={gainers:'pct',losers:'pct',turnover:'turnover',volume:'volume',speed:'speed'}[mode];
 const effectiveSort=sortKey||modeSort;
 const sinaSort=Object.hasOwn(SINA_SORT_FIELDS,effectiveSort)?SINA_SORT_FIELDS[effectiveSort]:null;
 if(!node||!sinaSort||(effectiveSort==='code'&&!sector&&scope==='all'&&po===1)){
  const detail=primaryErr?String(primaryErr?.message||primaryErr):'无映射节点';
  throw Error('东财行情接口异常（'+detail+'），备用源暂不支持该分类、排序列或成分股');
 }
 const url='https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?'+
  new URLSearchParams({page:String(page),num:String(size),sort:sinaSort,asc:po===1?'0':'1',node});
 const raw=await fetchTimeout(url,'json',fetchImpl,7500);
 const rows=parseSinaRanking(raw);
 if(!rows.length)throw Error('股票行情当前页暂无有效数据');
 return {rows,total:null,mode,scope,receivedAt:Date.now(),source:'新浪财经',page,size,sortKey:sortKey||mode,descending:po===1};
}

/** Fetches top positive industry sectors and their leading stocks, falling back from Eastmoney BK to Tencent+Sina on failure. */
export async function getSectorLeaders({
 fetchImpl=fetch,
 sectorLoader=getSectors,
 fallbackSectorLoader=getTencentSectors,
 rankingLoader=getRankings,
 filter=s=>s.pct>0&&s.turnover>0,
 limit=3,
 size=30,
 requireSuccess=false
}={}){
 let sectors=(await sectorLoader(fetchImpl)).rows.filter(filter).slice(0,limit);
 let settled=await Promise.allSettled(sectors.map(s=>rankingLoader('turnover','all',{fetchImpl,sectorCode:s.code,size})));
 if(sectors.length&&settled.every(r=>r.status==='rejected')&&sectors.some(s=>!/^pt\d{6,10}$/.test(s.code))&&fallbackSectorLoader){
  sectors=(await fallbackSectorLoader(fetchImpl)).rows.filter(filter).slice(0,limit);
  settled=await Promise.allSettled(sectors.map(s=>rankingLoader('turnover','all',{fetchImpl,sectorCode:s.code,size})));
 }
 if(requireSuccess&&sectors.length&&settled.every(r=>r.status==='rejected'))throw settled[0].reason;
 return sectors.map((sector,i)=>settled[i]?.status==='fulfilled'?{sector,rows:settled[i].value.rows}:null).filter(Boolean);
}

export const TENCENT_INDUSTRY_BOARDS=Object.freeze([
 'pt01801120','pt01801110','pt01801150','pt01801730','pt01801210','pt01801080','pt01801050','pt01801880',
 'pt01801710','pt01801780','pt01801770','pt01801750','pt01801030','pt01801950','pt01801230','pt01801980',
 'pt01801010','pt01801960','pt01801160','pt01801170','pt01801040','pt01801140','pt01801890','pt01801720',
 'pt01801790','pt01801200','pt01801180','pt01801970','pt01801130','pt01801740','pt01801760'
]);
export function parseTencentSectors(raw){
 const rows=[];
 for(const match of String(raw).matchAll(/v_(pt\d{6,10})="([^"\r\n]*)"/g)){
  const f=match[2].split('~'),code=match[1],name=String(f[1]||'').trim(),price=num(f[3]);
  if(f.length<38||!name||!validPrice(price))continue;
  const prevClose=validPrice(num(f[4]))?num(f[4]):null;
  const rawPct=num(f[32]),pct=validPct(rawPct)?rawPct:(prevClose?(price-prevClose)/prevClose*100:null);
  if(pct===null||!validPct(pct))continue;
  const rawVol=num(f[36]),rawTurn=num(f[37]);
  rows.push({
   code,name,price,pct,exchange:'BOARD',
   volume:Number.isFinite(rawVol)&&rawVol>=0?rawVol:null,
   turnover:Number.isFinite(rawTurn)&&rawTurn>=0?rawTurn*10000:null,
   high:validPrice(num(f[33]))?num(f[33]):null,
   low:validPrice(num(f[34]))?num(f[34]):null,
   open:validPrice(num(f[5]))?num(f[5]):null,
   prevClose,marketCap:null,
   change:Number.isFinite(num(f[31]))?num(f[31]):(prevClose?price-prevClose:null),
   speed:null,ytdPct:null,turnoverRate:null,peTtm:null,pb:null,
   quoteTime:chinaTimestamp(f[30]),source:'腾讯财经行业板块'
  });
 }
 return rows;
}
export async function getTencentSectors(fetchImpl=fetch){
 const raw=await fetchTimeout('https://qt.gtimg.cn/q='+TENCENT_INDUSTRY_BOARDS.join(','),'text',fetchImpl,7500);
 const rows=parseTencentSectors(raw);
 if(!rows.length)throw Error('行业板块榜暂无有效数据');
 return {rows:rows.sort((a,b)=>b.pct-a.pct),total:rows.length,source:'腾讯财经行业板块',receivedAt:Date.now()};
}
export async function getSectors(fetchImpl=fetch){
 try{
  const raw=await fetchEastmoneyJson(rankUrl('m:90+t:2','f3',1,1,20),fetchImpl,6500,{retries:2});
  const parsed=parseRanking(raw,{board:true});
  if(parsed.rows.length)return {...parsed,source:'东方财富',receivedAt:Date.now()};
 }catch{/* fallback to Tencent Shenwan industry boards */}
 return getTencentSectors(fetchImpl);
}
export async function getWatchQuotes(codes,fetchImpl=fetch){
 const cleaned=[...new Set(codes)].filter(x=>/^\d{6}$/.test(x)).slice(0,100);
 if(!cleaned.length)return [];
 const secids=cleaned.map(code=>(code.startsWith('6')?'1.':'0.')+code);
 const q=new URLSearchParams({fltt:'2',secids:secids.join(','),
  fields:'f2,f3,f4,f5,f6,f8,f9,f12,f13,f14,f15,f16,f17,f18,f20,f23,f25,f124'});
 let rows=[];
 try{
  const raw=await fetchEastmoneyJson('https://push2.eastmoney.com/api/qt/ulist.np/get?'+q,fetchImpl,6500,{retries:2});
  rows=parseRanking(raw).rows;
 }catch{/* fallback to Tencent batch quotes */}
 const got=new Set(rows.map(x=>x.code));
 const missing=cleaned.filter(c=>!got.has(c));
 if(missing.length){
  for(let i=0;i<missing.length;i+=50){
   const batch=missing.slice(i,i+50).map(c=>(c.startsWith('6')?'sh':'sz')+c).join(',');
   const raw=await fetchTimeout('https://qt.gtimg.cn/q='+batch,'text',fetchImpl,7500);
   rows=[...rows,...parseTencentWatchQuotes(raw)];
  }
 }
 return rows;
}
export async function getMarketBreadth(fetchImpl=fetch){
 const targets=['1.000001','0.399001'];
 const result=await Promise.allSettled(targets.map(async secid=>{
  const url='https://push2.eastmoney.com/api/qt/stock/get?invt=2&fltt=2&fields=f43,f57,f58,f104,f105,f106&secid='+secid;
  return parseMarketBreadth(await fetchEastmoneyJson(url,fetchImpl,6500,{retries:2}));
 }));
 const points=result.map(x=>x.status==='fulfilled'?x.value:null);
 if(!points.some(x=>!x)){
  return {up:points.reduce((s,x)=>s+x.up,0),down:points.reduce((s,x)=>s+x.down,0),
   flat:points.reduce((s,x)=>s+x.flat,0),source:'东方财富指数涨跌家数'};
 }
 try{
  return parseTencentBreadth(await fetchTimeout('https://qt.gtimg.cn/q=bkqtRank_A_sh,bkqtRank_A_sz','text',fetchImpl,7500));
 }catch{return null;}
}
export async function getIndexHistory(key,period='minute',fetchImpl=fetch){
 const index=INDEXES.find(x=>x.key===key);
 if(!index)throw Error('未知指数');
 const fields1='f1,f2,f3,f4,f5,f6',secid=index.secid;
 if(period==='minute'){
  const url='https://push2.eastmoney.com/api/qt/stock/trends2/get?secid='+secid+'&fields1='+fields1+'&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0';
  try{
   const raw=await fetchEastmoneyJson(url,fetchImpl,7500,{retries:2}),bars=parseTrends(raw);
   if(bars.length)return {bars,prevClose:validPrice(Number(raw?.data?.prePrice))?Number(raw.data.prePrice):null,period,source:'东方财富'};
  }catch{/* fallback to Tencent index minute */}
  const qq=await fetchTimeout('https://web.ifzq.gtimg.cn/appstock/app/minute/query?code='+index.key,'json',fetchImpl,8500);
  const parsed=parseTencentMinute(qq,index.key);
  if(!parsed.bars.length)throw Error('指数分时图暂无有效数据');
  return {bars:parsed.bars,prevClose:parsed.prevClose,period,source:'腾讯财经'};
 }
 const klt={day:101,week:102,month:103}[period];
 if(!klt)throw Error('不支持的指数K线周期');
 const url='https://push2his.eastmoney.com/api/qt/stock/kline/get?secid='+secid+'&fields1='+fields1+'&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt='+klt+'&fqt=0&beg=20200101&end=20500101&lmt=120';
 try{
  const raw=await fetchEastmoneyJson(url,fetchImpl,7500,{retries:1}),bars=parseKline(raw);
  if(bars.length)return {bars:bars.slice(-120),period,source:'东方财富',adjustment:'指数原始点位'};
 }catch{/* fallback to Tencent index kline */}
 const qq=await fetchTimeout('https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param='+index.key+','+period+',,,120','json',fetchImpl,8500);
 const bars=parseTencentKline(qq,index.key,period);
 if(!bars.length)throw Error('指数K线暂无有效数据');
 return {bars:bars.slice(-120),period,source:'腾讯财经',adjustment:'指数原始点位'};
}

// Provider-wide symbol suggestion; then independently request quote fields for matched A shares.
export function parseStockSuggestions(payload,query){
 const rows=payload?.QuotationCodeTable?.Data;
 if(!Array.isArray(rows))return [];
 const word=String(query).trim().toLowerCase(),seen=new Set(),out=[];
 for(const row of rows){
  const code=String(row?.Code||''),name=String(row?.Name||'').trim(),market=String(row?.MktNum??''),kind=String(row?.Classify||'');
  if(!/^(?:60|68|00|30)\d{4}$/.test(code)||!name||kind.toLowerCase()!=='astock'||market!==(code.startsWith('6')?'1':'0')||seen.has(code))continue;
  const alias=String(row?.PinYin||row?.Pinyin||'').toLowerCase();
  if(![code,name.toLowerCase(),alias].some(x=>x.includes(word)))continue;
  seen.add(code);out.push({code,name,exchange:market==='1'?'SH':'SZ',alias});
 }
 return out;
}
export async function searchStocks(query,{fetchImpl=fetch,quoteLoader=getWatchQuotes}={}){
 const text=String(query||'').trim().replace(/^(?:sh|sz)(?=\d{6}$)/i,'');
 if(!/^[\u3400-\u9fffA-Za-z0-9*· .-]{1,40}$/.test(text))return {rows:[],total:0,truncated:false};
 if(/^\d{6}$/.test(text)){
  if(!/^(?:60|68|00|30)\d{4}$/.test(text))return {rows:[],total:0,truncated:false};
  const quotes=await quoteLoader([text],fetchImpl);
  const rows=quotes.filter(q=>q.code===text);
  return {rows,total:rows.length,truncated:false};
 }
 const url='https://searchapi.eastmoney.com/api/suggest/get?'+new URLSearchParams({input:text,type:'14',count:'100'});
 const raw=await fetchTimeout(url,'json',fetchImpl,8000);
 if(!Array.isArray(raw?.QuotationCodeTable?.Data)){
  if(raw?.QuotationCodeTable?.Data===null)return {rows:[],total:0,truncated:false};
  throw Error('证券检索接口未返回有效结果');
 }
 const matches=parseStockSuggestions(raw,text),codes=matches.map(x=>x.code);
 let quotes=[],warning='';try{if(codes.length)quotes=await quoteLoader(codes,fetchImpl);}catch{warning='证券匹配成功，报价接口暂不可用';}
 const byCode=new Map(quotes.map(q=>[q.code,q]));
 const rows=matches.map(s=>({...s,...(byCode.get(s.code)||{}),code:s.code,name:s.name,exchange:s.exchange}));
 return {rows,total:rows.length,truncated:raw.QuotationCodeTable.Data.length>=100,warning};
}
