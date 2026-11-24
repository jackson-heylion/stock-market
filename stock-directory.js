import {SECURITIES} from './seed.js';
import {getWatchQuotes,searchStocks} from './market-center.js';
import {getQuotes,fetchTimeout} from './market.js';
const validCode=c=>/^(?:60|68|00|30)\d{4}$/.test(c);
const normalize=x=>String(x??'').normalize('NFKC').toLowerCase().replace(/\s/g,'');
const identity=(code,name,alias='')=>({code,name,exchange:code.startsWith('6')?'SH':'SZ',alias});
const seedAliases={'600520':'sjkj','601133':'bcgf','300829':'jdkj','603931':'gld','600156':'hsgf','000635':'ylt','301348':'ljdz','002579':'zjdz'};
let catalogPromise;
export function parseDirectory(payload){
 if(payload?.schema!==1||!Array.isArray(payload.rows)||payload.rows.length>10000)throw Error('证券目录格式无效');
 const seen=new Map();
 for(const row of payload.rows){
  if(!Array.isArray(row)||!validCode(row[0])||typeof row[1]!=='string'||!row[1].trim()||row[1].length>40)continue;
  seen.set(row[0],identity(row[0],row[1].trim(),typeof row[2]==='string'?row[2].slice(0,100):''));
 }
 if(seen.size<4500||[...seen.keys()].filter(c=>c.startsWith('68')).length<400)throw Error('证券目录覆盖不足');
 return [...seen.values()];
}
export function localMatches(query,rows){
 const word=normalize(query).replace(/^(?:sh|sz)(?=\d{6}$)/,'');
 if(!word)return [];
 return rows.filter(r=>[r.code,normalize(r.name),normalize(r.alias)].some(s=>s.includes(word)))
  .sort((a,b)=>Number(b.code===word||normalize(b.name)===word)-Number(a.code===word||normalize(a.name)===word)||a.code.localeCompare(b.code));
}
export async function loadDirectory(fetchImpl=fetch){
 if(!catalogPromise)catalogPromise=fetchTimeout('./data/stock-directory.json','json',fetchImpl,5000).then(parseDirectory).catch(err=>{catalogPromise=null;throw err;});
 return catalogPromise;
}
export async function enrichIdentities(matches,{fetchImpl=fetch,quoteLoader=getWatchQuotes,basicLoader=getQuotes}={}){
 const codes=matches.map(s=>s.code);if(!codes.length)return {rows:[],warning:''};
 let detailed=[],basic=[],warn=[];
 try{detailed=await quoteLoader(codes,fetchImpl);}catch{warn.push('东财详细行情不可用');}
 const byCode=new Map(detailed.filter(q=>codes.includes(q.code)&&Number.isFinite(q.price)&&q.price>0).map(q=>[q.code,q]));
 const missing=codes.filter(c=>!byCode.has(c));
 if(missing.length){
  try{for(let i=0;i<missing.length;i+=30){const result=await basicLoader(missing.slice(i,i+30),{fetchImpl});basic.push(...(result.quotes||[]));}}catch{}
  for(const q of basic)if(missing.includes(q.code)&&Number.isFinite(q.price)&&q.price>0)byCode.set(q.code,{price:q.price,prevClose:q.prevClose,pct:q.pct,change:Number.isFinite(q.prevClose)?q.price-q.prevClose:null,quoteTime:q.time,source:q.source});
 }
 const unavailable=codes.filter(c=>!byCode.has(c)).length;
 if(basic.length)warn.push('部分使用腾讯/备用基础报价，缺失指标显示--');
 if(unavailable)warn.push(unavailable+'只证券报价不可用，保留目录匹配');
 return {rows:matches.map(s=>({...s,...byCode.get(s.code),code:s.code,name:byCode.get(s.code)?.name||s.name,exchange:s.exchange})),warning:warn.join('；')};
}
export async function searchDirectoryStocks(query,{fetchImpl=fetch,directoryLoader=loadDirectory,onlineSearch=searchStocks,quoteLoader=getWatchQuotes,basicLoader=getQuotes,knownRows=[]}={}){
 const word=normalize(query).replace(/^(?:sh|sz)(?=\d{6}$)/,'');
 if(!word)return {rows:[],total:0,truncated:false,warning:''};
 const known=new Map(SECURITIES.map(s=>[s.code,identity(s.code,s.name,seedAliases[s.code])]));
 for(const s of knownRows)if(validCode(s.code)&&typeof s.name==='string')known.set(s.code,identity(s.code,s.name,s.alias||seedAliases[s.code]));
 let available=false,warning='';
 try{for(const s of await directoryLoader(fetchImpl))known.set(s.code,s);available=true;}catch{warning='证券目录暂不可用，已启用原观察池/最近访问降级';}
 let matches=localMatches(word,[...known.values()]);
 // A directory match is sufficient to find the security. Remote search is only a supplement for new listings or aliases.
 if(!matches.length){
  try{const r=await onlineSearch(query,{fetchImpl,quoteLoader});if(r.rows.length)return {...r,searchSource:'在线证券检索',warning:[warning,r.warning].filter(Boolean).join('；')};}
  catch{warning=[warning,'在线证券检索不可用'].filter(Boolean).join('；');}
  return {rows:[],total:0,truncated:false,searchSource:available?'本地证券目录（可能滞后）':'有限本地观察池',warning:warning||'目录及在线接口均未匹配'};
 }
 const truncated=matches.length>100;matches=matches.slice(0,100);
 const enriched=await enrichIdentities(matches,{fetchImpl,quoteLoader,basicLoader});
 return {...enriched,total:enriched.rows.length,truncated,searchSource:available?'本地沪深证券目录':'本地观察池/最近访问',warning:[warning,enriched.warning].filter(Boolean).join('；')};
}
