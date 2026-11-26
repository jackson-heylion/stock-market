import {STRATEGIES,MODES,collectStrategy,planStrategy,applyShort} from './dual-strategy.js';
import {registeredStock} from './engine.js';
import {SECURITIES, MODEL_DEFINITIONS, SNAPSHOT_DATE, BUDGET_PER_STOCK} from './seed.js';
import {STORAGE_KEY, initialState, cloneState, portfolio, positions, executeTrade, markPrice, budgetQuantity, fees, feeTotal, modelEvidence, validateState, shDate, migrateCapital} from './engine.js';
import {getQuotes,getHistory,quoteState,session,POLL_MS} from './market.js';
import {chartSvg,showMinutePoint} from './charts.js';
import {holdingReturns} from './holding-returns.js';
import {collectManualAfternoon,planManualAfternoon,applyManualAfternoon,MANUAL_VERSION,manualKey,manualVersion} from './manual-afternoon.js';
import {afternoonWindow,strategyWindow,slotLabel,clock} from './afternoon-rules.js';
import {editLedger} from './ledger-store.js';
import {referencePrice,verifiedQuote} from './valuation.js';
import {initTheme,applyTheme,THEME_KEY} from './theme.js';
import {readPrefs,savePrefs,resetPrefs,DEFAULT_PREFS} from './preferences.js';
import {renderRadar,refreshRadar,handleRadarClick} from './radar-view.js';
import {getRadarSnapshot} from './radar-snapshot.js';
import {proposeTailOrders,TAIL_POLICY} from './tail-strategy.js';
import {HOLD_POLICY,holdWindow,applyLocalOpening} from './holding-opening.js';
import {renderMarketTerminal,handleTerminalClick,terminalSearchInput,refreshTerminal,setTerminalPageSize,clearTerminalRecent,clearTerminalFollows} from './market-terminal.js';
import {INDEXES,SCOPES,RANK_MODES,getMarketIndices,getRankings,getSectors,getMarketBreadth,getIndexHistory} from './market-center.js';
let uiPrefs=readPrefs();
let state;let page='overview';let accountView='manual';let strategySlot='afternoon';let manualAfternoonBusy=false,manualAfternoonPreview={},manualAfternoonError={};let releaseVersion='未核验';let lastQuoteAt=0;let morningReport=null;let morningError='';let morningLastRead=0;let morningLoading=false;let botAccount=null;let botError='';let botLoadedAt=0;let botLoading=false;let liveQuotes={};let quoteError='';let quotePath='历史快照';
let chartCode='601133',chartPeriod='minute';const chartCache=new Map();const chartPending=new Set();let polling=false;
let indexKey='sh000001',indexPeriod='minute';let rankFetchSeq=0;const pendingIndexCharts=new Set();
const indexChartCache=new Map(),externalStockLookup=new Map();
let marketBoard={indices:[],breadth:null,sectors:[],leaders:[],updatedAt:0,errors:[],loading:false};
let ranked={rows:[],total:null,updatedAt:0,loading:false,error:'',mode:'gainers',scope:'all',search:''};
function displayState(){
 const prices={...state.prices};
 for(const [code,q] of Object.entries(liveQuotes)){if(stock(code)){const ref=referencePrice(prices[code],q);if(ref)prices[code]=ref;}}
 return {...state,prices};
}
function priceInfo(code){return liveQuotes[code]||null;}
function latestLabel(code){
 const q=priceInfo(code);if(!q)return '11月19日历史快照';
 const s=quoteState(q);return q.source+' · '+s.label+(q.time?' · '+new Date(q.time).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):' · 时间未核验');
}

