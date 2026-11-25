// Explainable A-share risk appetite proxy; not CNN's index, a calibrated probability, or a trade signal.
import {newsSentiment} from './market-radar.js';
import {session} from './market.js';
export const FEAR_GREED_VERSION='A-SHARE-FG-v1';
export const FG_FACTORS=Object.freeze([
 {id:'breadth',label:'市场涨跌家数',weight:40},
 {id:'momentum',label:'主要指数动量',weight:25},
 {id:'sectors',label:'活跃行业强弱',weight:20},
 {id:'news',label:'财经标题方向',weight:15}
]);
const clip=n=>Math.min(100,Math.max(0,n));
const round=n=>Math.round(n);
const cnDate=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
export function fearGreedLabel(score){
 if(!Number.isFinite(score))return {label:'数据不足',tone:'neutral'};
 return score<=24?{label:'极度恐慌',tone:'fear-extreme'}:score<=44?{label:'恐慌',tone:'fear'}:score<=55?{label:'中性',tone:'neutral'}:score<=75?{label:'贪婪',tone:'greed'}:{label:'极度贪婪',tone:'greed-extreme'};
}
function available(feed,now,limit){
 return !!feed&&!feed.error&&!feed.historical&&Number.isFinite(feed.updatedAt)&&feed.updatedAt<=now&&now-feed.updatedAt<=limit;
}
export function calculateFearGreed({breadth,indices,sectors,news}={},now=Date.now()){
 const open=session(now)==='open',marketTTL=2*60000,newsTTL=20*60000;
 const rows=Array.isArray(indices?.rows)?indices.rows:[];
 const expected=['sh000001','sz399001','sz399006'];
 const valid=expected.map(key=>rows.find(r=>r.key===key)).filter(r=>r&&Number.isFinite(r.pct)&&Math.abs(r.pct)<=30&&Number.isFinite(r.time)&&r.time<=now&&now-r.time<=(open?5*60000:96*3600000)&&(!open||cnDate(r.time)===cnDate(now)));
 const aligned=valid.length===3&&new Set(valid.map(r=>cnDate(r.time))).size===1;
 const marketDate=aligned?cnDate(valid[0].time):null;
 // No date in the breadth API: only treat it as a current fetch proxy, paired with a verified same-session index timestamp.
 // Outside continuous trading show the last dated index only, not an undated cross-session composite.
 const liveMarket=open&&aligned&&available(indices,now,marketTTL);
 const b=breadth?.rows?.[0],bValid=liveMarket&&available(breadth,now,marketTTL)&&b&&[b.up,b.down,b.flat].every(v=>Number.isInteger(v)&&v>=0)&&b.up+b.down+b.flat>=500;
 const boardList=Array.isArray(sectors?.rows)?sectors.rows:[];
 const unique=[...new Map(boardList.filter(r=>r&&typeof r.code==='string'&&/^(?:BK\d{3,6}|pt\d{6,10})$/.test(r.code)&&Number.isFinite(r.pct)&&Math.abs(r.pct)<=100).map(r=>[r.code,r])).values()];
 const sValid=liveMarket&&available(sectors,now,marketTTL)&&unique.length>=20;
 const report=newsSentiment(Array.isArray(news?.rows)?news.rows:[],{now,hours:2});
 const direction=report.counts.positive+report.counts.negative;
 const nValid=available(news,now,newsTTL)&&report.total>=10&&direction>=5&&report.coverage>=30;
 const up=unique.filter(r=>r.pct>0).length,down=unique.filter(r=>r.pct<0).length,flat=unique.length-up-down;
 const avg=aligned?valid.reduce((s,r)=>s+r.pct,0)/3:null;
 const map={
 breadth:{score:bValid?100*(b.up+.5*b.flat)/(b.up+b.down+b.flat):null,detail:bValid?b.up+'涨 / '+b.down+'跌 / '+b.flat+'平（两市指数接口统计口径）':'缺少可靠涨跌家数或非连续交易时段'},
 momentum:{score:liveMarket?clip(50+avg*50/3):null,detail:aligned?'上证、深证成指、创业板指平均 '+avg.toFixed(2)+'%（'+marketDate+'）':'主要指数日期/时效未核验'},
 sectors:{score:sValid?100*(up+.5*flat)/unique.length:null,detail:sValid?up+'涨 / '+down+'跌 / '+flat+'平（成交额前'+unique.length+'个行业样本）':'板块样本不足、过期或非连续交易时段'},
 news:{score:nValid?(report.score+100)/2:null,detail:nValid?report.counts.positive+'正 / '+report.counts.negative+'负 / '+report.total+'条去重标题（近2小时）':'快讯时效、样本数量或方向覆盖不足'}
 };
 const factors=FG_FACTORS.map(f=>({...f,...map[f.id],score:map[f.id].score===null?null:round(map[f.id].score)}));
 const present=factors.filter(f=>f.score!==null),coverage=present.reduce((s,f)=>s+f.weight,0);
 // All three price/breadth factors are required. Optional news is explicitly reweighted.
 const score=liveMarket&&bValid&&sValid?round(present.reduce((s,f)=>s+f.score*f.weight,0)/coverage):null;
 return {version:FEAR_GREED_VERSION,score,coverage,factors,marketDate,asOf:now,session:open?'连续交易':'非连续交易',...fearGreedLabel(score)};
}
