import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {getMarketBreadth,getMarketIndices} from '../market-center.js';
import {getLiveSectors,getLiveChanges,parseNewsSnapshot} from '../market-radar.js';
import {calculateFearGreed} from '../fear-greed.js';
const path='data/radar-market.json';
const prior=(()=>{try{return JSON.parse(readFileSync(path,'utf8'));}catch{return {};}})();
const keys=['breadth','indices','sectors','changes'];
const loaders=[async()=>{const b=await getMarketBreadth();if(!b)throw Error('涨跌家数未获取');return {rows:[b],source:b.source,receivedAt:Date.now()};},async()=>({rows:await getMarketIndices(),source:'腾讯财经主要指数',receivedAt:Date.now()}),getLiveSectors,getLiveChanges];
const results=await Promise.allSettled(loaders.map(fn=>fn()));
const checkedAt=Date.now(),dateAt=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const indices=results[1].status==='fulfilled'?results[1].value.rows:[],main=['sh000001','sz399001','sz399006'].map(key=>indices.find(x=>x.key===key));
const aligned=main.every(x=>Number.isFinite(x?.time)&&x.time<=checkedAt&&checkedAt-x.time<=96*3600000)&&new Set(main.map(x=>dateAt(x.time))).size===1;
const marketDate=aligned?dateAt(main[0].time):null;
const feeds={};
for(let i=0;i<keys.length;i++){
 const key=keys[i],result=results[i],f=result.status==='fulfilled'?result.value:null;
 // Untimestamped breadth/board/event snapshots must be paired with the same collection's verified index session.
 const usable=f?.rows?.length&&(key==='indices'?aligned:marketDate!==null);
 if(usable)feeds[key]={rows:f.rows,source:f.source,receivedAt:f.receivedAt||checkedAt,marketDate,error:''};
 else{
  const previous=prior.feeds?.[key],error=result.status==='rejected'?String(result.reason?.message||result.reason):'缺少可核验交易日或有效记录';
  feeds[key]={...(previous?.rows?.length&&checkedAt-previous.receivedAt<=96*3600000?previous:{rows:[],receivedAt:0,marketDate:null,source:''}),error:error.slice(0,180)};
 }
 console.log(JSON.stringify({key,count:feeds[key].rows.length,receivedAt:feeds[key].receivedAt,marketDate:feeds[key].marketDate,error:feeds[key].error}));
}
const input=Object.fromEntries(keys.map(k=>[k,{...feeds[k],updatedAt:feeds[k].receivedAt}]));
try{const n=parseNewsSnapshot(JSON.parse(readFileSync('data/fast-news.json','utf8')),{now:checkedAt});input.news={rows:n.rows,updatedAt:n.receivedAt};}catch{}
const fg=calculateFearGreed(input,checkedAt);
const lastFearGreed=fg.score!==null?fg:prior.lastFearGreed&&checkedAt-prior.lastFearGreed.asOf<=96*3600000?prior.lastFearGreed:null;
writeFileSync(path+'.tmp',JSON.stringify({schema:1,checkedAt,feeds,lastFearGreed}));renameSync(path+'.tmp',path);
console.log(JSON.stringify({fearGreed:fg.score,lastFearGreed:lastFearGreed?.score??null}));