const $=s=>document.querySelector(s);
const money=n=>Number(n).toLocaleString('zh-CN',{style:'currency',currency:'CNY',minimumFractionDigits:2,maximumFractionDigits:2});
const num=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});
const signed=n=>`${n>=0?'+':''}${Number(n).toFixed(2)}%`;
const cls=n=>n>0?'up':n<0?'down':'muted';
const pnlMoney=n=>Number.isFinite(n)?(n>0?'+':'')+money(n):'--';
const pnlPct=n=>Number.isFinite(n)?signed(n):'--';
function manualReturns(){const display=displayState(),p=portfolio(display);const quotes=Object.fromEntries(Object.entries(liveQuotes).filter(([c,q])=>!display.prices[c]?.source?.startsWith('用户手动')));return holdingReturns({holdings:p.holds,trades:state.trades,quotes,cash:p.cash,initialCash:state.initialCash});}
function robotReturns(){const b=botAccount;return holdingReturns({holdings:Object.values(b.holdings||{}),trades:b.trades,quotes:liveQuotes,cash:b.cash,initialCash:b.initialCash,robot:true,realizedByCode:b.archivedRealized||{}});}
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stock=code=>registeredStock(state,code);
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(window.__notice);window.__notice=setTimeout(()=>el.classList.remove('visible'),3600);}
function load(){
 try{
  const raw=localStorage.getItem(STORAGE_KEY);
  if(!raw)return initialState();
  const v=JSON.parse(raw);
  const upgraded=migrateCapital(v);
  if(upgraded){
   if(upgraded!==v){
    // Migration is committed by the unified locked initializer.
   }
   return upgraded;
  }
  throw Error('已有浏览器账本未通过合法性检查，拒绝自动覆盖；请先备份本地存储');
 }catch(err){
  // Never silently erase an inaccessible or un-migratable existing paper ledger.
  try{if(localStorage.getItem(STORAGE_KEY))throw err;}catch(e){throw e;}
 }
 return initialState();
}
function persist(next){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));return true;}catch{return false;}}
async function transaction(updater){
 const result=await editLedger(updater);
 if(!result.ok){toast(result.error);return false;}
 state=result.state;render();toast(result.message||'已保存到本地浏览器');return true;
}
const titleMap={settings:'设置',overview:'资产总览',watchlist:'观察列表',models:'策略中心',trades:'成交流水',charts:'行情图表',market:'大盘市场',quotes:'行情中心',radar:'市场雷达'};
function render(){
 const primary=['market','watchlist','charts'].includes(page)?'quotes':page;
 document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.page===primary));
 $('#page-heading').textContent=titleMap[page];
 $('#main').classList.toggle('market-terminal-main',page==='quotes');
 const archiveOpen=Boolean(document.querySelector('.strategy-archive')?.open);
 const searchFocused=document.activeElement?.id==='mt-search',selection=searchFocused?document.activeElement.selectionStart:null;
 $('#main').innerHTML=({overview:renderOverview,watchlist:renderWatchlist,models:renderModels,trades:renderTrades,charts:renderCharts,market:renderMarketDashboard,quotes:renderMarketTerminal,radar:renderRadar,settings:renderSettings}[page])();
 if(['market','quotes','watchlist','charts'].includes(page))$('#main').insertAdjacentHTML('afterbegin','<div class="core-tabs">'+[['quotes','全市场'],['market','大盘'],['watchlist','观察股'],['charts','走势图']].map(([id,label])=>'<button class="btn mini '+(page===id?'primary':'subtle')+'" data-page="'+id+'">'+label+'</button>').join('')+'</div>');
 if(archiveOpen){const archive=document.querySelector('.strategy-archive');if(archive)archive.open=true;}
 const version=$('#release-info');if(version)version.textContent='版本 '+releaseVersion+' · 报价取数 '+(lastQuoteAt?new Date(lastQuoteAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未连接');
 if(searchFocused&&page==='quotes'){const field=$('#mt-search');if(field){field.focus();try{field.setSelectionRange(selection,selection);}catch{}}}
 const status=$('#market-status');if(status){
 const count=Object.values(liveQuotes).filter(q=>quoteState(q).fresh).length;
 status.textContent=(count?'行情接入 '+count+'只 · ':'')+quotePath+(quoteError?' · 部分源异常':'');
 status.title=quoteError||'报价带时间戳；非交易所授权实时行情';
 }
}
function heading(kicker,title,sub,actions=''){return `<div class="hero"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p class="subheading">${sub}</p></div><div class="action-row">${actions}</div></div>`;}
function stat(label,value,sub,special=false,style=''){return `<div class="stat ${special?'special':''}"><div class="stat-label">${label}<span>${special?'●':''}</span></div><div class="stat-number ${style}">${value}</div><div class="stat-sub">${sub}</div></div>`;}
function compactTable(limit=20){const p=portfolio(displayState()),r=manualReturns(),by=new Map(r.rows.map(x=>[x.code,x]));return '<div class="table-wrap"><table class="data-table"><thead><tr><th>证券</th><th>持仓股数</th><th>摊薄成本</th><th>参考价</th><th>市值</th><th>当日收益</th><th>累计收益</th><th>浮动盈亏</th></tr></thead><tbody>'+p.holds.slice(0,limit).map(h=>{const v=by.get(h.code);return '<tr><td><button class="section-action name" data-action="open-charts" data-code="'+e(h.code)+'">'+e(h.name)+' ↗</button><small>'+e(h.code)+'</small></td><td>'+num(h.quantity)+'</td><td>¥'+h.avgCost.toFixed(3)+'</td><td>¥'+h.quote.toFixed(2)+'</td><td>'+money(h.value)+'</td><td class="'+cls(v?.day)+'">'+pnlMoney(v?.day)+'</td><td class="'+cls(v?.cumulative)+'">'+pnlMoney(v?.cumulative)+'</td><td class="'+cls(h.unrealized)+'">'+pnlMoney(h.unrealized)+'</td></tr>';}).join('')+r.rows.filter(x=>x.quantity===0).map(v=>'<tr><td>'+e(stock(v.code)?.name||v.name)+'<small>'+e(v.code)+' · 今日已清仓</small></td><td>0</td><td>--</td><td>--</td><td>¥0.00</td><td class="'+cls(v.day)+'">'+pnlMoney(v.day)+'</td><td class="'+cls(v.cumulative)+'">'+pnlMoney(v.cumulative)+'</td><td>¥0.00</td></tr>').join('')+'</tbody></table></div><div class="hint">当日收益含今日买卖和费用，以昨收为基准；累计含历史已实现与当前浮动盈亏。当天报价/昨收缺失显示 --；累计按最新参考估值。</div>';}
function robotHoldingTable(r){return '<div class="table-wrap"><table class="data-table bot-table"><thead><tr><th>波段账户持仓</th><th>股数</th><th>参考价 / 日期</th><th>当日收益</th><th>累计收益*</th><th>浮动盈亏</th></tr></thead><tbody>'+(r.rows.map(x=>'<tr><td>'+e(x.name)+'<small>'+e(x.code)+(x.quantity===0?' · 今日已清仓':'')+'</small></td><td>'+num(x.quantity)+'</td><td>'+pnlMoney(x.price)+'<small>'+e(x.priceDate||'日期未知')+'</small></td><td class="'+cls(x.day)+'">'+pnlMoney(x.day)+'</td><td class="'+cls(x.cumulative)+'">'+pnlMoney(x.cumulative)+'</td><td class="'+cls(x.unrealized)+'">'+pnlMoney(x.unrealized)+'</td></tr>').join('')||'<tr><td colspan="6">暂无持仓或今日清仓记录</td></tr>')+'</tbody></table></div><p class="bot-method">*个股累计收益为当前浮动加已实现流水及归档收益；旧版本已丢弃的历史无法追溯。账户累计按资产减本金。</p>';}
function allocation(){const p=portfolio(displayState()),palette=['#d8b070','#c7786e','#64a8b8','#a39bcb','#a6bc80','#d18dbe','#7395ad'];const parts=p.holds.map((h,i)=>({...h,share:h.value/p.total*100,color:palette[i%palette.length]}));return `<div class="allocation" aria-label="资产配置条"><span style="width:${p.cash/p.total*100}%;background:#566c80" title="现金"></span>${parts.map(h=>`<span style="width:${h.share}%;background:${h.color}" title="${e(h.name)} ${h.share.toFixed(1)}%"></span>`).join('')}</div><div class="legend"><div><i style="background:#566c80"></i><label>剩余现金</label><b>${(p.cash/p.total*100).toFixed(1)}%</b></div>${parts.map(h=>`<div><i style="background:${h.color}"></i><label>${e(h.name)}</label><b>${h.share.toFixed(1)}%</b></div>`).join('')}</div>`;}
function renderTailStrategy(){
 const plan=proposeTailOrders(state,liveQuotes);
 const rows=plan.rows;
 const good=plan.orders;
 const fmtPct=v=>Number.isFinite(v)?signed(v):'--';
 return `<section class="panel tail-panel">
  <div class="panel-head"><div><h2>短线账户 · 尾盘防守策略</h2>
   <p>规则版本 ${e(TAIL_POLICY.version)} · 只对你本浏览器的实际持仓计算 · 当前可用拟单 ${good.length}笔</p>
  </div><button class="btn mini subtle" data-action="tail-refresh">核对最新报价</button></div>
  <p class="bot-method">策略：浮亏超过6%时考虑减半；当日跌超5%且浮亏超过3%时考虑减半；盈利超过15%且未封涨停时考虑减三分之一。每次最多提示3笔，不新增买入。<strong>策略不会自动修改账本。</strong></p>
  <div class="table-wrap"><table class="data-table bot-table"><thead><tr>
    <th>持仓</th><th>股数</th><th>参考均价</th><th>最新价</th><th>相对成本</th><th>策略建议</th><th>模拟操作</th>
  </tr></thead><tbody>${rows.map(x=>`<tr>
    <td class="name">${e(stock(x.code).name)}<small>${e(x.code)}</small></td>
    <td>${num(x.quantity)}</td><td>${money(x.avgCost)}</td>
    <td>${x.price===null?'--':money(x.price)}</td>
    <td class="${cls(x.profitPct||0)}">${fmtPct(x.profitPct)}</td>
    <td>${e(x.reason)}</td>
    <td>${good.some(o=>o.code===x.code)?`<button class="btn mini primary" data-action="tail-sell" data-code="${e(x.code)}">模拟卖${num(x.suggestedQty)}股</button>`:'暂不操作'}</td>
  </tr>`).join('')||'<tr><td colspan="7">当前没有手动持仓。</td></tr>'}</tbody></table></div>
  <div class="hint">仅在A股交易时段、报价时间不超过15秒、证券未受跌停限制且满足T+1时提供模拟卖出按钮。点击后仍需确认，才写入当前浏览器账本。并非真实券商交易。</div>
 </section>`;
}
function executeTailRecommendation(code){
 const plan=proposeTailOrders(state,liveQuotes);
 const order=plan.orders.find(x=>x.code===code);
 if(!order){toast('报价过期或持仓/策略已变化，禁止用旧拟单成交');return;}
 if(!confirm('确认按'+order.quoteSource+'最新参考价'+money(order.price)+'，模拟卖出'+stock(code).name+' '+order.suggestedQty+'股？\n此操作只记录模拟成交，并不联系券商。'))return;
 const date=shDate();
 transaction(next=>{
  // Recheck the current browser state and source timestamp immediately before write.
  const refreshed=proposeTailOrders(next,liveQuotes).orders.find(x=>x.code===code);
  if(!refreshed||refreshed.suggestedQty!==order.suggestedQty||refreshed.price!==order.price)
   return {ok:false,error:'拟单已失效，请刷新报价'};
  const result=executeTrade(next,{code,side:'SELL',quantity:refreshed.suggestedQty,
   price:refreshed.price,date});
  return result.ok?{ok:true,message:'已记录模拟卖出：'+stock(code).name+' '+refreshed.suggestedQty+'股'}:result;
 });
}

let openingHoldRows=[],openingHoldTrends={},openingHoldFetchAt=0,openingHoldError='';
function renderOpeningHold(){
 const trades=state.trades.filter(t=>t.strategyVersion===HOLD_POLICY.version&&t.date===HOLD_POLICY.date);
 const rows=openingHoldRows;
 return '<section class="panel"><div class="panel-head"><div><h2>手动持仓 · 11月24日开盘自动风控</h2><p>09:36–09:44，仅当前浏览器实际持仓；'+(uiPrefs.autoOpeningHold?'已启用':'已关闭')+' · 已模拟减仓 '+trades.length+' 笔</p></div><button class="btn mini subtle" data-page="settings">设置</button></div>'+
 '<p class="bot-method">先风控存量：亏损6%减半；当日跌5%且浮亏3%减半；高开3%后承接转弱或盈利15%且转弱减三分之一。最多3笔，每股一次，100股整手，T+1，0.1%不利滑点。没有有效行情不成交。</p>'+
 '<div class="hint">'+e(openingHoldError||'须保持本页前台打开和行情刷新；关闭页面不运行，不补记成交，不会触碰GitHub机器人账户。')+'</div>'+
 '<div class="table-wrap"><table class="data-table"><thead><tr><th>证券</th><th>状态</th><th>原因</th></tr></thead><tbody>'+
 (rows.length?rows.map(r=>'<tr><td>'+e(stock(r.code)?.name||r.code)+'</td><td>'+e(r.status)+'</td><td>'+e(r.reason)+'</td></tr>').join(''):'<tr><td colspan="3">等待09:36–09:44有效分时及报价</td></tr>')+'</tbody></table></div></section>';
}
async function runLocalOpeningHold(proxy){
 if(!uiPrefs.autoOpeningHold||document.hidden||!holdWindow())return;
 if(!navigator.locks?.request){openingHoldError='浏览器不支持跨标签页锁，自动执行暂停';return;}
 if(Date.now()-openingHoldFetchAt>=15000){
  openingHoldFetchAt=Date.now();
  const codes=positions(state).map(p=>p.code);
  const entries=await Promise.allSettled(codes.map(async code=>[code,await getHistory(code,'minute')]));
  for(const item of entries)if(item.status==='fulfilled')openingHoldTrends[item.value[0]]=item.value[1];
 }
 if(!uiPrefs.autoOpeningHold||document.hidden||!holdWindow())return;
 const result=await getQuotes(positions(state).map(p=>p.code),{proxy});
 const quotes=Object.fromEntries(result.quotes.map(q=>[q.code,q]));
 const resultWrite=await editLedger((next,current)=>{
  if(document.hidden||!readPrefs().autoOpeningHold||!holdWindow())return {ok:false,error:'已离开执行窗口'};
  const output=applyLocalOpening(current,quotes,openingHoldTrends);openingHoldRows=output.rows;
  return {state:output.changed?output.state:current,changed:output.changed};
 },{ifAvailable:true});
 if(!resultWrite.ok){openingHoldError=resultWrite.error;return;}
 state=resultWrite.state;openingHoldError=resultWrite.changed?'已按实际模拟成交写入当前浏览器账本':'已核验实际持仓；没有新增自动模拟成交';
 if(resultWrite.changed)toast('开盘自动风控已记录模拟减仓');
}
function accountTabs(){return '<div class="core-tabs"><button class="btn mini '+(accountView==='manual'?'primary':'subtle')+'" data-action="account-switch" data-value="manual">短线账户</button><button class="btn mini '+(accountView==='robot'?'primary':'subtle')+'" data-action="account-switch" data-value="robot">波段账户</button></div>';}
function accountStats(r,cash,initial,marketValue){return '<div class="summary-grid">'+stat('总资产',Number.isFinite(r.total)?money(r.total):'--','本金 '+money(initial),true)+stat('持仓市值',Number.isFinite(marketValue)?money(marketValue):'--','参考估值')+stat('可用现金',money(cash),'独立账户')+stat('当日收益',pnlMoney(r.day),r.missing?'缺少/过期 '+r.missing+' 只证券报价':'收益率 '+pnlPct(r.dayRate),false,cls(r.day))+stat('累计收益',pnlMoney(r.cumulative),pnlPct(r.cumulativeRate)+' · 含交易费',false,cls(r.cumulative))+'</div>';}
function renderOverview(){
 const robot=accountView==='robot',head=heading('OVERVIEW','资产总览','短线与波段模拟账户完全独立','<button class="btn subtle" data-action="quotes-refresh">刷新报价</button>'+(robot?'':'<button class="btn primary" data-action="open-trade">＋ 模拟下单</button>'));
 if(robot){if(!botAccount)return head+accountTabs()+'<section class="panel"><p>'+e(botError||'等待波段账本')+'</p><button class="btn mini" data-action="refresh-bot">刷新账本</button></section>';
 const b=botAccount,r=robotReturns();return head+accountTabs()+accountStats(r,b.cash,b.initialCash,r.total===null?null:r.total-b.cash)+'<div class="core-tabs"><button class="btn primary" data-page="models">刷新策略 ↗</button></div><section class="panel"><div class="panel-head"><h2>波段账户持仓</h2><button class="section-action" data-page="trades">成交流水 ↗</button></div>'+robotHoldingTable(r)+'</section>';}
 const p=portfolio(displayState()),r=manualReturns();return head+accountTabs()+accountStats(r,p.cash,state.initialCash,p.marketValue)+'<div class="grid-main"><section class="panel"><div class="panel-head"><div><h2>我的持仓</h2><p>含模拟买入费用</p></div><button class="section-action" data-page="trades">全部成交 ↗</button></div>'+compactTable()+'</section><section class="panel"><div class="panel-head"><h2>资产配置</h2></div>'+allocation()+'</section></div><div class="core-tabs"><button class="btn primary" data-page="models">刷新策略 ↗</button><button class="btn subtle" data-page="watchlist">观察列表 ↗</button></div>';
}
function renderWatchlist(){const p=portfolio(displayState()),returns=manualReturns();return `${heading('WATCHLIST','观察列表','8只核心候选股行情跟踪与模型匹配','<button class="btn primary" data-action="open-trade">＋ 模拟下单</button><button class="btn subtle" data-action="open-quote">手动更新价格</button>')}
<section class="panel"><div class="panel-head"><div><h2>行情观察板</h2><p>可核验的公开行情快照</p></div><span class="count">${SECURITIES.length} 只</span></div><div class="watchcards">${SECURITIES.map(s=>{const q=displayState().prices[s.code],h=p.holds.find(x=>x.code===s.code),v=q?.price;return `<article class="watchcard"><div style="display:flex;justify-content:space-between;gap:12px"><div><h3>${e(s.name)}</h3><span class="code">${e(s.code)} · ${e(s.market)}</span></div><span class="tag ${s.halted?'warn':'success'}">${s.halted?'种子停牌':'行情观察'}</span></div><div class="watchcard-price">${s.halted?'—':money(v)}</div><div class="${cls(s.pct)}" style="font-size:12px;font-weight:700">${s.halted?'11月19日无成交':priceInfo(s.code)?.pct!=null?signed(priceInfo(s.code).pct)+' · 对前收':signed(s.pct)+' · 11/19 涨跌'}</div><p>${e(s.note)}</p><div>${s.models.map(m=>`<span class="tag">${m}</span>`).join('')}${s.tags.map(t=>`<span class="tag">${e(t)}</span>`).join('')}</div><div class="signal-summary">${s.halted?`停牌前参考价 ${money(s.referencePrice)}（${s.referenceDate}，仅参考）`:h?`持仓 ${num(h.quantity)} 股 · 当日收益 ${pnlMoney(returns.rows.find(x=>x.code===s.code)?.day)} · 累计收益 ${pnlMoney(returns.rows.find(x=>x.code===s.code)?.cumulative)} · ${e(latestLabel(s.code))}`:'未持仓'}</div><div style="display:flex;gap:8px;margin-top:16px;align-items:center"><button class="btn mini" data-action="open-charts" data-code="${s.code}">分时 / K线</button><button class="btn mini" data-action="open-trade" data-code="${s.code}" ${s.halted?'disabled':''}>模拟交易</button><button class="btn mini subtle" data-action="open-quote" data-code="${s.code}" ${s.halted?'disabled':''}>更新参考价</button><a class="source-link" href="${e(s.source)}" target="_blank" rel="noopener noreferrer">数据来源 ↗</a></div></article>`;}).join('')}</div></section>`;}

async function refreshBot(force=false){
 if(botLoading||!force&&Date.now()-botLoadedAt<60000)return;
 botLoading=true;
 try{
  const r=await fetch('./data/bot.json?v='+Math.floor(Date.now()/60000),{cache:'no-store'});
  if(!r.ok)throw Error('GitHub Pages HTTP '+r.status);
  const data=await r.json();
  if(data?.schema!==1||!Array.isArray(data.trades)||!Array.isArray(data.signals)||
     !Array.isArray(data.pending)||!Array.isArray(data.history)||!data.models?.M5)throw Error('波段账本格式不匹配');
  botAccount=data;botError='';botLoadedAt=Date.now();
 }catch(err){botError=String(err.message||err);botLoadedAt=Date.now();}
 finally{botLoading=false;if(['models','trades','overview'].includes(page))render();if(uiPrefs.autoQuotes)refreshQuotes();}
}
function botHeader(){
 return '<div class="panel-head"><div><h2>波段模拟盘</h2><p>GitHub波段策略，连续交易时段重新核验后模拟成交；与短线账本隔离</p></div><button class="btn mini subtle" data-action="refresh-bot">刷新波段结果</button></div>';
}

async function refreshMorning(force=false){
 if(morningLoading||!force&&Date.now()-morningLastRead<60000)return;
 morningLoading=true;
 try{
  const resp=await fetch('./data/morning.json?v='+Math.floor(Date.now()/60000),{cache:'no-store'});
  if(!resp.ok)throw Error('上午扫描报告 HTTP '+resp.status);
  const report=await resp.json();
  if(report?.schema!==1||!Array.isArray(report.candidates)||!Array.isArray(report.orders))
   throw Error('扫描报告格式不正确');
  morningReport=report;morningError='';morningLastRead=Date.now();
 }catch(err){morningError=String(err?.message||err);morningLastRead=Date.now();}
 finally{morningLoading=false;if(page==='models')render();}
}
function renderMorningReport(){
 const r=morningReport;
 if(!r)return `<section class="panel bot-panel"><div class="panel-head"><div><h2>M5 · 上午收盘扫描</h2><p>11:30之前的真实分时数据，仅生成下午的拟委托</p></div><button class="btn mini subtle" data-action="refresh-morning">刷新上午扫描</button></div><div class="hint">${e(morningError||'等待GitHub Actions写入上午扫描结果。')}</div></section>`;
 const total=r.candidates.length;
 const eligible=r.orders.filter(o=>o.status==='待执行（仅拟单）');
 const blocked=r.orders.filter(o=>o.status==='阻断');
 const stale=r.date&&r.date!==shDate();
 const list=r.candidates.slice(0,20);
 return `<section class="panel bot-panel">
  <div class="panel-head"><div><h2>M5 · 上午11:30选股</h2>
   <p>${e(r.date||'待运行')} · 来源：${e(r.source||'未确认')} · ${e(r.status||'--')}</p></div>
   <button class="btn mini subtle" data-action="refresh-morning">刷新上午结果</button></div>
  ${stale?'<div class="hint">当前显示历史扫描日期，请勿当作今天的买入信号。</div>':''}
  ${morningError?'<div class="hint">刷新异常，保留上一版扫描：'+e(morningError)+'</div>':''}
  <div class="bot-summary">
   <div><small>上午截止</small><strong>${e(r.cutoff||'未运行')}</strong></div>
   <div><small>有效扫描范围</small><strong>${total}只</strong></div>
   <div><small>下午拟委托</small><strong>${eligible.length}笔</strong></div>
   <div><small>交易受阻</small><strong>${blocked.length}笔</strong></div>
  </div>
  <div class="table-wrap"><table class="data-table bot-table"><thead><tr><th>股票</th><th>11:30参考价</th><th>板块强度依据</th><th>放量对比</th><th>MA20暂算</th><th>M5得分</th><th>选股原因</th></tr></thead>
   <tbody>${list.map(x=>`<tr><td class="name">${e(x.name)}<small>${e(x.code)}</small></td>
   <td>${Number.isFinite(x.price)?money(x.price):'--'}</td>
   <td>${e(x.sectorEvidence||'未核验')}<small>${x.sectorMorningPct==null?'--':signed(x.sectorMorningPct)}</small></td>
   <td>${x.halfDayVolumeRatio==null?'--':num(x.halfDayVolumeRatio)+'倍'}</td>
   <td>${x.provisionalMA20==null?'--':money(x.provisionalMA20)}</td>
   <td><span class="tag ${x.passed?'success':''}">${num(x.score)}/3</span></td>
   <td>${e(x.reasons?.join('；')||x.error||'--')}</td></tr>`).join('')||'<tr><td colspan="7">没有有效的上午扫描结果。</td></tr>'}
   </tbody></table></div>
  <div class="panel-head"><div><h2>下午待执行 · 仅模拟拟单</h2><p>不调用券商、不自动成交；涨停附近、数据不足的股票会被阻断。</p></div></div>
  <div class="table-wrap"><table class="data-table bot-table"><thead><tr><th>股票</th><th>方向</th><th>建议数量</th><th>11:30参考价</th><th>状态</th><th>原因</th></tr></thead>
   <tbody>${r.orders.map(o=>`<tr><td class="name">${e(o.name)}<small>${e(o.code)}</small></td><td>${e(o.side)}</td>
     <td>${o.quantity==null?'--':num(o.quantity)+'股'}</td><td>${o.referencePrice==null?'--':money(o.referencePrice)}</td>
     <td><span class="tag">${e(o.status)}</span></td><td>${e(o.reason||o.note||'--')}</td></tr>`).join('')||'<tr><td colspan="6">当前没有满足全部条件、可生成拟单的股票。不能为了凑名单虚构买入。</td></tr>'}
   </tbody></table></div>
  <div class="hint">数据限制：${e(r.universeNote||'--')} ${e(r.volumeNote||'')} ${e(r.maNote||'')} ${e(r.execution||'')}</div>
 </section>`;
}

function renderOpenFive(){
 const p=botAccount?.openFive;
 if(!p)return '';
 const rows=Array.isArray(p.results)?p.results:[];
 const expire=p.status==='expired',done=p.status==='completed';
 const nowParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
 const part=k=>nowParts.find(x=>x.type===k)?.value;
 const localDate=[part('year'),part('month'),part('day')].join('-'),clock=part('hour')+':'+part('minute');
 const missed=localDate>p.targetDate||localDate===p.targetDate&&clock>'09:44';
 const candidates=p.candidates||[];
 const limit=botAccount.initialCash*p.rules.maxPerStockFraction;
 return '<section class="panel bot-panel"><div class="panel-head"><div><h2>11月24日开盘5分钟 · 条件模拟买入</h2>'+
  '<p>仅执行一次：09:35形成信号，09:36-09:44根据真实报价核验后才允许模拟成交</p></div>'+
  '<button class="btn mini subtle" data-action="refresh-bot">刷新执行记录</button></div>'+
  '<div class="bot-summary">'+
   '<div><small>状态</small><strong>'+e(done?'已核验':expire||missed?'已错过':'等待执行')+'</strong></div>'+
   '<div><small>候选股票</small><strong>'+candidates.length+'只</strong></div>'+
   '<div><small>模拟已成交</small><strong>'+rows.filter(x=>x.status==='模拟已成交').length+'笔</strong></div>'+
   '<div><small>单只资金上限</small><strong>'+money(limit)+'</strong></div>'+
  '</div><div class="table-wrap"><table class="data-table bot-table"><thead>'+
  '<tr><th>候选股票</th><th>开盘条件</th><th>状态</th><th>模拟成交</th><th>判断原因</th></tr>'+
  '</thead><tbody>'+candidates.map(c=>{
    const r=rows.find(x=>x.code===c.code);
    const guard='五分钟量比≥'+num(p.rules.minOpeningVolumeRatio)+'倍；涨幅'+
       num(p.rules.minGainPct)+'%～'+num(p.rules.maxGainPct)+'%；高于MA20'+
       (c.sectorRequired?'；所属板块≥'+num(p.rules.minSectorChangePct??0)+'%':'')+'；回撤≤'+num(p.rules.maxPullbackFrom935Pct??1)+'%';
    return '<tr><td class="name">'+e(c.name)+'<small>'+e(c.code)+' · '+e(c.modelId)+'</small></td>'+
      '<td>'+guard+'</td><td><span class="tag">'+e(r?.status||(expire?'未执行':'待验证'))+'</span></td>'+
      '<td>'+(r?.status==='模拟已成交'?num(r.quantity)+'股 × '+money(r.price):'--')+'</td>'+
      '<td>'+e(r?.reason||c.basis)+'</td></tr>';
   }).join('')+'</tbody></table></div>'+
   '<div class="hint">'+e(p.message||'等待核验')+
   '。独立机器人模拟账户；不接真实券商，不修改本地短线账户。GitHub Actions可能延迟，错过时间不倒填成交。</div></section>';
}

function renderBotModel(){
 if(!botAccount)return '<section class="panel bot-panel">'+botHeader()+
  '<div class="hint">'+e(botError||'正在获取仓库的自动模拟账本…')+'</div></section>';
 const b=botAccount,cfg=b.models.M5,signals=b.signals||[],
  returns=robotReturns(),equity=returns.total,profit=returns.cumulative;
 const passed=signals.filter(x=>x.passed);
 return `<section class="panel bot-panel">${botHeader()}
  ${botError?'<div class="hint">最近获取失败，展示之前成功的数据：'+e(botError)+'</div>':''}
  <div class="bot-summary">
   <div><small>最近交易日</small><strong>${e(b.lastDate||'尚未执行')}</strong></div>
   <div><small>波段账户估值</small><strong>${money(equity)}</strong></div>
   <div><small>当日模拟收益</small><strong class="${cls(returns.day)}">${pnlMoney(returns.day)}</strong><small>${pnlPct(returns.dayRate)} · ${returns.missing?'报价不全':'当日估值'}</small></div>
   <div><small>累计模拟盈亏</small><strong class="${cls(profit)}">${pnlMoney(profit)}</strong><small>${pnlPct(returns.cumulativeRate)}</small></div>
   <div><small>本期重点候选</small><strong>${passed.length}只</strong></div>
  </div>
  ${robotHoldingTable(returns)}
  <p class="bot-method"><strong>M5规则：</strong>板块上涨 + 放量至少${num(cfg.volumeMultiplier)}倍 + 收盘站上MA20。最多持有${cfg.maxPositions}只；单只预算不超过本金${Math.round(cfg.positionFraction*100)}%。M1～M4等待可靠证据，未自动交易。</p>
  <div class="table-wrap"><table class="data-table bot-table"><thead><tr><th>代码 / 名称</th><th>板块</th><th>分数</th><th>成交量 / 近5日均量</th><th>当日收盘</th><th>判断</th></tr></thead>
  <tbody>${signals.slice(0,15).map(x=>`<tr><td class="name">${e(x.name)}<small>${e(x.code)}</small></td><td>${e(x.sector||'--')}</td>
    <td><span class="tag ${x.passed?'success':''}">${x.score}/3</span></td>
    <td>${x.volumeRatio===null?'--':num(x.volumeRatio)+'倍'}</td><td>${x.close===null?'--':money(x.close)}</td>
    <td>${e((x.reasons||[]).join('；'))}</td></tr>`).join('')||'<tr><td colspan="6">尚无有效的自动选股结果，等待交易日收盘后更新。</td></tr>'}
  </tbody></table></div>
  <div class="hint">待下一交易日尝试的模拟订单：${b.pending.length}笔。信号不是成交，不保证涨停可买、跌停可卖；行情来自第三方公开日K。</div>
 </section>`;
}
function renderBotTrades(){
 if(!botAccount)return '<section class="panel bot-panel">'+botHeader()+
  '<div class="hint">'+e(botError||'加载波段模拟账户中…')+'</div></section>';
 const b=botAccount,history=b.history||[],last=history.at(-1),trades=b.trades||[];
 const returns=robotReturns(),currentEstimate=returns.total;
 const realized=trades.filter(t=>t.side==='SELL'),wins=realized.filter(t=>t.pnl>0);
 const rate=realized.length?Math.round(wins.length/realized.length*100)+'%':'暂无';
 return `<section class="panel bot-panel">${botHeader()}
  <div class="bot-summary">
   <div><small>可用现金</small><strong>${money(b.cash)}</strong></div>
   <div><small>最新参考资产</small><strong>${pnlMoney(currentEstimate)}</strong></div>
   <div><small>当日收益</small><strong class="${cls(returns.day)}">${pnlMoney(returns.day)}</strong></div><div><small>累计收益</small><strong class="${cls(returns.cumulative)}">${pnlMoney(returns.cumulative)}</strong></div>
   <div><small>已成交</small><strong>${trades.length}笔</strong></div>
   <div><small>已平仓交易胜率</small><strong>${rate}</strong></div>
  </div>
  ${robotHoldingTable(returns)}
  <div class="table-wrap"><table class="data-table bot-table">
   <thead><tr><th>信号日 / 成交日</th><th>股票</th><th>方向</th><th>数量</th><th>假设成交价</th><th>费用</th><th>盈亏（卖出）</th></tr></thead>
   <tbody>${[...trades].reverse().slice(0,35).map(t=>`<tr><td>${e(t.signalDate||t.date)}<small>${e(t.quoteTime?new Date(t.quoteTime).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):t.date)}</small></td>
      <td class="name">${e(t.name)}<small>${e(t.code)}</small></td>
      <td class="${t.side==='BUY'?'up':'down'}">${t.side==='BUY'?'买入':'卖出'}</td>
      <td>${num(t.quantity)}</td><td>${money(t.price)}</td><td>${money(t.fee)}</td>
      <td class="${cls(t.pnl??0)}">${t.pnl==null?'--':money(t.pnl)}</td></tr>`).join('')||'<tr><td colspan="7">尚无自动模拟成交。第一次扫描只产生下一交易日的候选订单。</td></tr>'}
   </tbody></table></div>
  <p class="bot-method">波段策略使用有效盘中报价和0.1%滑点；历史M5成交保留原记录。未成交记录：</p>
  <div class="bot-events">${[...(b.events||[])].reverse().slice(0,8).map(x=>`<span class="tag">${e(x.date)} · ${e(x.code)} · ${e(x.reason)}</span>`).join('')||'<span class="smallnote">暂无未成交记录</span>'}</div>
 </section>`;
}


