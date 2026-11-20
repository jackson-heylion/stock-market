import {fetchTimeout} from './market.js';
import {parseRanking} from './market-center.js';

export const CHANGE_LABELS=Object.freeze({
  8201:'火箭发射',8202:'快速反弹',8193:'大笔买入',4:'封涨停板',32:'打开跌停板',
  64:'有大买盘',8207:'竞价上涨',8209:'高开5日线',8211:'向上缺口',
  8213:'60日新高',8215:'60日大幅上涨',8204:'加速下跌',8203:'高台跳水',
  8194:'大笔卖出',8:'封跌停板',16:'打开涨停板',128:'有大卖盘',
  8208:'竞价下跌',8210:'低开5日线',8212:'向下缺口',8214:'60日新低',8216:'60日大幅下跌'
});
const NEGATIVE_TYPES=new Set([8204,8203,8194,8,16,128,8208,8210,8212,8214,8216]);
const TRADE_TYPES=new Set([8193,8194,64,128]);
export const CHANGE_TYPES=Object.keys(CHANGE_LABELS).join(',');
const num=x=>(x===null||x===undefined||x===''||x==='-'||x==='--')?NaN:Number(x);
export function parseChangeEvents(payload){
 const items=payload?.data?.allstock;
 if(!Array.isArray(items))return [];
 const seen=new Set();
 return items.map(x=>{
  const code=String(x?.c??''),name=String(x?.n??'').trim();
  const type=num(x?.t),clock=String(x?.tm??'').padStart(6,'0');
  const hh=Number(clock.slice(0,2)),mm=Number(clock.slice(2,4)),ss=Number(clock.slice(4,6));
  if(!/^\d{6}$/.test(code)||!name||!Number.isInteger(type)||!/^\d{6}$/.test(clock)||
    hh>23||mm>59||ss>59)return null;
  const time=clock.slice(0,2)+':'+clock.slice(2,4)+':'+clock.slice(4);
  const info=String(x.i??'').slice(0,160);
  const id=[code,type,clock,info].join(':');
  if(seen.has(id))return null;seen.add(id);
  const category=TRADE_TYPES.has(type)?'flow':NEGATIVE_TYPES.has(type)?'down':'up';
  return {id,code,name,time,type,label:CHANGE_LABELS[type]||'其他异动',category,info,
    market:Number(x.m)===1?'SH':'SZ'};
 }).filter(Boolean);
}
export function parseFastNews(payload){
 const list=payload?.data?.fastNewsList;
 if(!Array.isArray(list))return [];
 const seen=new Set();
 return list.map(x=>{
  const title=String(x?.title||'').replace(/<[^>]*>/g,'').trim().slice(0,120);
  const code=String(x?.code||'');
  const showTime=String(x?.showTime||'');
  const date=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(showTime)?
    Date.parse(showTime.replace(' ','T')+'+08:00'):NaN;
  if(title.length<4||!Number.isFinite(date)||seen.has(code+title))return null;
  seen.add(code+title);
  return {id:code||title,title,time:date,timeLabel:showTime,source:'东方财富7×24'};
 }).filter(Boolean).sort((a,b)=>b.time-a.time);
}
export const NEWS_STOP_WORDS=new Set([
 '公司','股份','集团','市场','表示','发布','相关','今日','昨日','最新','近日',
 '目前','今年','记者','消息','股市','行业','消息称','已经','一个','一项','这一','继续',
 '中国','美国','方面','对于','消息','数据显示','机构','投资','股票','企业','超过',
 '有关','正在','进行','成为','据悉','其中','这些','以及','全球','国内',
 '业务','技术','平台','发展','同比','同比增长','实现','消息人士','宣布','公告',
 '全国','记者','上周','本周','周五','支持','价格','上涨','下跌','涨幅','跌幅',
 '今日','昨日','近日','同比','消息','万元','亿元','日本','欧洲','美元',
 'ETF','A股','沪指','最新','首次','高达','其中','预计'
]);
// Controlled concept matcher only counts terms that literally occur in a real headline.
// It supplements general Chinese tokenization of compound names (e.g. 智元机器人).
export const NEWS_CONCEPT_TERMS=Object.freeze([
 '机器人','算力','芯片','半导体','AI','PCB','光伏','储能','电力','电池','光刻胶',
 '商业航天','无人驾驶','脑机接口','量子','大模型','人工智能','数据中心',
 '并购','重组','涨停','跌停','减持','增持','融资','稀土','黄金','固态电池',
 '新能源','涨价','订单','业绩','出口','关税','英伟达','Anthropic'
]);
export function getNewsTerms(news,{now=Date.now(),maxAgeMs=2*3600000,limit=36}={}){
 const eligible=news.filter(n=>Number.isFinite(n?.time)&&n.time<=now+300000&&now-n.time<=maxAgeMs);
 const terms=new Map();
 let segmenter=null;
 try{if(typeof Intl.Segmenter==='function')segmenter=new Intl.Segmenter('zh',{granularity:'word'});}catch{}
 for(const n of eligible){
  const title=String(n.title||''),found=new Set();
  const raw=segmenter?[...segmenter.segment(title)].filter(p=>p.isWordLike).map(p=>p.segment):
   title.match(/[\u4e00-\u9fff]{2,8}|[A-Za-z]{2,12}/g)||[];
  for(let token of raw){
   token=token.trim();
   if(!/^(?:[\u4e00-\u9fff]{2,8}|[A-Za-z]{2,12})$/.test(token))continue;
   const normalized=/^[A-Za-z]+$/.test(token)?token.toUpperCase():token;
   if(NEWS_STOP_WORDS.has(normalized)||NEWS_STOP_WORDS.has(token))continue;
   found.add(normalized);
  }
  for(const concept of NEWS_CONCEPT_TERMS){
   if(title.toUpperCase().includes(concept.toUpperCase()))found.add(concept);
  }
  for(const token of found)terms.set(token,(terms.get(token)||0)+1);
 }
 return [...terms.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh'))
  .slice(0,Math.min(limit,50)).map(([word,count])=>({word,count}));
}
export function treemapLayout(items,width=100,height=100){
 if(!Array.isArray(items)||!items.length)return [];
 const maxTurnover=Math.max(1,...items.map(x=>Number.isFinite(x.turnover)?x.turnover:0));
 const nodes=items.map((item,i)=>({...item,weight:Math.max(maxTurnover*.08,Number(item.turnover)||0),index:i}));
 const result=[];
 function split(group,x,y,w,h){
  if(!group.length)return;
  if(group.length===1){result.push({...group[0],x,y,w,h});return;}
  const total=group.reduce((s,v)=>s+v.weight,0),target=total/2;
  let index=0,subtotal=0;
  while(index<group.length-1&&subtotal<target){subtotal+=group[index].weight;index++;}
  const ratio=subtotal/total;
  if(w>=h){
   const firstW=w*ratio;
   split(group.slice(0,index),x,y,firstW,h);
   split(group.slice(index),x+firstW,y,w-firstW,h);
  }else{
   const firstH=h*ratio;
   split(group.slice(0,index),x,y,w,firstH);
   split(group.slice(index),x,y+firstH,w,h-firstH);
  }
 }
 split(nodes,0,0,width,height);
 return result;
}
const SECTOR_URL='https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=80&po=1&np=1&fltt=2&invt=2&fid=f6&fs=m:90+t:2&fields=f2,f3,f6,f8,f12,f13,f14,f22,f124';
const NEWS_URL='https://np-weblist.eastmoney.com/comm/web/getFastNewsList';
const CHANGE_URL='https://push2ex.eastmoney.com/getAllStockChanges';
export async function getLiveSectors(fetchImpl=fetch){
 const raw=await fetchTimeout(SECTOR_URL,'json',fetchImpl,10000);
 const sectors=parseRanking(raw,{board:true}).rows;
 if(!sectors.length)throw Error('板块接口未返回有效行情');
 return {rows:sectors.sort((a,b)=>(b.turnover||0)-(a.turnover||0)).slice(0,36),total:raw?.data?.total??null,
  receivedAt:Date.now(),source:'东方财富行业板块'};
}
export async function getLiveNews(fetchImpl=fetch,{trace=()=>String(Date.now())+'-'+Math.random().toString(36).slice(2)}={}){
 const q=new URLSearchParams({client:'web',biz:'web_724',fastColumn:'102',sortEnd:'',pageSize:'60',req_trace:trace()});
 const raw=await fetchTimeout(NEWS_URL+'?'+q,'json',fetchImpl,10000);
 const rows=parseFastNews(raw);
 if(!rows.length)throw Error('7×24快讯暂未返回真实标题');
 return {rows,source:'东方财富7×24快讯',receivedAt:Date.now()};
}
export async function getLiveChanges(fetchImpl=fetch){
 const q=new URLSearchParams({type:CHANGE_TYPES,ut:'7eea3edcaed734bea9cbfc24409ed989',
  pageindex:'0',pagesize:'100',dpt:'wzchanges'});
 const raw=await fetchTimeout(CHANGE_URL+'?'+q,'json',fetchImpl,10000);
 const rows=parseChangeEvents(raw);
 if(!rows.length)throw Error('盘口异动接口没有有效记录');
 return {rows,total:Number(raw?.data?.tc)||null,source:'东方财富盘口异动',
  receivedAt:Date.now()};
}
