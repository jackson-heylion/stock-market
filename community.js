import {fetchTimeout} from './market.js';
import {classifyHeadline,getNewsTerms} from './market-radar.js';
const POS=['看多','看涨','加仓','低吸','抄底','抢筹','牛市','起飞','反包','一字板','满仓','冲高','主升浪','买入','反转'];
const NEG=['看空','看跌','减仓','清仓','割肉','套牢','诱多','砸盘','出货','恐慌','跳水','熊市','亏怕','害怕','高开低走','不追高','不要追','风险','卖出','跌停'];
const negated=(text,i)=>/(?:不|别|莫|勿|没有|并未|否认|不要)$/.test(text.slice(Math.max(0,i-3),i));
export function classifyCommunity(title){
 const text=String(title||''),base=classifyHeadline(text),positive=new Set(base.positive),negative=new Set(base.negative);
 for(const [list,set] of [[POS,positive],[NEG,negative]])for(const word of list){
  const i=text.indexOf(word);if(i>=0&&!negated(text,i))set.add(word);
 }
 if(/(?:不|别|不要|勿|莫)追(?:高)?/.test(text))negative.add('谨慎追高');
 if(/(?:不|别|不要)太?乐观/.test(text))negative.add('谨慎');
 const tone=positive.size&&negative.size?'mixed':positive.size?'positive':negative.size?'negative':'neutral';
 return {tone,positive:[...positive],negative:[...negative]};
}
const validCount=n=>Number.isInteger(n)&&n>=0&&n<=1e9?n:null;
export function parseCommunity(payload,{now=Date.now()}={}){
 if(payload?.schema!==1||!Array.isArray(payload.posts)||!Array.isArray(payload.boards))throw Error('社区快照格式无效');
 const fetchedAt=Date.parse(payload.fetchedAt);
 if(!Number.isFinite(fetchedAt)||fetchedAt>now||now-fetchedAt>24*3600000)throw Error('社区快照过期');
 const seen=new Set(),rows=[];
 for(const x of payload.posts){
  const id=String(x?.id||''),code=String(x?.code||''),title=String(x?.title||'').trim().slice(0,160),t=Date.parse(x?.publishedAt);
  const source=x?.source||'东方财富股吧';
  let url=null,timeKind='published';
  if(source==='东方财富股吧'&&/^\d{5,20}$/.test(id)&&/^(?:\d{6}|zs(?:sh|sz)\d{6})$/.test(code))url='https://guba.eastmoney.com/news,'+code+','+id+'.html';
  if(source==='虎扑'&&code==='hupu'&&/^\d{5,20}$/.test(id)){url='https://bbs.hupu.com/'+id+'.html';timeKind='activity';}
  if(source==='淘股吧'&&code==='tgb'&&/^[A-Za-z0-9]{5,30}$/.test(id))url='https://www.tgb.cn/a/'+id;
  const key=source+':'+id;
  if(!url||title.length<2||!Number.isFinite(t)||t>now||now-t>86400000||seen.has(key))continue;
  seen.add(key);
  rows.push({id,code,title,board:String(x.board||code).slice(0,30),time:t,timeKind,source,url,
   reads:validCount(x.reads),comments:validCount(x.comments),...classifyCommunity(title)});
 }
 const boards=payload.boards.slice(0,24).map(b=>({source:b?.source==='虎扑'||b?.source==='淘股吧'?b.source:'东方财富股吧',code:String(b?.code||''),board:String(b?.board||'').slice(0,30),status:['ok','blocked','unavailable'].includes(b?.status)?b.status:'unavailable',count:validCount(b?.count),error:String(b?.error||'').slice(0,180)}));
 const unavailable=!rows.length&&boards.every(b=>b.status!=='ok');
 return {rows:rows.sort((a,b)=>b.time-a.time),source:'股吧 / 虎扑 / 淘股吧 · 同域快照',receivedAt:fetchedAt,boards,historical:payload.state!=='fresh'||now-fetchedAt>20*60000,warning:unavailable?'全部来源未取得可核验讨论，请查看采集状态':boards.some(b=>b.status!=='ok')?'部分讨论区不可用，保留近期真实标题':''};
}
export async function getCommunity(fetchImpl=fetch,{now=()=>Date.now()}={}){
 return parseCommunity(await fetchTimeout('./data/community.json?v='+Math.floor(now()/60000),'json',fetchImpl,8000),{now:now()});
}
export function communityReport(rows,{now=Date.now(),hours=2,board='all',source='all'}={}){
 const unique=new Set(),selected=[];
 for(const row of rows){
  if(row.time>now||now-row.time>hours*3600000||board!=='all'&&row.code!==board||source!=='all'&&row.source!==source)continue;
  const key=row.title.replace(/\s+/g,'').trim();if(unique.has(key))continue;unique.add(key);selected.push({...row,...classifyCommunity(row.title)});
 }
 const counts={positive:0,negative:0,mixed:0,neutral:0};for(const r of selected)counts[r.tone]++;
 const directional=counts.positive+counts.negative;
 const score=selected.length>=10&&directional>=5?Math.round(100*(counts.positive-counts.negative)/directional):null;
 const terms=getNewsTerms(selected,{now,maxAgeMs:hours*3600000,limit:24}).map(t=>{
  const hits=selected.filter(x=>x.title.toUpperCase().includes(t.word.toUpperCase()));
  const pos=hits.filter(x=>x.tone==='positive').length,neg=hits.filter(x=>x.tone==='negative').length;
  return {...t,tone:pos>neg?'positive':neg>pos?'negative':pos||hits.some(x=>x.tone==='mixed')?'mixed':'neutral'};
 });
 const boards=[...new Set(selected.map(x=>x.code))].map(code=>{
  const posts=selected.filter(x=>x.code===code),positive=posts.filter(x=>x.tone==='positive').length,negative=posts.filter(x=>x.tone==='negative').length;
  return {code,name:posts[0].board,count:posts.length,positive,negative,comments:posts.some(x=>x.comments!==null)?posts.reduce((s,x)=>s+(x.comments??0),0):null};
 }).sort((a,b)=>b.count-a.count);
 return {rows:selected,counts,score,total:selected.length,coverage:selected.length?Math.round(directional/selected.length*100):0,terms,boards};
}