function applyUiPrefs(){
 document.documentElement.classList.toggle('compact-hints',!uiPrefs.showRiskHints);
 setTerminalPageSize(uiPrefs.tablePageSize);
}
function renderSettings(){
 const opts=(values,current)=>values.map(([v,label])=>`<option value="${e(v)}" ${String(v)===String(current)?'selected':''}>${e(label)}</option>`).join('');
 const setting=(label,desc,control)=>`<div class="settings-row"><div><strong>${label}</strong><p>${desc}</p></div><div class="settings-control">${control}</div></div>`;
 const select=(key,items)=>`<select data-pref="${key}" aria-label="${key}">${opts(items,uiPrefs[key])}</select>`;
 const toggle=(key)=>`<input type="checkbox" data-pref="${key}" aria-label="${key}" ${uiPrefs[key]?'checked':''}>`;
 const model=botAccount?.models?.M5;
 return `${heading('WORKSPACE / PREFERENCES','设置','管理交易台、行情显示和模拟盘参数。浏览器设置保存在本机；GitHub机器人参数需要编辑仓库文件。')}
 <div class="settings-grid">
 <section class="panel settings-card"><div class="panel-head"><h2>账户与资金</h2></div>
 ${setting('短线初始资金','已统一为100万元；旧80万元账本追加20万元可用现金，不重写历史买入。','<strong>'+money(state.initialCash)+'</strong>')}
 ${setting('短线可用现金','当前浏览器独立保存，不会同步到GitHub机器人。','<strong>'+money(state.cash)+'</strong>')}
 ${setting('波段初始资金','来自GitHub仓库的独立账户。','<strong>'+money(botAccount?.initialCash??1000000)+'</strong>')}
 ${setting('手动下单默认预算','影响今后的新订单预填股数，不改变已成交订单。',select('defaultBudget',[[50000,'5万元'],[100000,'10万元'],[150000,'15万元'],[200000,'20万元']]))}
 ${setting('下单前二次确认','仅手动模拟下单会弹出确认。',toggle('confirmTrades'))}
  </section>
 <section class="panel settings-card"><div class="panel-head"><h2>行情和图表</h2></div>
 ${setting('自动刷新行情','关闭后只在点击手动刷新时拉取最新行情。',toggle('autoQuotes'))}
 ${setting('盘中报价刷新间隔','公开接口不保证这个频率对应真实行情更新。',select('quoteInterval',[[3000,'3秒'],[10000,'10秒'],[30000,'30秒']]))}
 ${setting('行情表默认每页','设置后首次进入行情中心生效。',select('tablePageSize',[[30,'30条'],[60,'60条'],[90,'90条']]))}
 ${setting('默认走势图','点击股票名称进入图表时采用此周期。',select('defaultChartPeriod',[['minute','分时'],['day','日K'],['week','周K'],['month','月K']]))}
 ${setting('显示辅助说明','隐藏可选帮助文字，但保留交易风险和数据来源提示。',toggle('showRiskHints'))}
 </section>
 <section class="panel settings-card"><div class="panel-head"><h2>显示与自动更新</h2></div>
 ${setting('界面主题','亮色、暗色全站统一。',`<div class="settings-theme"><button data-action="settings-theme" data-value="dark" class="btn mini ${document.documentElement.dataset.theme==='dark'?'primary':'subtle'}">暗色</button><button data-action="settings-theme" data-value="light" class="btn mini ${document.documentElement.dataset.theme==='light'?'primary':'subtle'}">亮色</button></div>`)}
 ${setting('自动更新机器人结果','从GitHub Pages读取只读JSON；不会改变手动持仓。',toggle('autoBotRefresh'))}
 ${setting('时区','行情与交易日按北京时间解释，和设备所在地无关。','<strong>Asia/Shanghai（UTC+8）</strong>')}
 ${setting('默认模拟费率','买卖佣金万分之2.5（最低5元）；过户费十万分之一；卖出印花税万分之五。','<span class="tag">只读 · 与现有模拟规则一致</span>')}
 </section>
 <section class="panel settings-card"><div class="panel-head"><h2>机器人与任务</h2></div>
 ${setting('波段开仓模式','W1–W5 使用带来源的基本面证据；不再运行旧M5交易。','<strong>WAVE-v2</strong>')}
 ${setting('波段基本面证据','由仓库维护；缺证据不开新仓。','<a href="https://github.com/jackson-heylion/stock-market/edit/main/data/wave-evidence.json" target="_blank" rel="noopener">维护证据 ↗</a>')}
 ${setting('波段首次预算 / 最大持仓','单股上限25%，组合上限80%。','<strong>10% / 5只</strong>')}
 ${setting('波段定时任务','09:35与14:30核验并执行，15:30只更新研究。','<span class="tag">北京时间</span>')}
 <p class="settings-link"><a href="https://github.com/jackson-heylion/stock-market/edit/main/data/bot.json" target="_blank" rel="noopener noreferrer">编辑机器人资金与策略参数 ↗</a><a href="https://github.com/jackson-heylion/stock-market/actions" target="_blank" rel="noopener noreferrer">查看GitHub定时任务 ↗</a></p>
 <div class="hint">GitHub Pages是静态网页，不能直接保存机器人配置回GitHub。浏览器里的设置不会暗中改变定时机器人参数。</div>
 </section>
 <section class="panel settings-card"><div class="panel-head"><h2>备份、恢复和隐私</h2></div>
 ${setting('本地模拟账本','包含持仓、成交、手动参考价、模型人工核验结果。','<button class="btn mini subtle" data-action="export">导出JSON</button>')}
 ${setting('导入短线账本','兼容原80万元合法备份，自动补足至100万元。','<button class="btn mini subtle" data-action="import">导入JSON</button>')}
 ${setting('恢复初始短线盘','删除当前手动交易，重新建立历史7笔、每只10万预算的模拟持仓。','<button class="btn mini subtle" data-action="reset">恢复初始盘</button>')}
 ${setting('清除最近访问','仅当前浏览器行情中心访问记录。','<button class="btn mini subtle" data-action="settings-clear-recent">清除记录</button>')}
 ${setting('清空关注','不影响原始观察池和持仓。','<button class="btn mini subtle" data-action="settings-clear-follows">清空关注</button>')}
 ${setting('恢复默认界面设置','不清除交易和历史行情数据。','<button class="btn mini subtle" data-action="settings-reset-prefs">恢复默认</button>')}
 </section>
 </div>`;
}

