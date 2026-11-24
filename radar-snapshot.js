import {fetchTimeout} from './market.js';
import {FEAR_GREED_VERSION} from './fear-greed.js';
export const MARKET_KEYS=['breadth','indices','sectors','changes'];
const TTL=96*3600000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s);
export function parseRadarSnapshot(payload,{now=Date.now()}={}){
 if(payload?.schema!==1||!payload.feeds||!finite(payload.checkedAt)||payload.checkedAt>now+60000)throw Error('市场快照格式无效');
 const feeds={};
 for(const key of MARKET_KEYS){
  const f=payload.feeds[key];
  if(!f||!Array.isArray(f.rows))continue;
  const rows=f.rows.filter(r=>{
   if(!r||typeof r!=='object')return false;
   if(key==='breadth')return [r.up,r.down,r.flat].every(v=>Number.isInteger(v)&&v>=0&&v<=10000)&&r.up+r.down+r.flat>=500;
   if(key==='indices')return /^(?:sh|sz)\d{6}$/.test(r.key)&&finite(r.pct)&&finite(r.time)&&r.time<=now&&finite(r.price)&&r.price>0;
   if(key==='sectors')return /^BK\d{3,6}$/.test(r.code)&&typeof r.name==='string'&&finite(r.pct)&&Math.abs(r.pct)<=100&&finite(r.turnover)&&r.turnover>=0;
   return /^\d{6}$/.test(r.code)&&typeof r.name==='string'&&/^\d{2}:\d{2}:\d{2}$/.test(r.time)&&typeof r.info==='string';
  }).slice(0,key==='changes'?100:key==='sectors'?36:key==='indices'?5:1);
  const valid=finite(f.receivedAt)&&f.receivedAt<=now&&now-f.receivedAt<=TTL;
  feeds[key]={rows:valid?rows:[],receivedAt:valid&&rows.length?f.receivedAt:0,source:String(f.source||'公开行情')+' · 同域快照',marketDate:dateOK(f.marketDate)?f.marketDate:null,warning:valid&&rows.length?'同域快照（非实时）'+(f.error?'；上游异常，保留上次成功数据':''):'未取得有效快照',error:String(f.error||'').slice(0,180),historical:true};
 }
 const fg=payload.lastFearGreed;
 const lastFearGreed=fg?.version===FEAR_GREED_VERSION&&Number.isInteger(fg.score)&&fg.score>=0&&fg.score<=100&&finite(fg.asOf)&&fg.asOf<=now&&now-fg.asOf<=TTL&&dateOK(fg.marketDate)&&Array.isArray(fg.factors)&&fg.factors.length===4?fg:null;
 return {feeds,lastFearGreed,checkedAt:payload.checkedAt};
}
let pending=null,cache=null,cacheAt=0;
export async function getRadarSnapshot(fetchImpl=fetch,{now=()=>Date.now()}={}){
 if(cache&&now()-cacheAt<30000)return cache;
 if(!pending)pending=fetchTimeout('./data/radar-market.json?v='+Math.floor(now()/60000),'json',fetchImpl,6500).then(x=>{cache=parseRadarSnapshot(x,{now:now()});cacheAt=now();return cache;}).finally(()=>pending=null);
 return pending;
}
export async function withRadarFallback(key,load,{snapshotLoader=getRadarSnapshot}={}){
 try{return await load();}catch(err){
  const reason=String(err.message||err);
  try{const snapshot=await snapshotLoader(),f=snapshot.feeds[key];if(f?.rows.length)return {...f,warning:f.warning+'；直连失败：'+reason,lastFearGreed:snapshot.lastFearGreed};if(f?.error)throw Error(f.error);}catch(e){throw Error('直连失败：'+reason+'；快照：'+String(e.message||e));}
  throw Error('直连失败：'+reason+'；同域快照无有效记录');
 }
}
