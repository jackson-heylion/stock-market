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
 fields:'f2,f3,f4,f5,f6,f7,f8,f12,f13,f14,f15,f16,f17,f18,f20,f21,f22,f23,f25,f124'});
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
export async function getMarketIndices(fetchImpl=fetch){
 const raw=await fetchTimeout('https://qt.gtimg.cn/q='+INDEXES.map(x=>x.key).join(','),'text',fetchImpl,7500);
 const indices=parseIndices(raw);
 if(!indices.length)throw Error('主要指数报价暂不可用');
 return indices;
}
export async function getRankings(mode='gainers',scope='all',{fetchImpl=fetch,page=1,size=50,sortKey=null,descending=null,sectorCode=null}={}){
 if(!Object.hasOwn(RANK_MODES,mode))throw Error('不支持的榜单类型');
 const sector=sectorCode!==null;
 if(sector?!/^BK\d{3,6}$/.test(sectorCode):!Object.hasOwn(SCOPES,scope))throw Error('不支持的行情分类');
 if(sortKey!==null&&!Object.hasOwn(SORT_COLUMNS,sortKey))throw Error('不支持的排序字段');
 if(!Number.isInteger(page)||page<1||page>2000)throw Error('无效页码');
 if(!Number.isInteger(size)||![30,50,60,90,100].includes(size))throw Error('无效每页数量');
 const definition=RANK_MODES[mode];
 const fs=sector?'b:'+sectorCode:SCOPES[scope].fs;
 const fid=sortKey?SORT_COLUMNS[sortKey].fid:definition.fid;
 const po=descending===null?definition.po:(descending?1:0);
 const raw=await fetchTimeout(rankUrl(fs,fid,po,page,size),'json',fetchImpl,9000);
 const parsed=parseRanking(raw);
 if(!parsed.rows.length)throw Error('股票行情当前页暂无有效数据');
 return {...parsed,mode,scope,receivedAt:Date.now(),source:'东方财富',page,size,sortKey:sortKey||mode,descending:po===1};
}

export async function getSectors(fetchImpl=fetch){
 const raw=await fetchTimeout(rankUrl('m:90+t:2','f3',1,1,20),'json',fetchImpl,9000);
 const parsed=parseRanking(raw,{board:true});
 if(!parsed.rows.length)throw Error('行业板块榜暂无有效数据');
 return {...parsed,source:'东方财富',receivedAt:Date.now()};
}
export async function getWatchQuotes(codes,fetchImpl=fetch){
 const cleaned=[...new Set(codes)].filter(x=>/^\d{6}$/.test(x)).slice(0,100);
 if(!cleaned.length)return [];
 const secids=cleaned.map(code=>(code.startsWith('6')?'1.':'0.')+code);
 const q=new URLSearchParams({fltt:'2',secids:secids.join(','),
  fields:'f2,f3,f4,f5,f6,f8,f9,f12,f13,f14,f15,f16,f17,f18,f20,f23,f25,f124'});
 const raw=await fetchTimeout('https://push2.eastmoney.com/api/qt/ulist.np/get?'+q,'json',fetchImpl,9000);
 return parseRanking(raw).rows;
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
 const quotes=codes.length?await quoteLoader(codes,fetchImpl):[];
 const byCode=new Map(quotes.map(q=>[q.code,q]));
 const rows=matches.map(s=>({...s,...(byCode.get(s.code)||{}),code:s.code,name:s.name,exchange:s.exchange}));
 return {rows,total:rows.length,truncated:raw.QuotationCodeTable.Data.length>=100};
}
