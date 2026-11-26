import {SECURITIES} from './seed.js';
import {positions,registeredStock,registerSecurity,cloneState,validateState,executeTrade,budgetQuantity,fees,feeTotal,validSymbol} from './engine.js';
import {session,getQuotes,getDailyBars} from './market.js';
import {getMarketIndices,getSectorLeaders,getWatchQuotes,getRankings} from './market-center.js';
import {clock,fresh,round} from './afternoon-rules.js';
export const STRATEGIES=Object.freeze({short:{label:'短线',version:'SHORT-v2',entry:.05,add:.05,maxStock:.15,maxTotal:.70,maxPositions:6,stop:.04,trail:.05,days:5,buys:4},wave:{label:'波段',version:'WAVE-v2',entry:.10,add:.05,maxStock:.25,maxTotal:.80,maxPositions:5,stop:.08,trail:.10,days:40,buys:2}});
export const MODES={short:[['S1','放量突破'],['S2','强势回踩'],['S3','热点首板'],['S4','分歧转一致'],['S5','龙头接力／连板']],wave:[['W1','AI成长'],['W2','周期复苏'],['W3','景气共振'],['W4','成长回调'],['W5','大周期龙头']]};
const valid=n=>Number.isFinite(n)&&n>0,avg=a=>a.reduce((s,x)=>s+x,0)/a.length,ma=(b,n)=>b.length>=n?avg(b.slice(-n).map(x=>x.close)):null;
const pct=(a,b)=>valid(a)&&valid(b)?(a/b-1)*100:null;
const cap=(code,name)=>/ST/i.test(name)?0.05:/^(30|68)/.test(code)?0.20:.10;
const tradableName=s=>s&&validSymbol(s.code)&&typeof s.name==='string'&&s.name.length>0&&s.name.length<=40&&!/[<>\x00-\x1f]|ST|退市|退$|^N|^C/i.test(s.name);
const dt=t=>clock(t).date;
const holdRows=(account,type)=>type==='short'?positions(account).map(h=>({...h,name:registeredStock(account,h.code)?.name||h.code,avgCost:h.totalCost/h.quantity,buyDate:h.lastBuyDate})):Object.values(account.holdings||{});
const phase=now=>session(now)==='auction'?'集合竞价':session(now)==='open'?'连续交易':'休市';
const coreKeys=['sh000001','sz399001','sz399006'];
export function limitStreak(bars,code,name){
 if(!tradableName({code,name})||bars.length<21)return null;
 let count=0;
 for(let i=bars.length-1;i>=1;i--){const a=bars[i],p=bars[i-1];if(!valid(a.volume)||!valid(p.close)||!valid(a.close)||Math.abs(a.close-round(p.close*(1+cap(code,name))))>.011)break;count++;}
 return count;
}
export function evidenceFor(e,now){
 const out={};
 for(const key of ['ai','growth','cycle','valuation','leader']){const x=e?.[key],date=Date.parse(x?.asOf||'');out[key]=x&&typeof x.pass==='boolean'&&/^https:\/\/[^\s]+$/.test(x.source||'')&&typeof x.note==='string'&&x.note.trim()&&Number.isFinite(date)&&date<=now&&now-date<=120*86400000?{pass:x.pass,detail:x.note,source:x.source,asOf:x.asOf}:{pass:null,detail:'缺少120日内带来源的可核验证据'};}
 return out;
}
const test=(name,pass,detail)=>({name,pass:pass===true?true:pass===false?false:null,detail:String(detail??'待核')});
const mode=(id,checks)=>({id,checks,pass:checks.every(c=>c.pass===true)});
export function analyzeSymbol(s,snapshot,type,now){
 const today=dt(now),open=session(now)==='open',auction=session(now)==='auction',q=snapshot.quotes?.[s.code],rank=snapshot.ranks?.[s.code],cut=snapshot.completedDate;
 const bars=(snapshot.daily?.[s.code]||[]).filter(b=>b.date<=cut&&valid(b.close)&&valid(b.volume)&&valid(b.high)&&valid(b.low)).sort((a,b)=>a.date.localeCompare(b.date));
 const aligned=bars.length>=21&&bars.at(-1)?.date===cut&&new Set(bars.map(b=>b.date)).size===bars.length;
 const qfresh=fresh(q,now,auction?20000:15000)&&q.code===s.code&&valid(q.prevClose);
 const last=aligned?bars.at(-1):null,prev=aligned?bars.at(-2):null,price=qfresh&&(open||auction)?q.price:last?.close??null;
 const base=qfresh&&(open||auction)?q.prevClose:prev?.close,day=pct(price,base),m5=aligned?ma(bars,5):null,m10=aligned?ma(bars,10):null,m20=aligned?ma(bars,20):null,m60=aligned?ma(bars,60):null,m120=aligned?ma(bars,120):null;
 const rankFresh=qfresh&&rank?.code===s.code&&fresh({...rank,time:rank.quoteTime},now,60000)&&Math.abs(rank.price/q.price-1)<=.005&&valid(rank.volume)&&valid(rank.high)&&valid(rank.open);
 const baseline=(open||auction?bars:bars.slice(0,-1)).slice(-5);
 const ratio=aligned&&baseline.length===5?(open||auction?(rankFresh?rank.volume/avg(baseline.map(b=>b.volume)):null):last.volume/avg(baseline.map(b=>b.volume))):null;
 const prior=aligned?(open||auction?bars:bars.slice(0,-1)):[],high20=prior.length>=20?Math.max(...prior.slice(-20).map(b=>b.high)):null;
 const draw=rankFresh?pct(q.price,rank.high):!open&&!auction&&last?pct(last.close,last.high):null,streak=aligned?limitStreak(bars,s.code,s.name):null;
 const sectorFresh=Number.isFinite(s.sectorTime)&&s.sectorTime<=now&&dt(s.sectorTime)===(open||auction?today:cut)&&(open||auction?now-s.sectorTime<=120000:true);
 const sectorOk=sectorFresh&&Number.isFinite(s.sectorPct)?s.sectorPct>=1:null,peer=Number.isInteger(s.peerRank)&&s.peerCount>=4?s.peerRank<=3:null,up=Number.isFinite(day)?day>=0.8&&day<=8:null;
 const hhmm=clock(now).clock.split(':').map(Number),minutes=hhmm[0]*60+hhmm[1],elapsed=minutes<690?Math.max(1,minutes-570):Math.max(1,120+minutes-780),volumeFloor=open?Math.max(.06,1.3*Math.min(240,elapsed)/240):1.3;
 const vol=Number.isFinite(ratio)&&!auction?ratio>=volumeFloor:null;
 const support=rankFresh?q.price>=rank.open&&draw>=-3:!open&&!auction&&last?last.close>=last.open&&draw>=-3:null;
 const priceUp=valid(price)&&valid(high20)?price>high20:null,priorStrong=aligned&&prior.length>=6?pct(prior.at(-1).close,prior.at(-6).close)>=8:null;
 const pull=valid(price)&&valid(m5)&&valid(m10)?price>=m10&&price<=m5*1.04:null;
 const evidence=evidenceFor(snapshot.evidence?.[s.code],now);
 const strength=test('行业强势',sectorOk,Number.isFinite(s.sectorPct)?s.sectorPct.toFixed(2)+'%（'+(sectorFresh?'时点匹配':'时点待核')+'）':'行业待核');
 const leader=test('行业成交额前3（样本）',peer,s.peerRank?'第'+s.peerRank+'/'+s.peerCount:'行业成分样本不足');
 const liquidity=test('量能',vol,ratio===null?'待核':ratio.toFixed(2)+'倍（累计量/完整日均量，门槛 '+volumeFloor.toFixed(2)+'；盘中按交易时间比例代理）');
 const accept=test('承接',support,draw===null?'待核':'高点回撤 '+draw.toFixed(2)+'%');
 const dailyEvidence=test('日K连续证据',aligned,aligned?bars.length+'根，截至 '+cut:'未与基准交易日对齐');
 let modes;
 if(type==='short'){
  modes=[
   mode('S1',[dailyEvidence,strength,liquidity,test('突破前20日高点',priceUp,high20??'待核'),accept]),
   mode('S2',[dailyEvidence,strength,test('前5日涨幅≥8%',priorStrong,'强势前置'),test('回踩MA5/10',pull,m5??'待核'),test('缩量（全天/累计≤0.8）',ratio===null?null:ratio<=.8,ratio??'待核'),accept]),
   mode('S3',[dailyEvidence,strength,test('涨幅0.8%–8%',up,day??'待核'),test('前一完整日非连板',streak===null?null:streak===0,streak??'待核'),liquidity,leader,accept]),
   mode('S4',[dailyEvidence,strength,test('前日分歧后重新走强',aligned&&prev?last.close<prev.close&&valid(price)&&price>last.high:null,last?.high??'待核'),liquidity,accept]),
   mode('S5',[dailyEvidence,strength,leader,test('已完成交易日连续封板≥2（价格估算）',streak===null?null:streak>=2,streak??'待核'),test('当期非封板追价，涨幅0.8%–8%',up,day??'待核'),accept])
  ];
 }else{
  const fundamental=k=>test(k,evidence[k].pass,evidence[k].detail+(evidence[k].source?' · '+evidence[k].source:''));
  const mid=test('价格高于MA20且MA20不低于MA60',valid(price)&&valid(m20)&&valid(m60)?price>m20&&m20>=m60:null,'MA20 '+(m20??'待核')+' / MA60 '+(m60??'待核'));
  const long=test('MA60≥MA120，价格高于MA60',valid(price)&&valid(m60)&&valid(m120)?price>m60&&m60>=m120:null,'MA60 '+(m60??'待核')+' / MA120 '+(m120??'待核'));
  const bench=(snapshot.benchmark||[]).filter(b=>b.date<=cut),ref=bars.length>=61?bars.at(-61):null,bi=ref?bench.find(b=>b.date===ref.date):null,bj=bench.find(b=>b.date===cut);
  const rs=ref&&bi&&bj&&last&&valid(bi.close)&&valid(bj.close)?pct(last.close,ref.close)-pct(bj.close,bi.close):null;
  modes=[
   mode('W1',[dailyEvidence,fundamental('ai'),fundamental('growth'),fundamental('valuation'),mid]),
   mode('W2',[dailyEvidence,fundamental('cycle'),fundamental('valuation'),mid]),
   mode('W3',[dailyEvidence,fundamental('growth'),fundamental('cycle'),fundamental('valuation'),long]),
   mode('W4',[dailyEvidence,fundamental('growth'),fundamental('valuation'),test('回调收复MA20',valid(price)&&valid(m20)&&valid(m60)?price>m20&&price<=m60*1.10:null,m20??'待核')]),
   mode('W5',[dailyEvidence,fundamental('leader'),fundamental('cycle'),fundamental('growth'),fundamental('valuation'),long,test('60日相对沪指强度≥10个百分点',rs===null?null:rs>=10,rs===null?'待核':rs.toFixed(2)+'pp')])
  ];
 }
 const passed=modes.filter(m=>m.pass).map(m=>m.id);
 return {code:s.code,name:s.name,sector:s.sector||'待核',price,day,quoteTime:qfresh?q.time:null,priceKind:qfresh&&(open||auction)?phase(now)+'参考':'最近完整交易日收盘参考',referenceDate:qfresh&&(open||auction)?today:cut,m5,m10,m20,m60,m120,ratio,streak,modes,passed,rankFresh,aligned,quote:qfresh?q:null,bars,evidence};
}
function holdingAction(h,a,type,now,account){
 const p=STRATEGIES[type],price=a.price,pnl=pct(price,h.avgCost);
 if(!valid(price)||!Number.isFinite(pnl))return ['HOLD','无有效价格或成本',0];
 const list=(account.trades||[]).filter(t=>t.code===h.code),first=list.filter(t=>t.side==='BUY').at(-1)?.date||h.buyDate;
 const heldBars=a.bars.filter(b=>b.date>=first),days=heldBars.length,peak=Math.max(price,...heldBars.map(b=>b.high)),fall=pct(price,peak);
 if(pnl<=-p.stop*100)return ['CLEAR','亏损达到'+p.stop*100+'%止损',1];
 if(type==='short'){
  if(a.streak>=2&&Number.isFinite(a.day)&&a.day<=-3)return ['CLEAR','连板龙头断板转弱',1];
  if(a.streak>=1&&Number.isFinite(a.day)&&a.day<0&&valid(a.m5)&&price<a.m5)return ['REDUCE','断板跌破MA5',.5];
  if(fall<=-p.trail*100&&pnl>0)return ['CLEAR','持仓区间高点回撤5%',1];
  if(days>=3&&pnl<=0)return ['CLEAR','三日未盈利，时间止损',1];
  if(days>=5)return ['CLEAR','达到短线持有上限5日',1];
  for(const threshold of [15,8])if(pnl>=threshold&&!list.some(t=>t.side==='SELL'&&t.date>=first&&t.reason?.includes('止盈'+threshold+'%')))return ['REDUCE','分批止盈'+threshold+'%',1/3];
 }else{
  if(['cycle','growth','leader'].some(k=>a.evidence[k]?.pass===false))return ['CLEAR','产业景气／成长／龙头证据转坏',1];
  if(fall<=-10&&pnl>0)return ['CLEAR','持仓区间高点回撤10%',1];
  if(valid(a.m60)&&price<a.m60)return ['REDUCE','跌破MA60，波段趋势减仓',.5];
  if(days>=40)return ['REDUCE','40个完整交易日后重新评估，分批退出',.25];
  for(const threshold of [40,20])if(pnl>=threshold&&!list.some(t=>t.side==='SELL'&&t.date>=first&&t.reason?.includes('止盈'+threshold+'%')))return ['REDUCE','分批止盈'+threshold+'%',.25];
 }
 if(a.passed.length&&pnl>0&&pnl<(type==='short'?8:20))return ['ADD','盈利仓且'+a.passed.join('/')+'再次满足',p.add];
 return ['HOLD','无新增持仓处理信号',0];
}
export function planStrategy(account,snapshot,type='short',now=Date.now()){
 const p=STRATEGIES[type],holds=holdRows(account,type),by=new Map(holds.map(h=>[h.code,h])),stocks=new Map((snapshot.stocks||[]).map(s=>[s.code,s]));
 for(const h of holds)if(!stocks.has(h.code))stocks.set(h.code,{code:h.code,name:h.name});
 const idx=snapshot.indices||[],indexOk=coreKeys.every(k=>idx.some(q=>q.key===k&&fresh(q,now,60000)&&Number.isFinite(q.pct))),marketOk=indexOk&&coreKeys.filter(k=>idx.find(q=>q.key===k)?.pct>=0).length>=2;
 const values=holds.map(h=>{const q=snapshot.quotes?.[h.code];return fresh(q,now)&&q.code===h.code?h.quantity*q.price:null;}),total=values.every(x=>x!==null)?values.reduce((a,b)=>a+b,0):null;
 const dailyBuys=(account.trades||[]).filter(t=>t.date===dt(now)&&t.side==='BUY'&&String(t.strategyVersion||t.modelId).startsWith(p.version)).length,rows=[];
 for(const s of stocks.values()){
  const h=by.get(s.code);if(!h&&!tradableName(s))continue;
  const a=analyzeSymbol(s,snapshot,type,now),[action,reason,fraction]=h?holdingAction(h,a,type,now,account):a.passed.length?['OPEN',a.passed.join('/')+'条件满足',p.entry]:['HOLD','等待开仓条件',0];
  const gates=[],buy=action==='OPEN'||action==='ADD',selling=action==='CLEAR'||action==='REDUCE',q=a.quote;
  if(action==='HOLD')gates.push('未触发交易');
  if(session(now)!=='open')gates.push('非连续交易时段，仅建议／待核验');
  if(!indexOk)gates.push('交易日指数未核验');
  if(!q||!a.rankFresh||!valid(q.prevClose))gates.push('缺少有效盘中报价及成交量');
  if(buy&&(!snapshot.completedDate||snapshot.completedDate>=dt(now)))gates.push('前一完整交易日未核验');
  if(buy&&(!marketOk||!a.aligned||!tradableName(s)||!q||!q.name||q.name!==s.name||!valid(a.bars.at(-1)?.close)||Math.abs(a.bars.at(-1).close/q.prevClose-1)>.005))gates.push('买入身份、昨收或市场风控未通过');
  if(buy&&action==='OPEN'&&holds.length>=p.maxPositions)gates.push('持仓数量上限');
  if(buy&&dailyBuys>=p.buys)gates.push('每日策略买入上限');
  if(selling&&h.buyDate>=dt(now))gates.push('T+1限制');
  if((account.trades||[]).some(t=>t.code===s.code&&t.date===dt(now)))gates.push('同股当日已有成交');
  const px=q?round(q.price*(buy?1.001:.999)):null,limit=q?cap(s.code,s.name):null;
  if(!px||px>=round(q.prevClose*(1+limit))-.01||px<=round(q.prevClose*(1-limit))+.01)gates.push('价格或涨跌停可成交性未核验');
  let qty=0;
  if(buy){if(total===null)gates.push('组合市值未核验');else if(px)qty=budgetQuantity(Math.max(0,Math.min(account.cash,account.initialCash*fraction,account.initialCash*p.maxStock-(h?h.quantity*q.price:0),account.initialCash*p.maxTotal-total)),px);}
  if(selling)qty=action==='CLEAR'?h.quantity:Math.floor(h.quantity*fraction/100)*100;
  if(action!=='HOLD'&&(qty<100||buy&&/^(688|689)/.test(s.code)&&qty<200))gates.push('预算或最小交易单位不足');
  const {bars,quote,evidence,...display}=a;
  rows.push({...display,held:h?.quantity||0,pnl:h?pct(a.price,h.avgCost):null,action,reason,gates,quantity:qty,fillPrice:px,executable:action!=='HOLD'&&gates.length===0});
 }
 return {version:p.version,type,date:dt(now),phase:phase(now),checkedAt:new Date(now).toISOString(),completedDate:snapshot.completedDate,warning:snapshot.warning||'',rows:rows.sort((a,b)=>Number(b.held>0)-Number(a.held>0)||Number(b.executable)-Number(a.executable)||b.passed.length-a.passed.length||a.code.localeCompare(b.code))};
}
export async function collectStrategy(account,type,{proxy='',evidence={},extraCodes=[],now=()=>Date.now(),dailyLoader=getDailyBars,sectorLoader=getSectorLeaders,rankingLoader=getRankings,quoteLoader=getQuotes,rankLoader=getWatchQuotes,indexLoader=getMarketIndices}={}){
 const holds=holdRows(account,type),size=type==='wave'?150:35;
 const [benchmarkResult,groupsResult,rankingResult,gainersResult]=await Promise.allSettled([dailyLoader('sh000001',{limit:size}),sectorLoader({filter:s=>s.pct>0&&s.turnover>0,limit:3,size:30}),rankingLoader('turnover','all',{size:30}),type==='short'?rankingLoader('gainers','all',{size:30}):Promise.resolve({rows:[]})]);
 const benchmark=benchmarkResult.status==='fulfilled'?benchmarkResult.value:[],groups=groupsResult.status==='fulfilled'?groupsResult.value:[],ranking=rankingResult.status==='fulfilled'?rankingResult.value.rows:[];
 const stocks=new Map();
 for(const {sector,rows} of groups){const sorted=[...rows].filter(tradableName).sort((a,b)=>(b.turnover||0)-(a.turnover||0));for(const [i,s] of sorted.slice(0,4).entries())stocks.set(s.code,{code:s.code,name:s.name,sector:sector.name,sectorPct:sector.pct,sectorTime:sector.quoteTime,peerRank:i+1,peerCount:sorted.length});for(const h of holds){const i=sorted.findIndex(s=>s.code===h.code);if(i>=0&&!stocks.has(h.code))stocks.set(h.code,{code:h.code,name:h.name,sector:sector.name,sectorPct:sector.pct,sectorTime:sector.quoteTime,peerRank:i+1,peerCount:sorted.length});}}
 for(const s of (gainersResult.status==='fulfilled'?gainersResult.value.rows:[]).filter(tradableName).slice(0,8))if(!stocks.has(s.code))stocks.set(s.code,{code:s.code,name:s.name});
 for(const s of ranking.filter(tradableName).slice(0,8))if(!stocks.has(s.code))stocks.set(s.code,{code:s.code,name:s.name});
 for(const s of [...SECURITIES.filter(s=>!s.halted),...holds,...extraCodes.map(c=>({code:c,name:registeredStock(account,c)?.name||c}))])if(validSymbol(s.code)&&!stocks.has(s.code))stocks.set(s.code,{code:s.code,name:s.name});
 if(type==='wave')for(const [code,e] of Object.entries(evidence).slice(0,20))if(validSymbol(code)&&typeof e?.name==='string'&&!stocks.has(code))stocks.set(code,{code,name:e.name});
 const daily={},codes=[...stocks.keys()];
 for(let i=0;i<codes.length;i+=8)await Promise.allSettled(codes.slice(i,i+8).map(async c=>{daily[c]=await dailyLoader(c,{limit:size});}));
 const [qr,rr,ir]=await Promise.allSettled([quoteLoader(codes,{proxy}),rankLoader(codes),indexLoader()]),t=now(),today=dt(t),closed=session(t)==='closed'&&clock(t).clock>='15:05';
 const completedDate=benchmark.filter(b=>b.date<today||closed&&b.date===today).at(-1)?.date||null;
 const quotes=Object.fromEntries((qr.status==='fulfilled'?qr.value.quotes:[]).map(q=>[q.code,q])),ranks=Object.fromEntries((rr.status==='fulfilled'?rr.value:[]).map(q=>[q.code,q]));
 for(const s of stocks.values())if(quotes[s.code]?.name&&s.name===s.code)s.name=quotes[s.code].name;
 return {stocks:[...stocks.values()],daily,benchmark,completedDate,quotes,ranks,indices:ir.status==='fulfilled'?ir.value:[],evidence,warning:(!groups.length?'行业成分源缺失；':'')+(!ranking.length?'成交额榜缺失；':'')+(!completedDate?'基准日K缺失；':'')+'候选为有限行业、涨幅及成交额样本，不是全市场遍历'};
}
export function selectedActions(plan,selected){const keys=new Set(selected);return plan.rows.filter(r=>keys.has(r.code+':'+r.action)&&r.action!=='HOLD');}
export function applyShort(account,snapshot,selected,now=Date.now()){
 if(!validateState(account))return {ok:false,error:'短线账本校验失败'};
 const next=cloneState(account),initial=planStrategy(next,snapshot,'short',now),chosen=selectedActions(initial,selected),results=[];
 for(const r of chosen.sort((a,b)=>Number(b.action==='CLEAR'||b.action==='REDUCE')-Number(a.action==='CLEAR'||a.action==='REDUCE'))){
  const row=planStrategy(next,snapshot,'short',now).rows.find(x=>x.code===r.code&&x.action===r.action);
  if(!row?.executable){results.push({code:r.code,action:r.action,status:'未成交',reason:row?.gates.join('；')||'信号变化'});continue;}
  if(row.action==='OPEN'&&!registeredStock(next,row.code)){const reg=registerSecurity(next,{code:row.code,name:row.name,quoteTime:row.quoteTime});if(!reg.ok){results.push({code:r.code,status:'未成交',reason:reg.error});continue;}}
  const side=['OPEN','ADD'].includes(row.action)?'BUY':'SELL',out=executeTrade(next,{code:row.code,side,quantity:row.quantity,price:row.fillPrice,date:dt(now)});
  if(!out.ok){results.push({code:r.code,status:'未成交',reason:out.error});continue;}
  Object.assign(out.trade,{name:row.name,strategyVersion:STRATEGIES.short.version,reason:row.reason,quoteTime:new Date(row.quoteTime).toISOString(),executedAt:new Date(now).toISOString(),source:snapshot.quotes[row.code].source+' + 0.1%滑点（模拟）'});
  next.prices[row.code]={price:row.price,date:dt(now),source:snapshot.quotes[row.code].source,markedAt:row.quoteTime};
  results.push({code:r.code,action:r.action,status:'模拟已成交',reason:row.reason,tradeId:out.trade.id});
 }
 for(const k of selected.filter(k=>!chosen.some(r=>r.code+':'+r.action===k)))results.push({code:k.split(':')[0],status:'未成交',reason:'所选信号已变化'});
 next.shortPlan={...initial,results};if(results.some(r=>r.status==='模拟已成交'))delete next.shortIntent;
 if(!validateState(next))return {ok:false,error:'结果账本校验失败'};
 return {ok:true,state:next,plan:next.shortPlan,message:'模拟成交 '+results.filter(x=>x.status==='模拟已成交').length+' 笔'};
}
export function applyWave(account,snapshot,selected,now=Date.now()){
 const next=structuredClone(account),initial=planStrategy(next,snapshot,'wave',now),chosen=selectedActions(initial,selected),results=[];
 for(const r of chosen.sort((a,b)=>Number(b.action==='CLEAR'||b.action==='REDUCE')-Number(a.action==='CLEAR'||a.action==='REDUCE'))){
  const row=planStrategy(next,snapshot,'wave',now).rows.find(x=>x.code===r.code&&x.action===r.action);
  if(!row?.executable){results.push({code:r.code,action:r.action,status:'未成交',reason:row?.gates.join('；')||'信号变化'});continue;}
  const buy=['OPEN','ADD'].includes(row.action),side=buy?'BUY':'SELL',h=next.holdings[row.code],gross=round(row.fillPrice*row.quantity),fee=feeTotal(fees(side,gross));
  if(buy&&gross+fee>next.cash||!buy&&(!h||h.quantity<row.quantity||h.buyDate>=dt(now))){results.push({code:r.code,status:'未成交',reason:'资金或T+1约束'});continue;}
  const trade={id:'W'+(next.trades.length+1)+'-'+now,code:row.code,name:row.name,side,date:dt(now),quantity:row.quantity,price:row.fillPrice,gross,fee,modelId:STRATEGIES.wave.version,reason:row.reason,quoteTime:new Date(row.quoteTime).toISOString(),executedAt:new Date(now).toISOString(),source:snapshot.quotes[row.code].source+' + 0.1%滑点（模拟）'};
  if(buy){const cost=round((h?.cost||0)+gross+fee),quantity=(h?.quantity||0)+row.quantity;next.cash=round(next.cash-gross-fee);next.holdings[row.code]={...h,code:row.code,name:row.name,cost,quantity,avgCost:cost/quantity,buyDate:dt(now),lastPrice:row.price,lastPriceDate:dt(now),modelId:STRATEGIES.wave.version};}
  else{const basis=round(h.cost*row.quantity/h.quantity);trade.pnl=round(gross-fee-basis);next.cash=round(next.cash+gross-fee);if(row.quantity===h.quantity)delete next.holdings[row.code];else{h.quantity-=row.quantity;h.cost=round(h.cost-basis);h.avgCost=h.cost/h.quantity;h.lastPrice=row.price;h.lastPriceDate=dt(now);}}
  next.trades.push(trade);results.push({code:r.code,action:r.action,status:'模拟已成交',tradeId:trade.id,reason:row.reason});
 }
 for(const k of selected.filter(k=>!chosen.some(r=>r.code+':'+r.action===k)))results.push({code:k.split(':')[0],status:'未成交',reason:'所选信号已变化'});
 next.wavePlan={...initial,results};next.updatedAt=new Date(now).toISOString();return {state:next,plan:next.wavePlan,results};
}
