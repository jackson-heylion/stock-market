// One-file A-share paper bot. No broker, database, intraday fill claims or new dependencies.
// After-close signal on D -> hypothetical executable close on next actual trading session D+1.
// Public quote APIs are best effort; fail closed when today's data cannot be verified.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {getSectors,getRankings} from './market-center.js';
import {fees,feeTotal} from './engine.js';

const ACCOUNT_PATH=fileURLToPath(new URL('./data/bot.json',import.meta.url));
const BASE='https://push2his.eastmoney.com/api/qt/stock/kline/get';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const fmtDate=(instant=new Date())=>new Intl.DateTimeFormat('en-CA',{
 timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'
}).format(instant).replace(/\//g,'-');
const timeOfDay=(instant=new Date())=>new Intl.DateTimeFormat('en-GB',{
 timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
}).format(instant);

export function validateBot(state){
 if(!state||state.schema!==1||!Number.isFinite(state.cash)||state.cash<0||
 !Number.isFinite(state.initialCash)||state.initialCash<=0||
 !state.models?.M5||!Array.isArray(state.trades)||!Array.isArray(state.signals)||
 !Array.isArray(state.pending)||!state.holdings||!Array.isArray(state.history))throw Error('Invalid bot account');
 return state;
}
export function parseDaily(payload){
 const lines=payload?.data?.klines;
 if(!Array.isArray(lines))throw Error('Daily OHLCV data absent');
 return lines.map(line=>{
  const [date,open,close,high,low,volume]=String(line).split(',');
  const q={date,open:Number(open),close:Number(close),high:Number(high),low:Number(low),volume:Number(volume)};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(q.date)||![q.open,q.close,q.high,q.low].every(n=>Number.isFinite(n)&&n>0)||
     !Number.isFinite(q.volume)||q.volume<0||q.high+0.01<Math.max(q.open,q.close,q.low)||
     q.low-0.01>Math.min(q.open,q.close))return null;
  return q;
 }).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date));
}
export async function dailyBars(code,{fetchImpl=fetch,timeoutMs=9000}={}){
 const secid=code==='sh000001'?'1.000001':
  /^(?:6\d{5}|0\d{5}|3\d{5})$/.test(code)?
   (code.startsWith('6')?'1.':'0.')+code:null;
 if(!secid)throw Error('Unsupported A-share '+code);
 const query=new URLSearchParams({secid,fields1:'f1,f2,f3,f4,f5,f6',
  fields2:'f51,f52,f53,f54,f55,f56,f57',klt:'101',fqt:'0',
  beg:'20250101',end:'20500101',lmt:'35'});
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);
 try{
  const response=await fetchImpl(BASE+'?'+query,{signal:ctrl.signal,headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('OHLCV HTTP '+response.status+' '+code);
  const result=parseDaily(await response.json());
  if(!result.length)throw Error('No valid daily bars '+code); // New listings may have <22, and M5 must simply score 0.
  return result;
 }finally{clearTimeout(timer);}
}
export function m5(stock,bars,settings){
 if(!Array.isArray(bars)||bars.length<22)return {score:0,passed:false,reasons:['缺少22根有效日K'],volumeRatio:null,ma20:null};
 const today=bars.at(-1),previous=bars.slice(-6,-1),last20=bars.slice(-20);
 const avg5=previous.reduce((v,x)=>v+x.volume,0)/5;
 const ma20=last20.reduce((v,x)=>v+x.close,0)/20;
 const ratio=avg5>0?today.volume/avg5:0;
 const sectorOk=Number(stock?.sectorPct)>Number(settings.minSectorChangePct??0);
 const volumeOk=ratio>=Number(settings.volumeMultiplier);
 const trendOk=today.close>ma20;
 return {score:Number(sectorOk)+Number(volumeOk)+Number(trendOk),
  passed:sectorOk&&volumeOk&&trendOk,
  volumeRatio:round(ratio),ma20:round(ma20),
  reasons:[
   sectorOk?'板块上涨 '+stock.sectorPct.toFixed(2)+'%':'板块热度不足',
   volumeOk?'放量 '+ratio.toFixed(2)+'倍':'成交量未达到阈值',
   trendOk?'收盘价高于MA20':'价格未突破MA20'
  ]};
}
export function capPercent(code,name=''){
 if(/\*?ST/i.test(name))return 0.05;
 return /^(300|301|688|689)/.test(code)?0.20:0.10;
}
export function fillable(order,bars,date){
 if(!bars||bars.length<2||bars.at(-1).date!==date)return {ok:false,reason:'今日无该股有效日K，不能假设成交'};
 const today=bars.at(-1),prev=bars.at(-2);
 if(today.volume<=0)return {ok:false,reason:'没有有效成交量'};
 const limit=capPercent(order.code,order.name),upper=round(prev.close*(1+limit)),lower=round(prev.close*(1-limit));
 if(order.side==='BUY'&&today.close>=upper-0.01)return {ok:false,reason:'接近涨停价，无法证明可以买到'};
 if(order.side==='SELL'&&today.close<=lower+0.01)return {ok:false,reason:'接近跌停价，无法证明卖得出'};
 if(order.side==='SELL'&&today.close>upper+0.01)return {ok:false,reason:'异常行情价'};
 const slip=0.001,price=round(today.close*(order.side==='BUY'?1+slip:1-slip));
 if(price<=0)return {ok:false,reason:'无效模拟价格'};
 return {ok:true,price,close:today.close,source:'东方财富未复权收盘价+0.1%模拟滑点'};
}
export function botEquity(state,barsByCode,date){
 let marketValue=0,missing=0;
 for(const h of Object.values(state.holdings)){
  const bar=barsByCode[h.code]?.at(-1);
  if(bar?.date===date){h.lastPrice=bar.close;h.lastPriceDate=date;}
  else missing++;
  marketValue+=h.quantity*(h.lastPrice||h.avgCost);
 }
 return {cash:round(state.cash),marketValue:round(marketValue),
  total:round(state.cash+marketValue),missingQuotes:missing};
}
const canSell=(hold,date)=>hold&&hold.quantity>0&&hold.buyDate<date;
function settle(next,date,barsByCode,previousMarketDate=null){
 const oldOrders=next.pending.filter(o=>o.signalDate<date);
 const later=next.pending.filter(o=>o.signalDate>=date);
 oldOrders.sort((a,b)=>a.side===b.side?0:a.side==='SELL'?-1:1);
 for(const order of oldOrders){
  if(previousMarketDate&&order.signalDate!==previousMarketDate){
   next.events.push({date,code:order.code,action:order.side,status:'过期',
    reason:'错过信号后的首个交易日，拒绝补记成交'});continue;
  }
  const verdict=fillable(order,barsByCode[order.code],date),hold=next.holdings[order.code];
  if(!verdict.ok){next.events.push({date,code:order.code,action:order.side,status:'未成交',reason:verdict.reason});continue;}
  if(order.side==='SELL'){
   if(!canSell(hold,date)){next.events.push({date,code:order.code,action:'SELL',status:'未成交',reason:'可卖持仓不足或T+1'});continue;}
   const gross=round(verdict.price*hold.quantity),charge=feeTotal(fees('SELL',gross));
   const pnl=round(gross-charge-hold.cost);
   next.cash=round(next.cash+gross-charge);
   next.trades.push({id:'B'+(next.trades.length+1),date,signalDate:order.signalDate,side:'SELL',
    modelId:order.modelId,code:order.code,name:order.name,quantity:hold.quantity,
    price:verdict.price,gross,fee:charge,pnl,reason:order.reason,source:verdict.source});
   delete next.holdings[order.code];
   continue;
  }
  if(next.holdings[order.code])continue;
  if(Object.keys(next.holdings).length>=next.models.M5.maxPositions){
   next.events.push({date,code:order.code,action:'BUY',status:'未成交',reason:'持仓数量达到上限'});continue;
  }
  const budget=Math.min(next.cash,next.initialCash*next.models.M5.positionFraction);
  let quantity=Math.floor(budget/verdict.price/100)*100;
  while(quantity>0){
   const gross=round(quantity*verdict.price),charge=feeTotal(fees('BUY',gross));
   if(gross+charge<=next.cash+0.00001&&gross+charge<=budget+0.00001)break;
   quantity-=100;
  }
  if(quantity<100){
   next.events.push({date,code:order.code,action:'BUY',status:'未成交',reason:'资金不足以买入100股（含费用）'});continue;
  }
  const gross=round(quantity*verdict.price),charge=feeTotal(fees('BUY',gross));
  next.cash=round(next.cash-gross-charge);
  next.holdings[order.code]={code:order.code,name:order.name,quantity,
   cost:round(gross+charge),avgCost:round((gross+charge)/quantity),
   buyDate:date,lastPrice:verdict.close,lastPriceDate:date,modelId:order.modelId};
  next.trades.push({id:'B'+(next.trades.length+1),date,signalDate:order.signalDate,side:'BUY',
   modelId:order.modelId,code:order.code,name:order.name,quantity,
   price:verdict.price,gross,fee:charge,reason:order.reason,source:verdict.source});
 }
 next.pending=later;
}
export function stepBot(state,{date,previousMarketDate=null,universe=[],barsByCode={}}){
 validateBot(state);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid trade date');
 if(state.lastDate&&date<=state.lastDate)return {state,changed:false,message:'Already processed '+date};
 const next=structuredClone(state),cfg=next.models.M5;
 // Previous-day signals may trade at THIS close, never back-filled on signal day.
 settle(next,date,barsByCode,previousMarketDate);
 const observed=[];
 for(const stock of universe){
  if(!/^\d{6}$/.test(stock.code)||!/^(?:0|3|6)/.test(stock.code)||/\*?ST/i.test(stock.name))continue;
  const bars=barsByCode[stock.code];
  if(!bars||bars.at(-1)?.date!==date)continue;
  const analysis=m5(stock,bars,cfg);
  observed.push({...stock,analysis});
 }
 observed.sort((a,b)=>b.analysis.score-a.analysis.score||
  b.analysis.volumeRatio-a.analysis.volumeRatio||b.sectorPct-a.sectorPct);
 next.signals=observed.slice(0,30).map(x=>({date,modelId:'M5',code:x.code,
  name:x.name,sector:x.sector,score:x.analysis.score,passed:x.analysis.passed,
  volumeRatio:x.analysis.volumeRatio,ma20:x.analysis.ma20,
  close:barsByCode[x.code].at(-1).close,reasons:x.analysis.reasons}));
 // SELL risk actions generated only from today's confirmed price, filled next session.
 for(const h of Object.values(next.holdings)){
  const bars=barsByCode[h.code],today=bars?.at(-1);
  if(today?.date!==date)continue;
  const ma20=bars.length>=20?bars.slice(-20).reduce((v,x)=>v+x.close,0)/20:null;
  const returnPct=(today.close-h.avgCost)/h.avgCost;
  const cause=returnPct<=-cfg.stopLossPct?'跌破止损阈值':
   returnPct>=cfg.takeProfitPct?'达到预设止盈阈值':
   (ma20!==null&&today.close<ma20?'跌破MA20':null);
  if(cause&&!next.pending.some(p=>p.code===h.code)){
   next.pending.push({code:h.code,name:h.name,side:'SELL',signalDate:date,modelId:h.modelId,
    reason:cause});
  }
 }
 if(cfg.enabled){
  const existing=new Set([...Object.keys(next.holdings),...next.pending.map(p=>p.code)]);
  const vacancies=Math.max(0,cfg.maxPositions-existing.size);
  for(const s of observed.filter(x=>x.analysis.passed&&!existing.has(x.code)).slice(0,vacancies)){
   next.pending.push({code:s.code,name:s.name,side:'BUY',signalDate:date,modelId:'M5',
    reason:s.analysis.reasons.join('；'),sector:s.sector});
   existing.add(s.code);
  }
 }
 const equity=botEquity(next,barsByCode,date);
 next.history.push({date,...equity,positions:Object.keys(next.holdings).length});
 next.lastDate=date;next.updatedAt=new Date().toISOString();
 next.events=next.events.slice(-120);
 next.trades=next.trades.slice(-500);
 next.history=next.history.slice(-360);
 return {state:next,changed:true,message:date+' 完成：候选 '+observed.length+
  '，待下交易日订单 '+next.pending.length+'，累计模拟成交 '+next.trades.length};
}
export async function getMarketData({fetchImpl=fetch,sectorLoader=getSectors,rankingLoader=getRankings,barLoader=dailyBars}={}){
 // Fail closed if the exchange's actual daily benchmark is not dated today.
 const benchmark=await barLoader('sh000001',{fetchImpl});
 if(benchmark.length<2)throw Error('Missing exchange calendar bars');
 const marketDate=benchmark.at(-1).date;
 const sectors=(await sectorLoader(fetchImpl)).rows.filter(s=>s.pct>0&&s.turnover>0).slice(0,3);
 const parts=await Promise.all(sectors.map(s=>rankingLoader('turnover','all',{fetchImpl,sectorCode:s.code,size:30})));
 const universe=new Map();
 for(let i=0;i<sectors.length;i++)for(const st of parts[i].rows.slice(0,18)){
  if(!/^[036]\d{5}$/.test(st.code)||/\*?ST/i.test(st.name))continue;
  const prior=universe.get(st.code);
  if(!prior||sectors[i].pct>prior.sectorPct)universe.set(st.code,{
   code:st.code,name:st.name,sector:sectors[i].name,sectorCode:sectors[i].code,sectorPct:sectors[i].pct});
 }
 return {date:marketDate,previousMarketDate:benchmark.at(-2).date,universe:[...universe.values()],barLoader,fetchImpl};
}
export async function executeBot(account,{now=new Date(),getData=getMarketData}={}){
 validateBot(account);
 const today=fmtDate(now),localTime=timeOfDay(now);
 if(localTime<'15:30')return {state:account,changed:false,message:'收盘后才能运行，拒绝前视'};
 const data=await getData();
 if(data.date!==today)return {state:account,changed:false,message:'交易所日K日期 '+data.date+
  ' 与北京时间 '+today+' 不一致，跳过（休市/数据未更新）'};
 if(account.lastDate&&data.date<=account.lastDate)
  return {state:account,changed:false,message:'已处理 '+data.date+'，不会重复交易'};
 const symbols=[...new Set([...data.universe.map(x=>x.code),
  ...Object.keys(account.holdings),...account.pending.map(x=>x.code)])];
 const barsByCode={};
 for(let i=0;i<symbols.length;i+=5){
  const batch=symbols.slice(i,i+5);
  const bars=await Promise.all(batch.map(code=>data.barLoader(code,{fetchImpl:data.fetchImpl})));
  bars.forEach((b,index)=>{barsByCode[batch[index]]=b;});
 }
 if(data.universe.length&&Object.keys(barsByCode).length<5)
  throw Error('Candidate OHLCV insufficient; refuse to update bot');
 return stepBot(account,{date:data.date,previousMarketDate:data.previousMarketDate,universe:data.universe,barsByCode});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1],import.meta.url))){
 const account=validateBot(JSON.parse(readFileSync(ACCOUNT_PATH,'utf8')));
 executeBot(account).then(result=>{
  console.log(result.message);
  if(result.changed&& !process.argv.includes('--dry-run')){
   writeFileSync(ACCOUNT_PATH,JSON.stringify(result.state,null,2)+'\n','utf8');
   console.log('Saved '+ACCOUNT_PATH);
  }
 }).catch(e=>{console.error('Bot aborted without changing account:',e);process.exitCode=1;});
}
