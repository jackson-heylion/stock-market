// One-off 2026-11-24 09:35 (Shanghai) opening-five-minute conditional paper orders.
// Uses GitHub Actions; NEVER sends orders to a broker or changes browser-local manual holdings.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateBot,dailyBars,capPercent} from './bot.js';
import {getHistory,getQuotes,quoteState} from './market.js';
import {getSectors} from './market-center.js';
import {fees,feeTotal} from './engine.js';

const PATH=fileURLToPath(new URL('./data/bot.json',import.meta.url));
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export const ZONE='Asia/Shanghai';
export function shClock(date){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  .formatToParts(date instanceof Date?date:new Date(date));
 const val=k=>parts.find(x=>x.type===k)?.value;
 return {date:[val('year'),val('month'),val('day')].join('-'),clock:val('hour')+':'+val('minute')};
}
export function firstFiveBars(minute,date){
 const times=['09:31','09:32','09:33','09:34','09:35'];
 const bars=times.map(t=>minute.find(x=>x.date===date+' '+t));
 if(bars.some(x=>!x||!(x.price>0)||!Number.isFinite(x.volume)||x.volume<0))
  throw Error('09:31至09:35五根完整分钟数据缺失');
 const open=minute.find(x=>x.date===date+' 09:30')?.open||bars[0].open||bars[0].price;
 const last=bars.at(-1).price;
 if(!Number.isFinite(open)||open<=0)throw Error('开盘价缺失');
 return {openingPrice:open,closeAt935:last,volume:bars.reduce((s,x)=>s+x.volume,0),
  barTime:bars.at(-1).date};
}
export function evaluateOpening(candidate,{daily,minute,quote,sectors},plan,now){
 const checks=[],notes=[];
 const add=(name,pass,detail)=>{checks.push({name,pass,detail});if(!pass)notes.push(name+'：'+detail);};
 const prev=daily.filter(x=>x.date<plan.targetDate).slice(-25);
 if(prev.length<20)throw Error(candidate.code+'缺少20个完整交易日');
 if(prev.at(-1).date!==plan.previousDate)throw Error(candidate.code+'上一交易日K线尚未更新');
 const first=firstFiveBars(minute,plan.targetDate);
 const pre=prev.at(-1),price=quote.price,cap=capPercent(candidate.code,candidate.name);
 const quoteAt=shClock(quote.time),quoteFresh=quoteState(quote,now.getTime()).tradable;
 const mid=prev.slice(-20).reduce((s,x)=>s+x.close,0)/20;
 const avgFive=prev.slice(-5).reduce((s,x)=>s+x.volume,0)/5;
 const ratio=avgFive>0?first.volume/(avgFive/48):0;
 const gain=(price/pre.close-1)*100;
 const limit=round(pre.close*(1+cap));
 const latestTo935=(price/first.closeAt935-1)*100;
 const matched=Number.isFinite(quote.prevClose)&&
  Math.abs(quote.prevClose/pre.close-1)<=0.005;
 add('报价时间',quoteFresh&&quoteAt.date===plan.targetDate&&quoteAt.clock>='09:35',
  quoteFresh?'报价日期或时点不正确':'当前报价超过15秒或不在交易时段');
 add('昨收一致',matched,'券商行情昨收与历史日K不一致，暂停撮合');
 add('开盘五分钟放量',ratio>=plan.rules.minOpeningVolumeRatio,
  '09:31-09:35量比 '+round(ratio)+'，阈值 '+plan.rules.minOpeningVolumeRatio);
 add('趋势突破',price>mid&&first.closeAt935>=first.openingPrice&&latestTo935>=-1,
  '现价 '+round(price)+' / MA20 '+round(mid)+' / 五分钟开盘价 '+round(first.openingPrice));
 add('涨幅不过热',gain>=plan.rules.minGainPct&&gain<=plan.rules.maxGainPct,
  '较昨收涨幅 '+round(gain)+'%，要求 '+plan.rules.minGainPct+'%～'+plan.rules.maxGainPct+'%');
 add('未接近涨停',price<limit-plan.rules.minLimitDistanceYuan&&price<=limit,
  '涨停参考价 '+limit+'，当前价 '+round(price));
 if(candidate.sectorRequired){
  const board=sectors.find(x=>candidate.sectorKeywords.some(k=>x.name.includes(k)));
  const fresh=!!board&&Number.isFinite(board.pct)&&board.pct>0;
  add('板块共振',fresh,
   board?board.name+' '+board.pct.toFixed(2)+'%':'行业榜前20名无可验证的强势PCB板块');
 }
 return {code:candidate.code,name:candidate.name,modelId:candidate.modelId,
  candidateBasis:candidate.basis,passed:checks.every(c=>c.pass),checks,
  reason:checks.every(c=>c.pass)?'开盘5分钟量价与风控条件全部通过':notes.join('；'),
  quoteTime:new Date(quote.time).toISOString(),quotePrice:price,ma20:round(mid),
  openingVolumeRatio:round(ratio),openingPrice:first.openingPrice,
  fiveMinuteClose:first.closeAt935,prevClose:pre.close,gainPct:round(gain)};
}
function buy(next,item,plan,now){
 if(next.holdings[item.code])return {...item,status:'未下单',reason:'机器人账户已持有该股票'};
 if(Object.keys(next.holdings).length>=next.models.M5.maxPositions)
  return {...item,status:'未下单',reason:'持仓数量达到上限'};
 // Preserve previously queued same-symbol buy instructions rather than buying twice.
 if(next.pending.some(o=>o.code===item.code&&o.side==='BUY'))
  return {...item,status:'未下单',reason:'已有同股待执行模拟买入指令'};
 const cashLimit=Math.min(next.cash,next.initialCash*plan.rules.maxPerStockFraction);
 const maxPrice=round(item.quotePrice*(1+plan.rules.slippagePct));
 let quantity=Math.floor(cashLimit/maxPrice/100)*100;
 while(quantity>=100){
  const gross=round(quantity*maxPrice),fee=feeTotal(fees('BUY',gross));
  if(gross+fee<=cashLimit+0.0001)break;
  quantity-=100;
 }
 if(quantity<100)return {...item,status:'未下单',reason:'资金不足以购买100股（含手续费和滑点）'};
 const gross=round(quantity*maxPrice),fee=feeTotal(fees('BUY',gross));
 next.cash=round(next.cash-gross-fee);
 next.holdings[item.code]={code:item.code,name:item.name,quantity,cost:round(gross+fee),
  avgCost:round((gross+fee)/quantity),buyDate:plan.targetDate,
  lastPrice:item.quotePrice,lastPriceDate:plan.targetDate,modelId:item.modelId};
 const trade={id:'B'+(next.trades.length+1),date:plan.targetDate,
  executedAt:now.toISOString(),quoteTime:item.quoteTime,side:'BUY',
  code:item.code,name:item.name,quantity,price:maxPrice,gross,fee,modelId:item.modelId,
  reason:item.reason,source:'腾讯财经当前报价+0.1%不利滑点；GitHub Actions开盘五分钟模拟'};
 next.trades.push(trade);
 return {...item,status:'模拟已成交',quantity,price:maxPrice,gross,fee,
  executedAt:trade.executedAt,tradeId:trade.id};
}
export function openingState(state,{now,market=null}){
 validateBot(state);
 const plan=state.openFive;
 if(!plan||!plan.enabled||plan.status==='completed'||plan.status==='expired')
  return {changed:false,state,message:'没有尚未执行的一次性开盘买入计划'};
 const local=shClock(now);
 if(local.date!==plan.targetDate)
  return {changed:false,state,message:'仅在'+plan.targetDate+'开盘执行，当前为'+local.date};
 if(local.clock<'09:36')
  return {changed:false,state,message:'09:35前五分钟未形成完整信号，不提前执行'};
 if(local.clock>'09:44'){
  const expired=structuredClone(state);
  expired.openFive={...plan,status:'expired',checkedAt:now.toISOString(),
   results:[],message:'GitHub Actions错过09:36-09:44允许执行的时段，禁止倒填交易'};
  return {changed:true,state:expired,message:expired.openFive.message};
 }
 if(!market)throw Error('行情尚未核验，不得模拟成交');
 const next=structuredClone(state),out=[];
 if(market.date!==plan.targetDate)throw Error('行情交易日不匹配，拒绝模拟成交');
 for(const candidate of plan.candidates){
  const data=market.candidates[candidate.code];
  if(!data||!data.quote||!data.daily||!data.minute)
   throw Error('候选股票行情缺失 '+candidate.code);
  const evaluated=evaluateOpening(candidate,{...data,sectors:market.sectors||[]},plan,now);
  out.push(evaluated.passed?buy(next,evaluated,plan,now):
   {...evaluated,status:'未触发'});
 }
 next.openFive={...plan,status:'completed',checkedAt:now.toISOString(),results:out,
  message:'规则核验完成，模拟成交 '+out.filter(x=>x.status==='模拟已成交').length+
   ' 笔；其他股票未触发或风控阻断'};
 next.updatedAt=now.toISOString();
 return {changed:true,state:next,message:next.openFive.message};
}
export async function liveSnapshot(plan,{quoteLoader=getQuotes,dailyLoader=dailyBars,
 minuteLoader=getHistory,sectorLoader=getSectors,now=new Date()}={}){
 const codes=plan.candidates.map(x=>x.code);
 const [quotes,boards,...rows]=await Promise.all([
  quoteLoader(codes),
  sectorLoader(),
  ...codes.map(async code=>{
   const [daily,trend]=await Promise.all([
    dailyLoader(code),minuteLoader(code,'minute')
   ]);
   return {code,daily,minute:trend.bars};
  })
 ]);
 if(!Array.isArray(quotes.quotes)||quotes.quotes.length!==codes.length)
  throw Error('候选股实时行情未完整取得');
 if(!Array.isArray(boards.rows))throw Error('板块行情不可用');
 const candidates={};
 for(const row of rows){
  const quote=quotes.quotes.find(q=>q.code===row.code);
  if(!quote)throw Error('候选股缺报价 '+row.code);
  candidates[row.code]={...row,quote};
 }
 return {date:shClock(now).date,candidates,sectors:boards.rows};
}
export async function executeOpening(state,{now=()=>new Date(),snapshot=liveSnapshot}={}){
 const date=now(),plan=state.openFive;
 if(!plan||shClock(date).date!==plan.targetDate||
   shClock(date).clock<'09:36'||shClock(date).clock>'09:44'||
   plan.status==='completed'||plan.status==='expired')
  return openingState(state,{now:date});
 const market=await snapshot(plan,{now:date});
 // The event time is the actual observation time, never backdated to 09:35.
 return openingState(state,{now:now(),market});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1],import.meta.url))){
 const state=validateBot(JSON.parse(readFileSync(PATH,'utf8')));
 executeOpening(state).then(result=>{
  console.log(result.message);
  if(result.changed&&!process.argv.includes('--dry-run')){
   writeFileSync(PATH,JSON.stringify(result.state,null,2)+'\n');
   console.log('Updated robot-only account: '+PATH);
  }
 }).catch(err=>{console.error('Opening bot refused to alter balance:',err);process.exitCode=1;});
}
