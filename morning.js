// 11:30 Shanghai-time M5 research scan. Never places or fills an order.
// Public endpoint requests happen later; bars are strictly cut off at 11:30.
// The constituent universe is discovered at request time and must be labeled
// as such (NOT an unbiased historical pre-noon universe).
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {getMarketData,dailyBars,capPercent} from './bot.js';
import {getHistory,fetchTimeout,parseTrends} from './market.js';
import {fees,feeTotal} from './engine.js';

const OUTPUT=fileURLToPath(new URL('./data/morning.json',import.meta.url));
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export const SH_TIMEZONE='Asia/Shanghai';
export function shParts(now=new Date()){
 const f=new Intl.DateTimeFormat('en-GB',{timeZone:SH_TIMEZONE,
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  .formatToParts(now);
 const part=x=>f.find(z=>z.type===x)?.value;
 return {date:[part('year'),part('month'),part('day')].join('-'),clock:part('hour')+':'+part('minute')};
}
export function atMorningClose(bars,date){
 const capped=bars.filter(b=>typeof b.date==='string'&&b.date.startsWith(date+' ')&&
  b.date.slice(11,16)<='11:30'&&b.date.slice(11,16)>='09:30');
 const latest=capped.at(-1);
 if(!latest||latest.date.slice(11,16)<'11:25'||!Number.isFinite(latest.price)||latest.price<=0)
  throw Error('缺少上午11:25-11:30可靠分时点');
 return {price:latest.price,time:latest.date,
  volume:capped.reduce((sum,x)=>sum+(Number.isFinite(x.volume)&&x.volume>=0?x.volume:0),0)};
}
export function morningScore(stock,historical,morning,boardPct,config){
 const prev=historical.filter(x=>x.date<stock.date);
 if(prev.length<20)throw Error('缺少20个完整历史交易日');
 const five=prev.slice(-5),twenty=prev.slice(-19);
 const fullDayMean=five.reduce((a,b)=>a+b.volume,0)/5;
 const halfDayExpected=fullDayMean*.5;
 const halfDayRatio=halfDayExpected>0?morning.volume/halfDayExpected:null;
 const provisionalMA20=(twenty.reduce((sum,x)=>sum+x.close,0)+morning.price)/20;
 const trend=morning.price>provisionalMA20;
 const volume=halfDayRatio!==null&&halfDayRatio>=config.volumeMultiplier;
 const sector=Number.isFinite(boardPct)&&boardPct>config.minSectorChangePct;
 const pct=round((morning.price/prev.at(-1).close-1)*100);
 return {score:Number(sector)+Number(volume)+Number(trend),passed:sector&&volume&&trend,
  price:morning.price,pct,provisionalMA20:round(provisionalMA20),
  halfDayVolume:morning.volume,halfDayVolumeRatio:halfDayRatio===null?null:round(halfDayRatio),
  reasons:[
   sector?'板块截至11:30涨'+boardPct.toFixed(2)+'%':'板块上午涨幅未达标或无可靠数据',
   volume?'上午成交量/近5日全天均量一半 = '+round(halfDayRatio)+'倍':'上午相对成交量不足或不可核验',
   trend?'11:30价格高于暂算MA20':'11:30价格未站上暂算MA20'
  ]};
}
export function proposedOrder(stock,score,account){
 if(!score.passed)return null;
 const prev=stock.prevClose,limit=capPercent(stock.code,stock.name);
 if(!Number.isFinite(prev)||prev<=0||score.price>=round(prev*(1+limit))-.01)
  return {code:stock.code,name:stock.name,side:'BUY',status:'阻断',
   reason:'11:30价格接近涨停/缺少昨收，不能假设可买'};
 const limitCash=account.initialCash*account.models.M5.positionFraction;
 let qty=Math.floor(limitCash/score.price/100)*100;
 while(qty>0){
  const gross=round(qty*score.price);
  if(gross+feeTotal(fees('BUY',gross))<=limitCash)break;
  qty-=100;
 }
 if(qty<100)return {code:stock.code,name:stock.name,side:'BUY',status:'阻断',reason:'100股整手预算不足'};
 return {code:stock.code,name:stock.name,side:'BUY',status:'待执行（仅拟单）',
  referencePrice:score.price,quantity:qty,budgetLimit:limitCash,
  signalTime:stock.morningTime,reason:score.reasons.join('；'),
  note:'下午参考委托，不是实际订单；执行前必须重新核验最新价、可成交性和风控'};
}
async function boardMorningPct(boardCode,date,fetchImpl=fetch){
 if(!/^BK\d{3,6}$/.test(boardCode))return null;
 const q=new URLSearchParams({secid:'90.'+boardCode,fields1:'f1,f2,f3,f4,f5,f6',
  fields2:'f51,f52,f53,f54,f55,f56,f57,f58',ndays:'1',iscr:'0'});
 const data=await fetchTimeout('https://push2.eastmoney.com/api/qt/stock/trends2/get?'+q,'json',fetchImpl,8500);
 const minute=atMorningClose(parseTrends(data),date),prev=Number(data?.data?.prePrice);
 if(!Number.isFinite(prev)||prev<=0)return null;
 return round((minute.price/prev-1)*100);
}
export async function scanMorning({
 now=new Date(),getData=getMarketData,historyLoader=getHistory,
 barsLoader=dailyBars,sectorLoader=boardMorningPct,
 account=JSON.parse(readFileSync(new URL('./data/bot.json',import.meta.url),'utf8'))
}={}){
 const {date,clock}=shParts(now);
 if(clock<'11:35')throw Error('11:35前不允许生成上午收盘信号');
 const data=await getData();
 if(data.date!==date)throw Error('指数交易日 '+data.date+' 与北京时间 '+date+' 不符');
 const cfg=account.models.M5,universe=data.universe||[];
 const boardValues=new Map();
 for(const stock of universe){
  if(!stock.sectorCode||boardValues.has(stock.sectorCode))continue;
  try{boardValues.set(stock.sectorCode,await sectorLoader(stock.sectorCode,date));}
  catch(err){boardValues.set(stock.sectorCode,null);}
 }
 const candidates=[];
 for(const stock of universe){
  try{
   const [hist,trend]=await Promise.all([
    barsLoader(stock.code),historyLoader(stock.code,'minute')
   ]);
   const morning=atMorningClose(trend.bars,date);
   const latest=hist.filter(x=>x.date<date).at(-1);
   if(!latest)throw Error('缺少上一交易日收盘价');
   const computed=morningScore({...stock,date},hist,morning,
    boardValues.get(stock.sectorCode),cfg);
   candidates.push({code:stock.code,name:stock.name,sector:stock.sector,
    sectorCode:stock.sectorCode,sectorMorningPct:boardValues.get(stock.sectorCode),
    prevClose:latest.close,morningTime:morning.time,...computed});
  }catch(err){
   candidates.push({code:stock.code,name:stock.name,sector:stock.sector,
    sectorCode:stock.sectorCode,score:0,passed:false,price:null,
    error:String(err?.message||err),reasons:['上午数据不足，未产生有效信号']});
  }
 }
 candidates.sort((a,b)=>b.score-a.score||(b.halfDayVolumeRatio||0)-(a.halfDayVolumeRatio||0));
 const orders=[];
 for(const c of candidates.filter(x=>x.passed).slice(0,cfg.maxPositions)){
  const proposal=proposedOrder(c,c,account);
  if(proposal)orders.push(proposal);
 }
 return {
  schema:1,modelId:'M5',date,cutoff:date+' 11:30',runAt:now.toISOString(),
  source:'东方财富行业及分时接口（上午11:30截止）',
  universeNote:'候选板块成分股在执行时获取，可能包含午后筛选偏差；所有用于评分的行情截断至11:30。',
  volumeNote:'上午成交量与近5个完整交易日均量的50%比较，是粗略近似，不是严格的同一时段同比。',
  maNote:'MA20用19个已收盘交易日+上午11:30价格暂算，不使用下午收盘价。',
  accountInitialCash:account.initialCash,
  scanned:universe.length,candidates,orders,
  status:orders.some(x=>x.status==='待执行（仅拟单）')?'存在下午拟单':'暂无合格可执行拟单',
  execution:'不自动模拟成交：这次任务只生成下午选股与拟单；下午执行需重新核验价格，不能提前记账。'
 };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1],import.meta.url))){
 scanMorning().then(data=>{
  console.log(JSON.stringify({date:data.date,scanned:data.scanned,status:data.status,
   top:data.candidates.slice(0,12),orders:data.orders},null,2));
  if(!process.argv.includes('--dry-run')){
   writeFileSync(OUTPUT,JSON.stringify(data,null,2)+'\n');
   console.log('Saved '+OUTPUT);
  }
 }).catch(err=>{console.error('Morning scan aborted:',err);process.exitCode=1;});
}