function strategyTabs(){return '<div class="core-tabs strategy-slots">'+['opening','afternoon'].map(slot=>'<button class="btn mini '+(strategySlot===slot?'primary':'subtle')+'" data-action="strategy-slot" data-value="'+slot+'">'+slotLabel(slot)+' '+(slot==='opening'?'开盘':'午后')+'</button>').join('')+'</div>';}
function renderManualCandidates(a){
 const rows=a?.candidates||[],matched=rows.filter(c=>c.modelOk).length;
 return '<section class="panel"><div class="panel-head"><div><h2>新标的发现与开仓判断</h2><p>'+ (a?'发现 '+rows.length+' 只 · 满足模型 '+matched+' 只 · '+e(a.discoveryCoverage||'未扫描'):'点击更新 / 核验以发现新标')+'</p></div></div>'+
 (a?.discoveryWarning?'<div class="hint">'+e(a.discoveryWarning)+'</div>':'')+
 '<p class="hint">M5量价及行业模型；AI、成长、周期及M1–M4基本面证据尚需独立核验。新标仅研究，不自动买入；模型判断和账户限制分开。参考价、预算与止损不是成交指令。</p>'+
 (rows.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>标的 / 来源</th><th>价格 / MA20</th><th>开仓判断 / 逐项条件</th><th>价格与仓位参考</th><th>账户约束</th></tr></thead><tbody>'+rows.map(c=>'<tr><td><button class="section-action" data-action="radar-stock" data-code="'+e(c.code)+'" data-name="'+e(c.name)+'">'+e(c.name)+'</button><small>'+e(c.code)+' · '+e(c.sector)+'</small><small>'+e(c.discoverySource)+'</small></td><td>'+(Number.isFinite(c.price)?money(c.price):'--')+'<small>MA20 '+(Number.isFinite(c.ma20)?money(c.ma20):'--')+'</small><small>'+(c.quoteTime?e(new Date(c.quoteTime).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))+' · '+e(c.source):'无有效报价')+'</small></td><td><strong>'+e(c.judgment)+'</strong><details><summary>条件 '+c.checks.filter(x=>x.status==='通过').length+'/'+c.checks.length+'</summary>'+c.checks.map(x=>'<p><b>'+e(x.name)+' · '+e(x.status)+'</b><small>'+e(x.condition)+'；实际 '+e(x.actual)+'</small></p>').join('')+'</details><small>'+e(c.signal.reason)+'</small></td><td>'+(c.priceBand?money(c.priceBand.min)+'–'+money(c.priceBand.max):'待核')+'<small>仍须高于MA20并满足承接</small><small>预算 '+money(c.budget)+' · '+num(c.quantity)+'股（参考）</small><small>参考止损 '+(Number.isFinite(c.stopPrice)?money(c.stopPrice):'--')+'</small></td><td>'+e(c.gates.join('；'))+'</td></tr>').join('')+'</tbody></table></div>':'<p>尚无可核验的新标的，不生成虚假候选。</p>')+'</section>';
}
function renderManualAfternoon(){
 const slot=strategySlot,key=manualKey(slot),saved=state[key],done=saved?.date===shDate(),a=manualAfternoonPreview[slot]||(done?saved:null),windowOpen=strategyWindow(Date.now(),slot),error=manualAfternoonError[slot];
 const label={OPEN:'开仓',ADD:'加仓',REDUCE:'减仓',CLEAR:'清仓',HOLD:'持有/观察'};
 return '<section class="panel"><div class="panel-head"><div><h2>'+slotLabel(slot)+' · 短线账户持仓处理</h2><p>本地实际持仓 · '+(done?'今日已执行':windowOpen?'执行窗口开放':'执行窗口未开放')+'</p></div><div class="action-row"><button class="btn mini subtle" data-action="manual-afternoon-preview" '+(manualAfternoonBusy?'disabled':'')+'>更新 / 核验</button><button class="btn mini primary" data-action="manual-afternoon-execute" '+(manualAfternoonBusy||done||!windowOpen?'disabled':'')+'>核验并执行</button></div></div><p class="hint">'+(slot==='opening'?'09:35形成信号，09:36–09:44核验已完成的前五分钟量价，量比代理≥1.8。':'14:30–14:55核验累计量、行业和MA20，累计量比≥1.3。')+' 15秒报价、同股当日不重复成交、T+1；仅修改本地模拟账本。</p>'+(error?'<p class="hint">'+e(error)+'</p>':'')+(a?'<p>'+e(a.message||('核验 '+a.checkedAt))+'</p><div class="table-wrap"><table class="data-table"><thead><tr><th>证券/持仓股数</th><th>参考价</th><th>成本收益率</th><th>动作</th><th>股数</th><th>依据/状态</th></tr></thead><tbody>'+a.rows.map(x=>'<tr><td>'+e(x.name)+'<small>'+e(x.code)+' · '+num(x.held)+'股</small></td><td>'+(Number.isFinite(x.price)?money(x.price):'--')+'</td><td class="'+cls(x.pnl)+'">'+pnlPct(x.pnl)+'</td><td>'+e(label[x.action]||x.action)+'</td><td>'+num(x.quantity)+'</td><td>'+e(x.reason)+'<small>'+e(x.status||'未执行')+'</small></td></tr>').join('')+'</tbody></table></div>':'<p>尚无今日核验结果。</p>')+'</section>'+renderManualCandidates(a);
}
async function runManualAfternoon(execute){
 const slot=strategySlot;
 if(manualAfternoonBusy)return;
 if(execute&&!strategyWindow(Date.now(),slot)){toast('不在策略执行窗口，不补记成交');return;}
 if(execute&&!confirm('按本地实际账本和最新有效行情执行'+slotLabel(slot)+'模拟策略？只修改本浏览器模拟账本。'))return;
 manualAfternoonBusy=true;manualAfternoonError[slot]='正在核验行情';render();
 try{
  const snapshot=await collectManualAfternoon({proxy:new URLSearchParams(location.search).get('proxy')||'',slot,heldCodes:portfolio(state).holds.map(h=>h.code)});
  manualAfternoonPreview[slot]=planManualAfternoon(state,snapshot,Date.now(),slot);
  if(execute){
   const r=await editLedger((next,current)=>applyManualAfternoon(current,snapshot,Date.now(),slot));
   if(!r.ok){manualAfternoonError[slot]=r.error;toast(r.error);return;}
   state=r.state;manualAfternoonPreview[slot]=r.plan;manualAfternoonError[slot]='';toast(r.message);
  }else manualAfternoonError[slot]='仅核验，未写入任何成交';
 }catch(err){manualAfternoonError[slot]=String(err.message||err);toast(manualAfternoonError[slot]);}
 finally{manualAfternoonBusy=false;render();}
}
function renderAfternoon(){
 const slot=strategySlot,a=botAccount?.[slot==='opening'?'opening':'afternoon'],label=slotLabel(slot),done=a?.date===shDate();
 const head='<section class="panel"><div class="panel-head"><div><h2>'+label+' · 波段账户</h2><p>'+(done?'今日已执行':a?'今日待执行 · 上次 '+e(a.date):'等待首次执行')+'</p></div><div class="action-row"><button class="btn mini subtle" data-action="refresh-bot">刷新结果</button><a class="btn mini subtle" href="https://github.com/jackson-heylion/stock-market/actions/workflows/afternoon.yml" target="_blank" rel="noopener noreferrer">GitHub执行 ↗</a></div></div><p class="hint">'+(slot==='opening'?'09:35触发、09:36–09:44执行，09:40可重试。':'14:30触发，14:40可重试，最迟14:55。')+' 波段账户由GitHub独立执行；页面只读。</p>';
 if(!a)return head+'<p>'+e(botError||'尚无策略核验结果。')+'</p></section>';
 return head+'<p>'+e(a.date)+' · '+e(a.message)+'</p><div class="hint">行情核验 '+e(a.checkedAt)+' · '+(a.marketOk?'允许条件买入':'市场风控限制买入')+'</div><div class="table-wrap"><table class="data-table"><thead><tr><th>证券</th><th>动作</th><th>状态</th><th>依据</th></tr></thead><tbody>'+(a.results||[]).map(x=>'<tr><td>'+e(x.name)+'<small>'+e(x.code)+'</small></td><td>'+e(({OPEN:'开仓',ADD:'加仓',REDUCE:'减仓',CLEAR:'清仓',HOLD:'持有'})[x.action]||x.action)+'</td><td>'+e(x.status)+'</td><td>'+e(x.reason)+'</td></tr>').join('')+'</tbody></table></div><div class="table-wrap"><table class="data-table"><thead><tr><th>候选</th><th>参考价</th><th>量比</th><th>MA20</th><th>核验</th></tr></thead><tbody>'+(a.scores||[]).map(x=>'<tr><td>'+e(x.name)+'<small>'+e(x.code)+'</small></td><td>'+(Number.isFinite(x.price)?money(x.price):'--')+'</td><td>'+e(x.ratio??'--')+'</td><td>'+e(x.ma20??'--')+'</td><td>'+e(x.reason)+'</td></tr>').join('')+'</tbody></table></div></section>';
}
let dualBusy=false,dualPlans={},dualError={},dualSelected={short:new Set(),wave:new Set()};
const strategyType=()=>accountView==='robot'?'wave':'short';
function renderDual(){
 const type=strategyType(),cfg=STRATEGIES[type],plan=dualPlans[type]||(type==='wave'?botAccount?.wavePlan:state.shortPlan),selection=dualSelected[type],names=Object.fromEntries(MODES[type]),labels={OPEN:'开仓',ADD:'加仓',REDUCE:'减仓',CLEAR:'清仓',HOLD:'观察'};
 const section=(title,rows)=>'<section class="panel"><div class="panel-head"><h2>'+title+'</h2><span class="count">'+rows.length+'只</span></div>'+(!rows.length?'<p>暂无有效标的</p>':'<div class="table-wrap"><table class="data-table"><thead><tr><th>选择</th><th>证券 / 行业</th><th>参考价 / 时点</th><th>开仓模式与条件</th><th>建议 / 数量</th><th>执行限制</th></tr></thead><tbody>'+rows.map(r=>{const key=r.code+':'+r.action;return '<tr><td>'+(r.action==='HOLD'?'--':'<input type="checkbox" aria-label="选择 '+e(r.name)+'" data-strategy-select="'+e(key)+'" '+(selection.has(key)?'checked':'')+'>')+'</td><td><button class="section-action" data-action="radar-stock" data-code="'+e(r.code)+'" data-name="'+e(r.name)+'">'+e(r.name)+'</button><small>'+e(r.code)+' · '+e(r.sector)+'</small><small>'+num(r.held)+'股 · '+pnlPct(r.pnl)+'</small></td><td>'+pnlMoney(r.price)+'<small>'+e(r.priceKind)+' · '+e(r.referenceDate||'待核')+'</small><small>MA20 '+pnlMoney(r.m20)+' / MA60 '+pnlMoney(r.m60)+'</small></td><td>'+e(r.passed.map(id=>names[id]).join(' / ')||'暂未满足')+''+(type==='short'?'<small>已完成连板估算 '+(r.streak??'待核')+'</small>':'')+'<details><summary>展开逐项条件</summary>'+r.modes.map(m=>'<p><b>'+e(m.id+' '+names[m.id])+' · '+(m.pass?'通过':'未通过')+'</b>'+m.checks.map(c=>'<small>'+e((c.pass===true?'通过':c.pass===false?'不通过':'待核')+' · '+c.name+'：'+c.detail)+'</small>').join('')+'</p>').join('')+'</details></td><td><strong>'+e(labels[r.action])+'</strong><small>'+e(r.reason)+'</small><small>'+num(r.quantity)+'股</small></td><td>'+e(r.gates.join('；')||'可重新核验执行')+'</td></tr>';}).join('')+'</tbody></table></div>')+'</section>';
 const queued=type==='short'?state.shortIntent:botAccount?.waveIntent;
 return '<section class="panel"><div class="panel-head"><div><h2>'+cfg.label+'策略工作台</h2><p>休市 / 集合竞价 / 连续交易均可刷新；仅连续交易有效报价可成交</p></div><div class="action-row"><button class="btn primary" data-action="dual-refresh" '+(dualBusy?'disabled':'')+'>刷新处理建议</button><button class="btn subtle" data-action="dual-execute" '+(dualBusy||!selection.size?'disabled':'')+'>选择执行（'+selection.size+'）</button>'+(queued&&type==='short'?'<button class="btn subtle" data-action="dual-resume">恢复待核验选择</button>':'')+'</div></div><p>开仓模式：'+e(MODES[type].map(([id,n])=>id+' '+n).join(' · '))+'</p><p class="hint">持仓上限 '+cfg.maxPositions+'只 · 单股 '+cfg.maxStock*100+'% · 总仓 '+cfg.maxTotal*100+'% · 止损 '+cfg.stop*100+'% · 回撤 '+cfg.trail*100+'%。'+(type==='wave'?'波段账本在GitHub；执行须在GitHub授权页面提交选择。基本面证据缺失不开放买入。':'短线本地独立账本，休市选择保留待核验，不补记成交。')+'</p>'+(dualError[type]?'<p class="hint">'+e(dualError[type])+'</p>':'')+(queued?'<p class="hint">待核验选择：'+e(queued.selected.join('、'))+' · '+e(queued.createdAt)+'</p>':'')+(plan?'<p>'+e(plan.phase)+' · '+e(plan.checkedAt)+' · 完整日K '+e(plan.completedDate||'未核验')+'</p><small>'+e(plan.warning||'')+'</small>':'<p>尚未刷新策略</p>')+'</section>'+(plan?section('持仓处理',plan.rows.filter(r=>r.held>0))+section('新标的发现与开仓判断',plan.rows.filter(r=>!r.held))+(plan.results?.length?'<section class="panel"><h2>执行结果</h2>'+plan.results.map(r=>'<p>'+e(r.code+' · '+r.status+' · '+r.reason)+'</p>').join('')+'</section>':''):'');
}
async function loadWaveEvidence(){try{const r=await fetch('./data/wave-evidence.json',{cache:'no-store'});if(r.ok)return (await r.json()).securities||{};}catch{}return {};}
async function runDual(execute=false){
 if(dualBusy)return;const type=strategyType(),selected=[...dualSelected[type]],account=type==='short'?state:botAccount;
 if(!account){toast('账户未加载');return;}
 if(execute&&!selected.length){toast('请先勾选处理建议');return;}
 if(execute&&type==='wave'){
  const instruction=selected.join(',');
  window.open('https://github.com/jackson-heylion/stock-market/actions/workflows/afternoon.yml','_blank','noopener');
  try{await navigator.clipboard.writeText(instruction);}catch{}
  dualError.wave='选中指令：'+instruction+'。已尝试复制，请在GitHub Run workflow 的 selection 输入框粘贴，选择 selected。休市提交只保存待核验指令。';
  render();return;
 }
 if(execute&&!confirm('确认对选中短线建议重新核验？仅在连续交易有效行情下模拟成交；其他时段保存待核验选择。'))return;
 if(execute&&session()!=='open'){
  const r=await editLedger(next=>{next.shortIntent={selected,createdAt:new Date().toISOString()};return {};});
  if(r.ok){state=r.state;dualError.short='已保存待核验选择，交易时段重新核验执行；未成交。';}else dualError.short=r.error;render();return;
 }
 dualBusy=true;dualError[type]='正在核验公开行情与日K';render();
 try{
  const snapshot=await collectStrategy(account,type,{proxy:new URLSearchParams(location.search).get('proxy')||'',evidence:type==='wave'?await loadWaveEvidence():{},extraCodes:selected.map(k=>k.split(':')[0])});
  dualPlans[type]=planStrategy(account,snapshot,type,Date.now());
  if(execute){const r=await editLedger((next,current)=>applyShort(current,snapshot,selected,Date.now()));if(!r.ok)throw Error(r.error);state=r.state;dualPlans.short=r.plan;dualSelected.short.clear();dualError.short=r.message;}
  else{dualSelected[type].clear();dualError[type]='仅刷新建议，未产生模拟成交。';}
 }catch(err){dualError[type]=String(err.message||err);}
 finally{dualBusy=false;render();}
}

function renderEvidenceModels(){return `<div class="account-notes">可解释的规则清单核验；信号由11月19日公开事件初筛，突破与量能结合日K核验。</div>
<div class="model-grid">${MODEL_DEFINITIONS.map(m=>{const applied=SECURITIES.filter(s=>s.models.includes(m.id));return `<article class="model-card"><span class="model-no">MODEL / ${m.id}</span><h3>${m.name}</h3><div class="model-type">${m.type}</div><p>${m.description}</p><ul class="checklist">${m.checks.map((check,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span>${check}</li>`).join('')}</ul><div class="risk">风险提示：${m.risk}</div><div class="model-applications"><div class="panel-head"><div><h2>观察股证据核验</h2><p>修改结果仅保存在当前浏览器</p></div></div>${applied.map(s=>{const info=modelEvidence(state,s.code,m.id);return `<div class="model-applied"><span class="tag">${e(s.name)}</span><small>${info.confirmed}/${info.total} 确认${info.contradicted?' · 存在反证':''}</small>${m.checks.map((c,i)=>`<div class="signal-row"><label title="${e(c)}">${i+1}. ${e(c)}</label><select aria-label="${e(s.name)} ${e(c)}" data-action="signal" data-code="${s.code}" data-model="${m.id}" data-index="${i}"><option value="0" ${info.flags[i]===0?'selected':''}>待核</option><option value="1" ${info.flags[i]===1?'selected':''}>确认</option><option value="-1" ${info.flags[i]===-1?'selected':''}>不符合</option></select></div>`).join('')}</div>`;}).join('')}</div></article>`;}).join('')}</div>`;}

function renderModels(){return heading('MODELS','策略中心','短线与波段 · 任意时段刷新，逐股选择模拟执行')+accountTabs()+renderDual()+'<details class="panel strategy-archive"><summary>历史模型研究（只供参考）</summary>'+renderEvidenceModels()+'</details>';}
function renderTrades(){if(accountView==='robot')return heading('LEDGER','成交流水','波段账户 · GitHub只读成交记录','<button class="btn subtle" data-action="refresh-bot">刷新账本</button>')+accountTabs()+renderBotTrades();return `${heading('LEDGER','成交流水','短线账户 · 本地模拟成交记录','<button class="btn primary" data-action="open-trade">＋ 模拟下单</button><button class="btn subtle" data-action="import">导入备份</button><button class="btn subtle" data-action="reset">恢复初始盘</button>')}
${accountTabs()}<section class="panel"><div class="panel-head"><div><h2>交易流水</h2><p>按成交时间排序 · T+1交割约束</p></div><span class="count">${state.trades.length} 笔</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>单号 / 日期</th><th>证券</th><th>方向</th><th>数量</th><th>成交价</th><th>成交金额</th><th>费用</th><th>说明</th></tr></thead><tbody>${[...state.trades].reverse().map(t=>`<tr><td>${e(t.id)}<small>${e(t.date)}</small></td><td class="name">${e(stock(t.code).name)}<small>${e(t.code)}</small></td><td class="${t.side==='BUY'?'up':'down'}">${t.side==='BUY'?'买入':'卖出'}</td><td>${num(t.quantity)}</td><td>¥${t.price.toFixed(2)}</td><td>${money(t.gross)}</td><td>${money(t.fee)}</td><td>${t.seed?'<span class="tag">历史快照初始化</span>':[manualVersion('opening'),MANUAL_VERSION].includes(t.strategyVersion)?'<span class="tag">'+(t.strategyVersion===manualVersion('opening')?'09:35':'14:30')+'手动策略</span><small>'+e(t.reason)+'</small>':t.strategyVersion===STRATEGIES.short.version?'<span class="tag">短线策略</span><small>'+e(t.reason)+'</small>':t.strategyVersion===HOLD_POLICY.version?'<span class="tag">开盘自动风控</span><small>'+e(t.reason)+'</small>':'<span class="tag">手动模拟成交</span>'}</td></tr>`).join('')}</tbody></table></div><div class="hint">模拟费率：佣金 0.025%（最低5元），过户费 0.001%，卖出印花税 0.05%。仅供参考测算。</div></section>`;}
function openTrade(code){const dialog=$('#trade-dialog'),sel=$('#trade-code');sel.innerHTML=[...SECURITIES.filter(s=>!s.halted),...Object.values(state.securities||{})].map(s=>`<option value="${e(s.code)}">${e(s.name)} ${e(s.code)}</option>`).join('');sel.value=code&&stock(code)&&!stock(code).halted?code:SECURITIES[0].code;$('#trade-form').reset();sel.value=code&&!stock(code).halted?code:SECURITIES[0].code;const s=stock(sel.value);$('#trade-price').value=priceInfo(s.code)?.price??state.prices[s.code]?.price??s.close;$('#trade-qty').value=budgetQuantity(uiPrefs.defaultBudget,Number($('#trade-price').value));updateOrderPreview();dialog.showModal();}
function updateOrderPreview(){const p=Number($('#trade-price').value),q=Number($('#trade-qty').value),side=$('input[name="side"]:checked')?.value??'BUY';if(!Number.isFinite(p)||p<=0||!Number.isInteger(q)||q<=0){$('#order-preview').textContent='输入有效价格与股数以预览';return;}const gross=p*q,fee=feeTotal(fees(side,gross));$('#order-preview').textContent=`成交金额 ${money(gross)} · 费用约 ${money(fee)} · ${side==='BUY'?'所需资金':'预计到账'} ${money(side==='BUY'?gross+fee:gross-fee)}`;}
function openQuote(code){const sel=$('#quote-code');sel.innerHTML=[...SECURITIES.filter(s=>!s.halted),...Object.values(state.securities||{})].map(s=>`<option value="${e(s.code)}">${e(s.name)} ${e(s.code)}</option>`).join('');sel.value=code&&!stock(code).halted?code:SECURITIES[0].code;$('#quote-price').value=state.prices[sel.value]?.price;$('#quote-date').value=shDate();$('#quote-dialog').showModal();}
function exportFile(){const raw=JSON.stringify({exportedAt:new Date().toISOString(),kind:'stock-market-paper-v1',state},null,2);const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='stock-market-paper-'+shDate()+'.json';a.click();URL.revokeObjectURL(url);toast('账本已导出（仅本地文件）');}
async function importFile(file){if(!file)return;try{if(file.size>3_000_000)throw Error('文件过大');const data=JSON.parse(await file.text());if(data.kind!=='stock-market-paper-v1'||!migrateCapital(data.state))throw Error('账本不合法或版本不兼容');const upgraded=migrateCapital(data.state);if(!upgraded)throw Error('导入账本无法迁移到100万元');if(!confirm('导入将覆盖当前浏览器账本，是否继续？'))return;const write=await editLedger(()=>({state:upgraded}));if(!write.ok)throw Error(write.error);state=write.state;render();toast('已导入模拟账本'+(upgraded!==data.state?'（已补足100万初始资金）':''));}catch(err){toast('导入失败：'+err.message);}$('#import-file').value='';}
async function bootstrap(){initTheme();state=load();const initialized=await editLedger(()=>({}));if(initialized.ok)state=initialized.state;applyUiPrefs();render();if(!initialized.ok)toast(initialized.error);refreshMorning(true);if(uiPrefs.autoBotRefresh)refreshBot(true);fetch('./data/version.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(v=>{if(v?.sha){releaseVersion=String(v.sha).slice(0,8);render();}}).catch(()=>{});window.addEventListener('storage',evt=>{if(evt.key===STORAGE_KEY&&evt.newValue){try{const v=migrateCapital(JSON.parse(evt.newValue));if(v){state=v;render();}}catch{}}});
 document.addEventListener('change',evt=>{const key=evt.target.dataset?.strategySelect;if(key){const set=dualSelected[strategyType()];if(evt.target.checked)set.add(key);else set.delete(key);render();}});
 document.addEventListener('click',evt=>{const btn=evt.target.closest('button');if(!btn)return;if(btn.dataset.page){page=btn.dataset.page;render();if(page==='charts')requestChart();if(page==='market'){refreshMarket();requestIndexChart();}if(page==='quotes')refreshTerminal(false,()=>{if(page==='quotes')render();});if((page==='models'||page==='trades')&&uiPrefs.autoBotRefresh)refreshBot();if(page==='models')refreshMorning();if(page==='radar')refreshRadar({onUpdate:()=>{if(page==='radar')render();}});window.scrollTo(0,0);return;}if(btn.dataset.close){$('#'+btn.dataset.close).close();return;}
 if(btn.dataset.action?.startsWith('radar-')){
  handleRadarClick(btn,{
    onUpdate:()=>{if(page==='radar')render();},
    openStock:(code,name)=>{
      externalStockLookup.set(code,{code,name,price:null});
      chartCode=code;chartPeriod='minute';page='charts';render();requestChart();window.scrollTo(0,0);
    },
    openSector:(code,name)=>{
      if(!/^(?:BK\d{3,6}|pt\d{6,10})$/.test(code)){toast('无效行业板块代码');return;}
      page='quotes';render();
      handleTerminalClick({dataset:{action:'mt-sector',code,name}},{rerender:()=>{if(page==='quotes')render();},notify:toast});
      window.scrollTo(0,0);
    }
  });return;
 }
 if(btn.dataset.action?.startsWith('mt-')){
  handleTerminalClick(btn,{
   rerender:()=>{if(page==='quotes')render();},
   notify:toast,
   openChart:(code,details)=>{
    if(details)externalStockLookup.set(code,details);
    chartCode=code;chartPeriod='minute';page='charts';render();requestChart();window.scrollTo(0,0);
   }
  });return;
 }
 switch(btn.dataset.action){
case'dual-refresh':runDual(false);break;
case'dual-execute':runDual(true);break;
case'dual-resume':if(state.shortIntent){dualSelected.short=new Set(state.shortIntent.selected);render();}break;
case'strategy-slot':strategySlot=btn.dataset.value==='opening'?'opening':'afternoon';render();break;
case'manual-afternoon-preview':runManualAfternoon(false);break;
case'manual-afternoon-execute':runManualAfternoon(true);break;
case'account-switch':accountView=btn.dataset.value==='robot'?'robot':'manual';render();if(accountView==='robot')refreshBot(true);break;
case'settings-theme':{
 const theme=btn.dataset.value==='light'?'light':'dark';
 applyTheme(theme,{root:document.documentElement,button:document.getElementById('theme-toggle'),
 meta:document.querySelector('meta[name="theme-color"]')});
 try{localStorage.setItem(THEME_KEY,theme);}catch{}
 render();break;
}
case'open-charts':chartCode=btn.dataset.code;chartPeriod=uiPrefs.defaultChartPeriod;page='charts';render();requestChart();window.scrollTo(0,0);break;
case'open-external-chart':{const code=btn.dataset.code;chartCode=code;chartPeriod=uiPrefs.defaultChartPeriod;if(code){page='charts';render();requestChart();window.scrollTo(0,0);}break;}
case'index-select':indexKey=btn.dataset.key;render();requestIndexChart();break;
case'index-period':indexPeriod=btn.dataset.period;render();requestIndexChart();break;
case'index-refresh':refreshMarket(true);requestIndexChart(true);break;
case'rank-mode':ranked.mode=btn.dataset.mode;ranked.search='';ranked.rows=[];ranked.total=null;ranked.updatedAt=0;render();refreshRankings(true);break;
case'rank-scope':ranked.scope=btn.dataset.scope;ranked.search='';ranked.rows=[];ranked.total=null;ranked.updatedAt=0;render();refreshRankings(true);break;
case'rank-refresh':refreshRankings(true);break;case'chart-period':chartPeriod=btn.dataset.period;render();requestChart();break;case'chart-symbol':chartCode=btn.dataset.code;render();requestChart();break;case'chart-refresh':requestChart(true);break;case'quotes-refresh':refreshQuotes();break;case'refresh-bot':refreshBot(true);break;case'tail-sell':executeTailRecommendation(btn.dataset.code);break;
case'tail-refresh':refreshQuotes();break;
case'open-trade':openTrade(btn.dataset.code);break;case'open-quote':openQuote(btn.dataset.code);break;case'import':$('#import-file').click();break;case'export':exportFile();break;
case'refresh-morning':refreshMorning(true);break;
case'settings-reset-prefs':{const v=resetPrefs();if(!v){toast('存储不可用');break;}uiPrefs=v;applyUiPrefs();render();toast('已恢复默认界面设置');break;}
case'settings-clear-recent':if(confirm('清除本浏览器行情中心最近访问记录？')){clearTerminalRecent();render();toast('最近访问已清除');}break;
case'settings-clear-follows':if(confirm('清空本浏览器行情中心的关注列表？')){clearTerminalFollows();render();toast('关注列表已清空');}break;
case'reset':if(confirm('恢复到11月19日的7笔初始模拟成交？当前所有手动交易和信号修改将被清除。'))transaction(next=>{return {state:initialState(),message:'已恢复初始模拟账户'};});break;}});
 $('#export-btn').addEventListener('click',exportFile);$('#import-file').addEventListener('change',evt=>importFile(evt.target.files?.[0]));
 $('#trade-code').addEventListener('change',evt=>{$('#trade-price').value=priceInfo(evt.target.value)?.price??state.prices[evt.target.value]?.price??stock(evt.target.value).close;$('#trade-qty').value=budgetQuantity(uiPrefs.defaultBudget,Number($('#trade-price').value));updateOrderPreview();});
 ['input','change'].forEach(type=>$('#trade-form').addEventListener(type,updateOrderPreview));
 $('#trade-form').addEventListener('submit',async evt=>{evt.preventDefault();if(uiPrefs.confirmTrades&&!confirm('确认记录这笔手动模拟成交？'))return;const code=$('#trade-code').value,side=$('input[name="side"]:checked')?.value,price=Number($('#trade-price').value),quantity=Number($('#trade-qty').value);if(await transaction(next=>executeTrade(next,{code,side,price,quantity,date:shDate()})))$('#trade-dialog').close();});
 $('#quote-code').addEventListener('change',evt=>{$('#quote-price').value=state.prices[evt.target.value]?.price;});
 $('#quote-form').addEventListener('submit',async evt=>{evt.preventDefault();if(await transaction(next=>markPrice(next,$('#quote-code').value,Number($('#quote-price').value),$('#quote-date').value)))$('#quote-dialog').close();});
 document.addEventListener('input',evt=>{if(evt.target?.id==='mt-search'){terminalSearchInput(evt.target.value,()=>{if(page==='quotes')render();});return;}if(evt.target?.id==='rank-search'){ranked.search=evt.target.value.trim();const body=$('#rank-rows');if(body)body.innerHTML=renderRankingRows();const count=$('#rank-filter-count');if(count)count.textContent=ranked.search?'当前榜单内筛选':'已加载 '+ranked.rows.length+' 条';}});
 document.addEventListener('change',evt=>{
 if(evt.target?.dataset?.pref){
  const key=evt.target.dataset.pref;
  if(!Object.hasOwn(DEFAULT_PREFS,key))return;
  const next={...uiPrefs,[key]:evt.target.type==='checkbox'?evt.target.checked:evt.target.value};
  const saved=savePrefs(next);
  if(!saved){toast('浏览器存储不可用，设置未保存');render();return;}
  uiPrefs=saved;applyUiPrefs();render();
  if(uiPrefs.autoQuotes)refreshQuotes();
  if(uiPrefs.autoBotRefresh&&['models','trades','settings'].includes(page))refreshBot();
  toast('设置已保存');
  return;
 }
const sel=evt.target;if(sel.dataset.action==='chart-select'){chartCode=sel.value;render();requestChart();return;}if(sel.dataset.action==='signal'){transaction(next=>{const code=sel.dataset.code,id=sel.dataset.model,index=Number(sel.dataset.index);if(!next.signals[code])next.signals[code]={};if(!next.signals[code][id])next.signals[code][id]=MODEL_DEFINITIONS.find(m=>m.id===id).checks.map(()=>0);next.signals[code][id][index]=Number(sel.value);return {message:'模型证据状态已更新'};});}});
 if(uiPrefs.autoQuotes)refreshQuotes();
 planPoll();
 document.addEventListener('pointermove',evt=>showMinutePoint(evt.target));
 document.addEventListener('pointerdown',evt=>showMinutePoint(evt.target));
 document.addEventListener('keydown',evt=>{if(evt.target?.id==='mt-search'&&evt.key==='Enter'){evt.preventDefault();terminalSearchInput(evt.target.value,()=>{if(page==='quotes')render();},true);}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&uiPrefs.autoQuotes)refreshQuotes();});
}
async function refreshQuotes(){
 if(polling||document.hidden)return;
 polling=true;
 try{
 const symbols=[...new Set([...SECURITIES.filter(s=>!s.halted).map(s=>s.code),...positions(state).map(s=>s.code),...Object.keys(botAccount?.holdings||{}),...(botAccount?.trades||[]).filter(t=>t.date===shDate()).map(t=>t.code)])];
 const proxy=new URLSearchParams(location.search).get('proxy')||'';
 const result=await getQuotes(symbols,{proxy});
 const refreshed={...liveQuotes};
 for(const q of result.quotes){const old=refreshed[q.code];if(q.price>0&&(!old||Number.isFinite(q.time)&&(!Number.isFinite(old.time)||q.time>=old.time)))refreshed[q.code]=q;}if(result.quotes.length)lastQuoteAt=Date.now();
 liveQuotes=refreshed;quotePath=result.source;quoteError=result.errors.join('；');
 // Legacy one-off M5 opening execution retired; SHORT-v2 uses selected orders.
 if(page==='quotes'||page==='market'){
  const status=$('#market-status');if(status){const fresh=Object.values(liveQuotes).filter(q=>quoteState(q).fresh).length;status.textContent=(fresh?'行情接入 '+fresh+'只 · ':'')+quotePath+(quoteError?' · 部分源异常':'');}
 }else render();
 }catch(err){quoteError=String(err.message);render();}finally{polling=false;}
}
function planPoll(){
 const delay=session()==='open'||session()==='auction'?uiPrefs.quoteInterval:60000;
 setTimeout(()=>{
 if(!document.hidden){if(uiPrefs.autoQuotes)refreshQuotes();
  if(page==='market'&&Date.now()-marketBoard.updatedAt>35000)refreshMarket();
  if(page==='quotes')refreshTerminal(false,()=>{if(page==='quotes')render();});
  if(page==='charts'&&chartPeriod==='minute')requestChart();
  if(page==='market'&&indexPeriod==='minute')requestIndexChart();
  if(page==='radar')refreshRadar({onUpdate:()=>{if(page==='radar')render();}});
 }planPoll();},delay);
}
function renderCharts(){
 const s=stock(chartCode)||externalStockLookup.get(chartCode)||{code:chartCode,name:chartCode,close:null,referencePrice:null},
 q=priceInfo(chartCode)||externalStockLookup.get(chartCode),price=q?.price??s.close??s.referencePrice;
 const periods=[['minute','分时'],['day','日K'],['week','周K'],['month','月K']];
 const key=chartCode+':'+chartPeriod,cached=chartCache.get(key);
 const expired=cached&&(Date.now()-cached.time>(chartPeriod==='minute'?45000:1800000));
 const data=cached?.data;
 const chartPrev=data?.prevClose??(chartPeriod==='minute'?(priceInfo(chartCode)?.prevClose??externalStockLookup.get(chartCode)?.prevClose??null):null);
 const chart=data?chartSvg(data.bars,chartPeriod,chartPrev):'<div class="chart-empty">暂无走势数据，点击“刷新图表”重试。</div>';
 const first=data?.bars[0],last=data?.bars.at(-1);
 const detail=last?(chartPeriod==='minute'?'采样 '+e(last.date)+' · 现价 ¥'+last.price.toFixed(2):'周期 '+e(last.date)+' · 开 ¥'+last.open.toFixed(2)+' · 高 ¥'+last.high.toFixed(2)+' · 低 ¥'+last.low.toFixed(2)+' · 收 ¥'+last.close.toFixed(2)):'无有效行情数据';
 return heading('CHARTS',e(s.name)+' · '+e(s.code),'分时与K线走势图表','<button class="btn subtle" data-action="quotes-refresh">刷新报价</button><button class="btn primary" data-action="chart-refresh">刷新图表</button>')+
 '<section class="panel chart-panel"><div class="chart-head"><div><div class="eyebrow">最新报价</div><strong class="chart-price">'+(Number.isFinite(price)?money(price):'--')+'</strong><div class="smallnote">'+e(stock(chartCode)?latestLabel(chartCode):(q?.source?q.source+'公开行情报价':'行情中心榜单报价'))+'</div></div><select class="chart-symbol" data-action="chart-select" aria-label="切换股票">'+(stock(chartCode)?'':'<option value="'+e(chartCode)+'" selected>'+e(s.name)+' '+e(chartCode)+'</option>')+SECURITIES.map(x=>'<option value="'+x.code+'" '+(x.code===chartCode?'selected':'')+'>'+e(x.name)+' '+x.code+'</option>').join('')+'</select></div>'+
 '<div class="chart-tabs">'+periods.map(([id,label])=>'<button class="btn mini '+(chartPeriod===id?'primary':'subtle')+'" data-action="chart-period" data-period="'+id+'">'+label+'</button>').join('')+'</div>'+
 '<div class="chart-legend"><span>'+e(data?.source||'东方财富图表接口')+'</span><span>'+e(detail)+'</span><span>'+e(data?.adjustment||'原始走势')+'</span></div>'+
 '<div class="chart-canvas">'+chart+'</div><div class="chart-keys">'+(chartPeriod==='minute'?'<span class="chart-accent-primary">● 成交价</span><span class="chart-accent-secondary">● 分时均价</span><span>虚线：昨收参考</span>':'<span class="chart-accent-ma5">● MA5</span><span class="chart-accent-ma10">● MA10</span><span class="chart-accent-ma20">● MA20</span>')+'</div>'+
 (expired?'<div class="hint">当前展示历史获取的数据，图表暂未刷新。</div>':'')+
 '</section>';
}
async function requestChart(force=false){
 const key=chartCode+':'+chartPeriod,stored=chartCache.get(key),ttl=chartPeriod==='minute'?45000:1800000;
 if(!force&&stored&&Date.now()-stored.time<ttl)return;
 if(chartPending.has(key))return;
 chartPending.add(key);
 try{
  const data=await getHistory(chartCode,chartPeriod);
  chartCache.set(key,{data,time:Date.now()});
 }catch(err){toast('图表接口不可用：'+String(err.message).slice(0,75));}
 finally{chartPending.delete(key);if(page==='charts'&&key===chartCode+':'+chartPeriod)render();}
}


// Market dashboards. Data is source-backed and remains outside the paper-trading ledger.
function cnTime(ts){
 return ts?new Date(ts).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'未提供行情时间';
}

function amountShort(v){
 return typeof v==='number'&&Number.isFinite(v)&&v>=0?v>=1e8?(v/1e8).toFixed(2)+'亿':v>=1e4?(v/1e4).toFixed(1)+'万':v.toFixed(0):'--';
}

function renderMarketDashboard(){
 const b=marketBoard,reference=Object.fromEntries(b.indices.map(q=>[q.key,q]));
 const cached=indexChartCache.get(indexKey+':'+indexPeriod),data=cached?.data;
 const selected=INDEXES.find(x=>x.key===indexKey);
 const bars=data?.bars??[];
 const indexPrev=data?.prevClose??(indexPeriod==='minute'?reference[indexKey]?.prevClose??null:null);
 const sub=b.updatedAt?'数据请求于 '+cnTime(b.updatedAt)+' · 公开行情接口':'数据接口待连接';
 const indexCards=INDEXES.map(idx=>{
  const q=reference[idx.key],active=idx.key===indexKey;
  return `<button class="index-card ${active?'selected':''}" data-action="index-select" data-key="${idx.key}">
   <span class="index-name">${e(idx.name)}</span>
   <strong class="index-value">${q?q.price.toFixed(2):'--'}</strong>
   <span class="${q?cls(q.pct||0):'muted'}">${q&&q.pct!=null?`${q.change>=0?'+':''}${q.change.toFixed(2)}（${signed(q.pct)}）`:'暂缺报价'}</span>
   <small>${q?e(cnTime(q.time)):'等待返回'}</small>
  </button>`;
 }).join('');
 const breadth=b.breadth;
 const breadthHtml=breadth?`<div class="breadth-numbers"><span class="up">上涨 ${num(breadth.up)}</span><span class="down">下跌 ${num(breadth.down)}</span><span>平盘 ${num(breadth.flat)}</span></div>
  <div class="breadth-bar"><span style="width:${(breadth.up/(breadth.up+breadth.down+breadth.flat||1))*100}%;background:#f43f5e"></span><span style="width:${(breadth.down/(breadth.up+breadth.down+breadth.flat||1))*100}%;background:#10b981"></span></div><div class="smallnote">${e(breadth.source)} · 交易所统计口径</div>`:
  '<p class="smallnote">全市场涨跌统计待核验，已隐藏。</p>';
 const industries=b.sectors.slice(0,12).map((x,i)=>`<div class="sector-row"><span class="sector-num">${i+1}</span><span class="sector-name">${e(x.name)}</span><strong class="${cls(x.pct)}">${signed(x.pct)}</strong><small>${amountShort(x.turnover)}</small></div>`).join('')||'<div class="chart-empty">板块数据暂不可用</div>';
 const leaders=b.leaders.slice(0,10).map((x,i)=>`<tr><td>${i+1}</td><td><button class="rank-stock" data-action="open-external-chart" data-code="${x.code}">${e(x.name)}<small>${e(x.code)}</small></button></td><td class="${cls(x.pct)}">${signed(x.pct)}</td><td>${amountShort(x.turnover)}</td></tr>`).join('')||'<tr><td colspan="4">涨幅榜暂不可用</td></tr>';
 return heading('MARKET','大盘市场','主要指数、行业热度与市场资金方向','<button class="btn primary" data-action="index-refresh">刷新市场</button><button class="btn subtle" data-page="quotes">进入行情中心 ↗</button><button class="btn subtle" data-page="radar">市场雷达 ↗</button>')+
 `<div class="market-context">${e(sub)}${b.loading?' · 更新中':''}${b.errors.length?' · 部分数据源异常':''}</div>
 <div class="index-grid">${indexCards}</div>
 <div class="market-grid">
  <section class="panel market-chart-box">
    <div class="panel-head"><div><h2>${e(selected.name)} · 指数走势</h2><p>分时与K线走势图</p></div><span class="tag">${e(selected.key)}</span></div>
    <div class="chart-tabs">${[['minute','分时'],['day','日K'],['week','周K'],['month','月K']].map(([id,label])=>`<button class="btn mini ${id===indexPeriod?'primary':'subtle'}" data-action="index-period" data-period="${id}">${label}</button>`).join('')}</div>
    <div class="chart-legend">${data?`${e(data.source)} · ${bars.length}个真实数据点 · ${e(data.adjustment||'原始指数数据')}`:'正在获取指数图表'}</div>
    <div class="chart-canvas">${data?chartSvg(bars,indexPeriod,indexPrev):'<div class="chart-empty">指数图表暂无有效数据，点击“刷新市场”重试。</div>'}</div>
  </section>
  <section class="panel market-breadth-box">
    <div class="panel-head"><div><h2>市场温度</h2><p>全市场涨跌与覆盖</p></div></div>
    <div class="market-kpi"><div><span>排名覆盖量</span><strong>${b.total!=null?num(b.total):'--'}</strong><small>股票统计样本</small></div><div><span>板块统计</span><strong>${b.sectors.length||'--'}</strong><small>前列板块数</small></div></div>
    <hr class="divider"><h3 class="minor-title">市场涨跌家数</h3>${breadthHtml}
  </section>
 </div>
 <div class="market-grid bottom">
  <section class="panel"><div class="panel-head"><div><h2>行业涨幅榜</h2><p>按板块涨跌幅排序</p></div></div><div class="sector-list">${industries}</div></section>
  <section class="panel"><div class="panel-head"><div><h2>A股涨幅前列</h2><p>全市场领涨个股</p></div><button class="section-action" data-page="quotes">完整榜单 ↗</button></div>
   <div class="table-wrap"><table class="data-table market-leaders"><thead><tr><th>#</th><th>股票</th><th>涨跌幅</th><th>成交额</th></tr></thead><tbody>${leaders}</tbody></table></div>
  </section>
 </div>`+
 (b.errors.length?`<div class="hint">数据异常：${e(b.errors.join('；'))}。</div>`:'');
}

function renderRankingRows(){
 const word=ranked.search.trim().toLowerCase();
 const matches=ranked.rows.filter(row=>!word||row.code.includes(word)||row.name.toLowerCase().includes(word));
 if(!matches.length){
  const exact=/^[036]\d{5}$/.test(word);
  return `<tr><td colspan="7" class="empty">${ranked.loading?'正在加载行情':'当前已加载榜单没有匹配项'}${exact?`<button class="btn mini subtle" data-action="open-external-chart" data-code="${e(word)}">按代码 ${e(word)} 查看图表</button>`:''}</td></tr>`;
 }
 return matches.map((x,i)=>{
  const prev=x.prevClose?x.prevClose.toFixed(2):'--';
  return `<tr><td>${i+1}</td>
   <td><button class="rank-stock" data-action="open-external-chart" data-code="${e(x.code)}">${e(x.name)}<small>${e(x.code)} · ${e(x.exchange)}</small></button></td>
   <td class="quote-price">${x.price.toFixed(2)}</td>
   <td class="${cls(x.pct)}"><strong>${signed(x.pct)}</strong></td>
   <td>${amountShort(x.turnover)}</td><td>${x.volume!=null?amountShort(x.volume)+'手':'--'}</td>
   <td><button class="btn mini subtle" data-action="open-external-chart" data-code="${e(x.code)}">走势图</button></td></tr>`;
 }).join('');
}

function renderQuotesCenter(){
 const sort=RANK_MODES[ranked.mode],scope=SCOPES[ranked.scope];
 const source=ranked.updatedAt?'最近接口查询：'+cnTime(ranked.updatedAt)+' · 来源东方财富（行情时点可能不同步）':'行情榜单尚未加载';
 return heading('MARKET / QUOTES','行情中心','沪深A股涨跌幅、成交额与成交量排行；支持市场筛选与榜单内搜索。','<button class="btn primary" data-action="rank-refresh">刷新排行</button><button class="btn subtle" data-page="market">大盘市场 ↗</button>')+
 `<div class="rank-controls"><div class="rank-segment">${Object.entries(RANK_MODES).map(([id,v])=>`<button data-action="rank-mode" data-mode="${id}" class="btn mini ${id===ranked.mode?'primary':'subtle'}">${e(v.label)}</button>`).join('')}</div>
 <div class="rank-scope">${Object.entries(SCOPES).map(([id,v])=>`<button data-action="rank-scope" data-scope="${id}" class="btn mini ${id===ranked.scope?'primary':'subtle'}">${e(v.label)}</button>`).join('')}</div></div>
 <section class="panel"><div class="panel-head rank-summary"><div><h2>${e(scope.label)} · ${e(sort.label)}</h2><p>${e(source)}</p></div>
 <div><span class="count">${ranked.total!=null?'覆盖 '+num(ranked.total)+' 只':'覆盖量待核'}</span> <span class="count" id="rank-filter-count">${ranked.search?'当前榜单内筛选':'已加载 '+ranked.rows.length+' 条'}</span></div></div>
 <div class="rank-search"><input id="rank-search" type="search" value="${e(ranked.search)}" placeholder="在本页榜单筛选股票名称或代码" aria-label="搜索已加载榜单股票" autocomplete="off"/><p class="smallnote">搜索仅在当前已加载的前${ranked.rows.length}条榜单中查找；输入6位A股代码可以单独打开该股票图表。</p></div>
 <div class="table-wrap"><table class="data-table rank-table"><thead><tr><th>#</th><th>证券</th><th>最新价（元）</th><th>涨跌幅</th><th>成交额</th><th>成交量</th><th>操作</th></tr></thead><tbody id="rank-rows">${renderRankingRows()}</tbody></table></div>
 <div class="hint">榜单为第三方接口公开数据，不承诺行情实时性。请求完成时间不等于交易所更新时间。行内股票点击后可查看分时、日K、周K、月K；模拟交易仍仅限原有8只观察股。</div></section>`+
 (ranked.error?`<div class="hint">榜单接口失败：${e(ranked.error)}。页面可能保留上次成功的榜单数据。</div>`:'');
}

function refreshMarket(force=false){
 if(marketBoard.loading)return;
 if(!force&&marketBoard.updatedAt&&Date.now()-marketBoard.updatedAt<35000)return;
 marketBoard.loading=true;
 const requests=[getMarketIndices(),getSectors(),getRankings('gainers','all',{size:30}),getMarketBreadth()];
 return Promise.allSettled(requests).then(async results=>{
  const errors=[];
  if(results[0].status==='fulfilled')marketBoard.indices=results[0].value;else errors.push('指数：'+results[0].reason.message);
  if(results[1].status==='fulfilled')marketBoard.sectors=results[1].value.rows;
  else{
   let rescued=false;
   try{const snap=await getRadarSnapshot();const rows=snap?.feeds?.sectors?.rows;if(rows?.length){marketBoard.sectors=[...rows].sort((a,b)=>b.pct-a.pct);rescued=true;}}catch{}
   if(!rescued)errors.push('行业：'+results[1].reason.message);
  }
  if(results[2].status==='fulfilled'){
   marketBoard.leaders=results[2].value.rows;
   marketBoard.total=results[2].value.total;
   for(const q of marketBoard.leaders)externalStockLookup.set(q.code,q);
  }else errors.push('涨幅榜：'+results[2].reason.message);
  if(results[3].status==='fulfilled')marketBoard.breadth=results[3].value;else marketBoard.breadth=null;
  marketBoard.errors=errors;marketBoard.updatedAt=Date.now();
 }).finally(()=>{marketBoard.loading=false;if(page==='market')render();});
}

function refreshRankings(force=false){
 if(ranked.loading&&!force)return;
 if(!force&&ranked.updatedAt&&Date.now()-ranked.updatedAt<45000)return;
 const seq=++rankFetchSeq;
 ranked.loading=true;const mode=ranked.mode,scope=ranked.scope;
 return getRankings(mode,scope,{size:50}).then(result=>{
  if(seq!==rankFetchSeq||ranked.mode!==mode||ranked.scope!==scope)return;
  ranked.rows=result.rows;ranked.total=result.total;ranked.updatedAt=Date.now();ranked.error='';
  for(const q of result.rows)externalStockLookup.set(q.code,q);
 }).catch(err=>{
  if(seq===rankFetchSeq&&ranked.mode===mode&&ranked.scope===scope){ranked.error=String(err.message);ranked.updatedAt=Date.now();}
 }).finally(()=>{
  if(seq!==rankFetchSeq)return;
  ranked.loading=false;if(page==='quotes')render();
 });
}
function requestIndexChart(force=false){
 const key=indexKey+':'+indexPeriod,previous=indexChartCache.get(key),ttl=indexPeriod==='minute'?45000:1800000;
 if(!force&&previous&&Date.now()-previous.time<ttl)return;
 if(pendingIndexCharts.has(key))return;
 pendingIndexCharts.add(key);
 return getIndexHistory(indexKey,indexPeriod).then(data=>{
  indexChartCache.set(key,{time:Date.now(),data});
 }).catch(err=>{if(key===indexKey+':'+indexPeriod)toast('指数图表：'+String(err.message).slice(0,80));})
 .finally(()=>{pendingIndexCharts.delete(key);if(page==='market'&&key===indexKey+':'+indexPeriod)render();});
}
bootstrap();
