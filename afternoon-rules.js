// Only timestamped, same-session public quotes; no future closing data.
export const AFTERNOON_VERSION='M5-1430-v1';
export const POLICY=Object.freeze({start:'14:30',end:'14:55',quoteAge:15000,rankAge:60000,sectorMin:1,volumeMin:1.3,gainMin:0.8,gainMax:5,fadeMax:2,stop:-6,weakDay:-5,weakCost:-3,profit:15,positionFraction:.10,entryFraction:.05,maxBuys:2,maxSells:3,slippage:.001});
export const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export function clock(t){const d=new Date(t),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d),p=k=>parts.find(x=>x.type===k)?.value;return {date:p('year')+'-'+p('month')+'-'+p('day'),clock:p('hour')+':'+p('minute'),weekday:p('weekday')};}
export function afternoonWindow(now){const x=clock(now);return !['Sat','Sun'].includes(x.weekday)&&x.clock>=POLICY.start&&x.clock<=POLICY.end;}
const valid=n=>Number.isFinite(n)&&n>0;
export function fresh(q,now,age=POLICY.quoteAge){return q&&valid(q.price)&&Number.isFinite(q.time)&&q.time<=now&&now-q.time<=age&&clock(q.time).date===clock(now).date;}
export function scoreStock(stock,{quote,rank,daily,previousDate,now}){
 const no=reason=>({code:stock.code,name:stock.name,sector:stock.sector||null,passed:false,reason,checks:[],price:null});
 if(!fresh(quote,now)||quote.code!==stock.code||!valid(quote.prevClose))return no('当日15秒内报价不足');
 if(!rank||rank.code!==stock.code||!fresh({...rank,time:rank.quoteTime},now,POLICY.rankAge)||!valid(rank.volume)||!valid(rank.high)||!valid(rank.open)||Math.abs(rank.price/quote.price-1)>.005)return no('成交量/日内高点无同日时间戳或报价不同步');
 const hist=(daily||[]).filter(x=>x.date<clock(now).date).slice(-20);
 if(hist.length!==20||hist.at(-1).date!==previousDate||new Set(hist.map(x=>x.date)).size!==20||hist.some(x=>!valid(x.close)||!valid(x.volume))||Math.abs(hist.at(-1).close/quote.prevClose-1)>.005)return no('前20日K或昨收未核验');
 const ma20=hist.reduce((s,x)=>s+x.close,0)/20,avg5=hist.slice(-5).reduce((s,x)=>s+x.volume,0)/5;
 // Eastmoney f5 and daily K f56 are both lots. Compare cumulative volume to full-day baseline, without projecting the close.
 const ratio=rank.volume/avg5,gain=(quote.price/quote.prevClose-1)*100,fade=(rank.high-quote.price)/rank.high*100;
 const sectorOk=Number.isFinite(stock.sectorPct)&&stock.sectorPct>=POLICY.sectorMin&&Number.isFinite(stock.sectorTime)&&stock.sectorTime<=now&&now-stock.sectorTime<=120000&&clock(stock.sectorTime).date===clock(now).date;
 const checks=[{name:'行业强度',pass:sectorOk},{name:'实际累计量/前5日完整日均量',pass:ratio>=POLICY.volumeMin},{name:'站上MA20',pass:quote.price>ma20},{name:'涨幅与承接',pass:gain>=POLICY.gainMin&&gain<=POLICY.gainMax&&fade<=POLICY.fadeMax&&quote.price>=rank.open}];
 return {code:stock.code,name:stock.name,sector:stock.sector||null,passed:checks.every(c=>c.pass),checks,reason:checks.filter(c=>!c.pass).map(c=>c.name+'未达标').join('；')||'M5盘中量价及板块共振',price:quote.price,prevClose:quote.prevClose,quoteTime:quote.time,source:quote.source,ma20:round(ma20),ratio:round(ratio),gain:round(gain),fade:round(fade),sectorPct:stock.sectorPct??null,open:rank.open};
}
export function holdingDecision(h,quote,signal,now){
 if(!fresh(quote,now)||quote.code!==h.code||!valid(quote.prevClose)||!valid(h.avgCost))return {action:'HOLD',reason:'报价或成本未核验'};
 const gain=(quote.price/quote.prevClose-1)*100,pnl=(quote.price/h.avgCost-1)*100;
 const sell=(action,fraction,reason)=>h.buyDate>=clock(now).date?{action:'HOLD',reason:'T+1禁止当日卖出'}:{action,fraction,reason};
 if(pnl<=POLICY.stop)return sell('CLEAR',1,'累计亏损达到6%止损');
 if(gain<=POLICY.weakDay&&pnl<=POLICY.weakCost)return sell('REDUCE',.5,'当日跌5%且成本亏损3%');
 if(pnl>=POLICY.profit&&signal?.price&&signal.fade>=POLICY.fadeMax&&gain<9.6)return sell('REDUCE',1/3,'盈利15%且冲高回落');
 if(signal?.ma20&&quote.price<signal.ma20&&gain<0)return sell('REDUCE',.5,'跌破MA20且当日走弱');
 if(signal?.passed&&pnl>0&&pnl<12)return {action:'ADD',fraction:.025,reason:'盈利仓位且M5再确认'};
 return {action:'HOLD',reason:'未触发减仓、清仓或加仓规则'};
}
