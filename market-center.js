import {fetchTimeout,parseTrends,parseKline,validPrice,chinaTimestamp} from './market.js';

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
 star:{label:'科创板',fs:'m:1+t:23'}
});
export const RANK_MODES=Object.freeze({
 gainers:{label:'涨幅榜',fid:'f3',po:1},
 losers:{label:'跌幅榜',fid:'f3',po:0},
 turnover:{label:'成交额榜',fid:'f6',po:1},
 volume:{label:'成交量榜',fid:'f5',po:1}
});
const num=x=>typeof x==='number'?x:Number(x);
const validPct=x=>Number.isFinite(x)&&x>=-100&&x<=100;
const rankUrl=(fs,fid,po,page,size)=>{
 const q=new URLSearchParams({pn:String(page),pz:String(size),po:String(po),np:'1',fltt:'2',invt:'2',fid,fs,
 fields:'f2,f3,f4,f5,f6,f7,f8,f12,f13,f14,f15,f16,f17,f18,f20,f21,f22,f23,f124'});
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
  return {code,name,price,pct,exchange:board?'BOARD':Number(x.f13)===1?'SH':'SZ',
   volume:n('f5'),turnover:n('f6'),high:priceOrNull('f15'),low:priceOrNull('f16'),
   open:priceOrNull('f17'),prevClose:priceOrNull('f18'),marketCap:n('f20'),
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
export async function getMarketIndices(fetchImpl=fetch){
 const raw=await fetchTimeout('https://qt.gtimg.cn/q='+INDEXES.map(x=>x.key).join(','),'text',fetchImpl,7500);
 const indices=parseIndices(raw);
 if(!indices.length)throw Error('主要指数报价暂不可用');
 return indices;
}
export async function getRankings(mode='gainers',scope='all',{fetchImpl=fetch,page=1,size=50}={}){
 if(!RANK_MODES[mode]||!SCOPES[scope])throw Error('不支持的榜单类型');
 const sort=RANK_MODES[mode],fs=SCOPES[scope].fs;
 const raw=await fetchTimeout(rankUrl(fs,sort.fid,sort.po,page,Math.min(100,Math.max(1,size))),'json',fetchImpl,9000);
 const parsed=parseRanking(raw);
 if(!parsed.rows.length)throw Error('股票排行暂无有效行情');
 return {...parsed,mode,scope,receivedAt:Date.now(),source:'东方财富',page};
}
export async function getSectors(fetchImpl=fetch){
 const raw=await fetchTimeout(rankUrl('m:90+t:2','f3',1,1,20),'json',fetchImpl,9000);
 const parsed=parseRanking(raw,{board:true});
 if(!parsed.rows.length)throw Error('行业板块榜暂无有效数据');
 return {...parsed,source:'东方财富',receivedAt:Date.now()};
}
export async function getMarketBreadth(fetchImpl=fetch){
 const targets=['1.000001','0.399001'];
 const result=await Promise.allSettled(targets.map(async secid=>{
  const url='https://push2.eastmoney.com/api/qt/stock/get?invt=2&fltt=2&fields=f43,f57,f58,f104,f105,f106&secid='+secid;
  return parseMarketBreadth(await fetchTimeout(url,'json',fetchImpl,9000));
 }));
 const points=result.map(x=>x.status==='fulfilled'?x.value:null);
 if(points.some(x=>!x))return null;
 return {up:points.reduce((s,x)=>s+x.up,0),down:points.reduce((s,x)=>s+x.down,0),
  flat:points.reduce((s,x)=>s+x.flat,0),source:'东方财富指数涨跌家数'};
}
export async function getIndexHistory(key,period='minute',fetchImpl=fetch){
 const index=INDEXES.find(x=>x.key===key);
 if(!index)throw Error('未知指数');
 const fields1='f1,f2,f3,f4,f5,f6',secid=index.secid;
 if(period==='minute'){
  const url='https://push2.eastmoney.com/api/qt/stock/trends2/get?secid='+secid+'&fields1='+fields1+'&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0';
  const raw=await fetchTimeout(url,'json',fetchImpl,9000),bars=parseTrends(raw);
  if(!bars.length)throw Error('指数分时图暂无有效数据');
  return {bars,prevClose:Number(raw?.data?.prePrice)||null,period,source:'东方财富'};
 }
 const klt={day:101,week:102,month:103}[period];
 if(!klt)throw Error('不支持的指数K线周期');
 const url='https://push2his.eastmoney.com/api/qt/stock/kline/get?secid='+secid+'&fields1='+fields1+'&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt='+klt+'&fqt=0&beg=20200101&end=20500101&lmt=120';
 const raw=await fetchTimeout(url,'json',fetchImpl,9000),bars=parseKline(raw);
 if(!bars.length)throw Error('指数K线暂无有效数据');
 return {bars:bars.slice(-120),period,source:'东方财富',adjustment:'指数原始点位'};
}
