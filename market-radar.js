import {fetchTimeout,fetchEastmoneyJson} from './market.js';
import {parseRanking,getTencentSectors} from './market-center.js';

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
 '新能源','涨价','订单','业绩','出口','关税','英伟达','Anthropic','上涨','下跌','反弹','跳水','减持','增持','制裁','出口管制','光模块','存储','复职','超预期','裁员'
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
const NEWS_ALT_URL='https://np-listapi.eastmoney.com/comm/web/getFastNewsList';
const THS_NEWS_URL='https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website';
const CHANGE_URL='https://push2ex.eastmoney.com/getAllStockChanges';
export function parse10jqkaNews(payload){
 const list=payload?.data?.list;
 if(!Array.isArray(list))return [];
 const seen=new Set();
 return list.map(x=>{
  const title=String(x?.title||'').replace(/<[^>]*>/g,'').trim().slice(0,120);
  const id=String(x?.id||x?.seq||'');
  const sec=Number(x?.ctime??x?.rtime);
  const date=Number.isFinite(sec)&&sec>1500000000&&sec<3500000000?sec*1000:NaN;
  if(title.length<4||!Number.isFinite(date)||seen.has(id+title))return null;
  seen.add(id+title);
  const timeLabel=new Date(date).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}).replace('T',' ');
  return {id:id||title,title,time:date,timeLabel,source:'同花顺7×24'};
 }).filter(Boolean).sort((a,b)=>b.time-a.time);
}
export async function getLiveSectors(fetchImpl=fetch){
 try{
  const raw=await fetchEastmoneyJson(SECTOR_URL,fetchImpl,6500,{retries:2});
  const sectors=parseRanking(raw,{board:true}).rows;
  if(sectors.length){
   return {rows:sectors.sort((a,b)=>(b.turnover||0)-(a.turnover||0)).slice(0,36),total:raw?.data?.total??null,
    receivedAt:Date.now(),source:'东方财富行业板块'};
  }
 }catch{/* fallback to Tencent Shenwan industry boards */}
 const fallback=await getTencentSectors(fetchImpl);
 return {rows:[...fallback.rows].sort((a,b)=>(b.turnover||0)-(a.turnover||0)).slice(0,36),
  total:fallback.total,receivedAt:fallback.receivedAt,source:fallback.source};
}
export function parseNewsSnapshot(payload,{now=Date.now(),maxAgeMs=2*3600000}={}){
 if(!payload||payload.schema!==1||!Array.isArray(payload.articles))throw Error('同域快讯格式无效');
 const fetchedAt=Date.parse(String(payload.fetchedAt||''));
 if(!Number.isFinite(fetchedAt)||fetchedAt>now+300000||now-fetchedAt>maxAgeMs)
  throw Error('同域快讯快照过期，不能当成实时新闻');
 const rows=parseFastNews({data:{fastNewsList:payload.articles.map(x=>({
  code:x.id, title:x.title, showTime:x.showTime
 }))}});
 if(!rows.length)throw Error('同域快讯没有真实标题记录');
 return {rows,source:'东方财富7×24 · GitHub Pages同域快照',receivedAt:fetchedAt,
  via:'snapshot',warning:payload.state==='stale'||now-fetchedAt>20*60000?'沿用真实历史快讯，非实时':''};
}
export async function getLiveNews(fetchImpl=fetch,{
 trace=()=>String(Date.now())+'-'+Math.random().toString(36).slice(2),
 snapshotUrl='./data/fast-news.json',
 now=()=>Date.now()
}={}){
 const q=new URLSearchParams({client:'web',biz:'web_724',fastColumn:'102',sortEnd:'',pageSize:'60',req_trace:trace()});
 let liveError='';
 for(const [endpoint,label] of [[NEWS_URL,'东方财富7×24快讯（直连）'],[NEWS_ALT_URL,'东方财富7×24快讯（备用域）']]){
  try{
   const raw=await fetchTimeout(endpoint+'?'+q,'json',fetchImpl,4200);
   const rows=parseFastNews(raw);
   if(!rows.length)throw Error('新闻接口无有效标题');
   return {rows,source:label,receivedAt:now(),via:'live',warning:''};
  }catch(err){liveError=String(err?.message||err);}
 }
 try{
  const raw=await fetchTimeout(THS_NEWS_URL,'json',fetchImpl,4500);
  const rows=parse10jqkaNews(raw);
  if(!rows.length)throw Error('同花顺快讯无有效标题');
  return {rows,source:'同花顺7×24快讯（直连）',receivedAt:now(),via:'live',warning:''};
 }catch(err){liveError=(liveError?liveError+'；':'')+String(err?.message||err);}
 try{
  // Same-origin Pages file bypasses the user's cross-origin news-host restrictions.
  const cacheBust=Math.floor(now()/60000);
  const joiner=snapshotUrl.includes('?')?'&':'?';
  const snapshot=await fetchTimeout(snapshotUrl+joiner+'v='+cacheBust,'json',fetchImpl,6500);
  return parseNewsSnapshot(snapshot,{now:now(),maxAgeMs:24*3600000});
 }catch(err){
  throw Error('新闻源直连失败：'+liveError+'；同域备份失败：'+String(err?.message||err));
 }
}

export async function getLiveChanges(fetchImpl=fetch){
 const q=new URLSearchParams({type:CHANGE_TYPES,ut:'7eea3edcaed734bea9cbfc24409ed989',
  pageindex:'0',pagesize:'100',dpt:'wzchanges'});
 const raw=await fetchEastmoneyJson(CHANGE_URL+'?'+q,fetchImpl,7500,{retries:2});
 const rows=parseChangeEvents(raw);
 if(!rows.length)throw Error('盘口异动接口没有有效记录');
 return {rows,total:Number(raw?.data?.tc)||null,source:'东方财富盘口异动',
  receivedAt:Date.now()};
}

// Directional title wording, NOT investor/social sentiment or a price prediction.
export const NEWS_TONES=Object.freeze({positive:['上涨','大涨','拉升','反弹','涨停','创新高','增持','回购','中标','超预期','扭亏为盈','获批','增长','上调','突破','复产','复职'],negative:['下跌','大跌','跳水','跌停','新低','减持','亏损','下调','裁员','处罚','立案','制裁','禁令','违约','砍单','终止','暴跌','下降','低于预期','撤回','辞职','出口管制']});
export function classifyHeadline(title){
 const text=String(title||''),positive=[],negative=[];
 for(const [kind,words] of Object.entries(NEWS_TONES))for(const word of words){
  let start=0,i;
  while((i=text.indexOf(word,start))>=0){
   start=i+word.length;
   if(/(?:未见|没有|并未|否认|未|不|无)$/.test(text.slice(Math.max(0,i-3),i)))continue;
   (kind==='positive'?positive:negative).push(word);break;
  }
 }
 // "亏损收窄" is an explicitly mixed headline, not pure negative.
 if(/亏损收窄|跌幅收窄/.test(text))positive.push('收窄');
 return {tone:positive.length&&negative.length?'mixed':positive.length?'positive':negative.length?'negative':'neutral',positive,negative};
}
export function newsSentiment(news,{now=Date.now(),hours=2}={}){
 const seen=new Set(),rows=[];
 for(const n of [...news].sort((a,b)=>b.time-a.time)){
  if(!Number.isFinite(n?.time)||n.time>now||now-n.time>hours*3600000||!n.title)continue;
  const key=String(n.title).replace(/\s+/g,'').trim();
  if(seen.has(key))continue;seen.add(key);rows.push({...n,...classifyHeadline(n.title)});
 }
 const counts={positive:0,negative:0,mixed:0,neutral:0};
 for(const row of rows)counts[row.tone]++;
 const directional=counts.positive+counts.negative;
 return {rows,counts,total:rows.length,score:directional?Math.round((counts.positive-counts.negative)/directional*100):null,
  coverage:rows.length?Math.round(directional/rows.length*100):0};
}
export function sentimentTerms(report,options={}){
 return getNewsTerms(report.rows,{...options,now:options.now??Date.now(),maxAgeMs:(options.hours??2)*3600000}).map(term=>{
  const matching=report.rows.filter(n=>n.title.toUpperCase().includes(term.word.toUpperCase()));
  const c={positive:0,negative:0,mixed:0,neutral:0};for(const n of matching)c[n.tone]++;
  const tone=c.positive>c.negative?'positive':c.negative>c.positive?'negative':c.mixed||c.positive?'mixed':'neutral';
  return {...term,tone,counts:c};
 });
}
