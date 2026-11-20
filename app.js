import {SECURITIES, MODEL_DEFINITIONS, SNAPSHOT_DATE, BUDGET_PER_STOCK} from './seed.js';
import {STORAGE_KEY, initialState, cloneState, portfolio, positions, executeTrade, markPrice, budgetQuantity, fees, feeTotal, modelEvidence, validateState, shDate} from './engine.js';
import {getQuotes,getHistory,quoteState,session,POLL_MS} from './market.js';
import {chartSvg} from './charts.js';
let state;let page='overview';let liveQuotes={};let quoteError='';let quotePath='历史快照';
let chartCode='601133',chartPeriod='minute';const chartCache=new Map();const chartPending=new Set();let polling=false;
function displayState(){
 const prices={...state.prices};
 for(const [code,q] of Object.entries(liveQuotes)){if(q?.price>0)prices[code]={price:q.price,date:q.time?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(q.time)):shDate(),source:q.source};}
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
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stock=code=>SECURITIES.find(x=>x.code===code);
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(window.__notice);window.__notice=setTimeout(()=>el.classList.remove('visible'),3600);}
function load(){try{const v=JSON.parse(localStorage.getItem(STORAGE_KEY));if(v&&validateState(v))return v;}catch{}return initialState();}
function persist(next){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));return true;}catch{return false;}}
function transaction(updater){const next=cloneState(state);const result=updater(next);if(result?.ok===false){toast(result.error);return false;}if(!validateState(next)){toast('账本校验失败，未保存');return false;}if(!persist(next)){toast('浏览器存储不可用，修改已撤回');return false;}state=next;render();toast(result?.message||'已保存到本地浏览器');return true;}
const titleMap={overview:'资产总览',watchlist:'观察列表',models:'策略模型',trades:'成交流水',charts:'行情图表'};
function render(){
 document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 $('#page-heading').textContent=titleMap[page];
 $('#main').innerHTML=({overview:renderOverview,watchlist:renderWatchlist,models:renderModels,trades:renderTrades,charts:renderCharts}[page])();
 const status=$('#market-status');if(status){
 const count=Object.values(liveQuotes).filter(q=>quoteState(q).fresh).length;
 status.textContent=(count?'行情接入 '+count+'只 · ':'')+quotePath+(quoteError?' · 部分源异常':'');
 status.title=quoteError||'报价带时间戳；非交易所授权实时行情';
 }
}
function heading(kicker,title,sub,actions=''){return `<div class="hero"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p class="subheading">${sub}</p></div><div class="action-row">${actions}</div></div>`;}
function stat(label,value,sub,special=false,style=''){return `<div class="stat ${special?'special':''}"><div class="stat-label">${label}<span>${special?'●':''}</span></div><div class="stat-number ${style}">${value}</div><div class="stat-sub">${sub}</div></div>`;}
function compactTable(limit=20){const p=portfolio(displayState());return `<div class="table-wrap"><table class="data-table"><thead><tr><th>证券</th><th>持仓股数</th><th>摊薄成本</th><th>参考价</th><th>市值</th><th>浮动盈亏</th></tr></thead><tbody>${p.holds.slice(0,limit).map(h=>`<tr><td><button class="section-action name" data-action="open-charts" data-code="${e(h.code)}">${e(h.name)} ↗</button><small>${e(h.code)}</small></td><td>${num(h.quantity)}</td><td>¥${h.avgCost.toFixed(3)}</td><td>¥${h.quote.toFixed(2)}</td><td>${money(h.value)}</td><td class="${cls(h.unrealized)}">${money(h.unrealized)}</td></tr>`).join('')}</tbody></table></div>`;}
function allocation(){const p=portfolio(displayState()),palette=['#d8b070','#c7786e','#64a8b8','#a39bcb','#a6bc80','#d18dbe','#7395ad'];const parts=p.holds.map((h,i)=>({...h,share:h.value/p.total*100,color:palette[i%palette.length]}));return `<div class="allocation" aria-label="资产配置条"><span style="width:${p.cash/p.total*100}%;background:#566c80" title="现金"></span>${parts.map(h=>`<span style="width:${h.share}%;background:${h.color}" title="${e(h.name)} ${h.share.toFixed(1)}%"></span>`).join('')}</div><div class="legend"><div><i style="background:#566c80"></i><label>剩余现金</label><b>${(p.cash/p.total*100).toFixed(1)}%</b></div>${parts.map(h=>`<div><i style="background:${h.color}"></i><label>${e(h.name)}</label><b>${h.share.toFixed(1)}%</b></div>`).join('')}</div>`;}
function renderOverview(){const p=portfolio(displayState()),totalSeed=state.trades.filter(t=>t.seed&&t.side==='BUY').length;
return `${heading('PAPER TRADING / OVERVIEW','市场观察，先从模拟开始。','11月19日按收盘价模拟建仓；当前持仓估值随可用报价刷新，不接入真实券商。','<button class="btn primary" data-action="open-trade">＋ 模拟下单</button><button class="btn subtle" data-page="watchlist">查看观察列表 ↗</button>')}
<div class="summary-grid">${stat('模拟总资产',money(p.total),'账户本金 '+money(state.initialCash),true)}${stat('股票持仓市值',money(p.marketValue),`${p.holds.length} 只股票 · 估值取最新可用报价`)}${stat('可用现金',money(p.cash),`英力特保留预算 ${money(BUDGET_PER_STOCK)}`)}${stat('累计模拟收益',money(p.profit),`收益率 ${signed(p.profitRate)} · 已计入交易费`,false,cls(p.profit))}</div>
<div class="grid-main"><section class="panel"><div class="panel-head"><div><h2>我的持仓</h2><p>成本含模拟买入佣金与过户费</p></div><button class="section-action" data-page="trades">全部成交 ↗</button></div>${compactTable()}<div class="hint"><strong>初始化已执行 ${totalSeed} 笔买入。</strong>每只设定10万元预算，按100股整数手成交，费用和零股余款留在现金中。英力特停牌，未模拟成交。重新打开页面不会重复买入。</div></section>
<section class="panel"><div class="panel-head"><div><h2>当前资产配置</h2><p>按当前可用报价估值；不是历史收益曲线</p></div></div>${allocation()}<hr class="divider"><div class="panel-head"><div><h2>模型工作流</h2><p>五套可复核的信号清单</p></div></div>${MODEL_DEFINITIONS.map(m=>`<div class="model-applied"><span class="tag">${m.id}</span><label>${m.type}</label><button class="section-action" data-page="models">查看 ↗</button></div>`).join('')}</section></div>`;}
function renderWatchlist(){const p=portfolio(displayState());return `${heading('RESEARCH / WATCHLIST','观察列表','8只候选股 · 盘中行情自动请求 · 报价显示数据源和时间 · 停牌股票不自动成交。','<button class="btn primary" data-action="open-trade">＋ 模拟下单</button><button class="btn subtle" data-action="open-quote">手动更新价格</button>')}
<section class="panel"><div class="panel-head"><div><h2>行情观察板</h2><p>所有来源可点击核验 · 不是自动选股结果</p></div><span class="count">${SECURITIES.length} / ${SECURITIES.length}</span></div><div class="watchcards">${SECURITIES.map(s=>{const q=displayState().prices[s.code],h=p.holds.find(x=>x.code===s.code),v=q?.price;return `<article class="watchcard"><div style="display:flex;justify-content:space-between;gap:12px"><div><h3>${e(s.name)}</h3><span class="code">${e(s.code)} · ${e(s.market)}</span></div><span class="tag ${s.halted?'warn':'success'}">${s.halted?'种子停牌':'行情观察'}</span></div><div class="watchcard-price">${s.halted?'—':money(v)}</div><div class="${cls(s.pct)}" style="font-size:12px;font-weight:700">${s.halted?'11月19日无成交':priceInfo(s.code)?.pct!=null?signed(priceInfo(s.code).pct)+' · 对前收':signed(s.pct)+' · 11/19 涨跌'}</div><p>${e(s.note)}</p><div>${s.models.map(m=>`<span class="tag">${m}</span>`).join('')}${s.tags.map(t=>`<span class="tag">${e(t)}</span>`).join('')}</div><div class="signal-summary">${s.halted?`停牌前参考价 ${money(s.referencePrice)}（${s.referenceDate}，仅参考）`:h?`持仓 ${num(h.quantity)} 股 · 浮盈亏 ${money(h.unrealized)} · ${e(latestLabel(s.code))}`:'未持仓'}</div><div style="display:flex;gap:8px;margin-top:16px;align-items:center"><button class="btn mini" data-action="open-charts" data-code="${s.code}">分时 / K线</button><button class="btn mini" data-action="open-trade" data-code="${s.code}" ${s.halted?'disabled':''}>模拟交易</button><button class="btn mini subtle" data-action="open-quote" data-code="${s.code}" ${s.halted?'disabled':''}>更新参考价</button><a class="source-link" href="${e(s.source)}" target="_blank" rel="noopener noreferrer">数据来源 ↗</a></div></article>`;}).join('')}</div></section>`;}
function renderModels(){return `${heading('STRATEGY / LAB','五套牛股启动模型','模型是可维护的规则和证据，不代表已回测的胜率。每项证据可切换「确认 / 待核 / 不符合」。')}
<div class="account-notes">规则采用可解释的核验清单，而不是用过去上涨的股票事后拟合“成功概率”。当前信号为11月19日公开事件初筛；价格突破、均量等须另行获取日线数据验证。</div>
<div class="model-grid">${MODEL_DEFINITIONS.map(m=>{const applied=SECURITIES.filter(s=>s.models.includes(m.id));return `<article class="model-card"><span class="model-no">MODEL / ${m.id}</span><h3>${m.name}</h3><div class="model-type">${m.type}</div><p>${m.description}</p><ul class="checklist">${m.checks.map((check,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span>${check}</li>`).join('')}</ul><div class="risk">风险：${m.risk}</div><div class="model-applications"><div class="panel-head"><div><h2>观察股证据核验</h2><p>修改结果仅保存在当前浏览器</p></div></div>${applied.map(s=>{const info=modelEvidence(state,s.code,m.id);return `<div class="model-applied"><span class="tag">${e(s.name)}</span><small>${info.confirmed}/${info.total} 确认${info.contradicted?' · 存在反证':''}</small>${m.checks.map((c,i)=>`<div class="signal-row"><label title="${e(c)}">${i+1}. ${e(c)}</label><select aria-label="${e(s.name)} ${e(c)}" data-action="signal" data-code="${s.code}" data-model="${m.id}" data-index="${i}"><option value="0" ${info.flags[i]===0?'selected':''}>待核</option><option value="1" ${info.flags[i]===1?'selected':''}>确认</option><option value="-1" ${info.flags[i]===-1?'selected':''}>不符合</option></select></div>`).join('')}</div>`;}).join('')}</div></article>`;}).join('')}</div>`;}
function renderTrades(){return `${heading('LEDGER / EXECUTIONS','成交记录','虚拟成交明细，可导出审计；不与真实券商、交易所或行情供应商连接。','<button class="btn primary" data-action="open-trade">＋ 模拟下单</button><button class="btn subtle" data-action="import">导入备份</button><button class="btn subtle" data-action="reset">恢复初始盘</button>')}
<section class="panel"><div class="panel-head"><div><h2>交易流水</h2><p>所有模拟交易按发生顺序保留 · T+1保守校验</p></div><span class="count">${state.trades.length} 笔</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>单号 / 日期</th><th>证券</th><th>方向</th><th>数量</th><th>成交价</th><th>成交金额</th><th>费用</th><th>说明</th></tr></thead><tbody>${[...state.trades].reverse().map(t=>`<tr><td>${e(t.id)}<small>${e(t.date)}</small></td><td class="name">${e(stock(t.code).name)}<small>${e(t.code)}</small></td><td class="${t.side==='BUY'?'up':'down'}">${t.side==='BUY'?'买入':'卖出'}</td><td>${num(t.quantity)}</td><td>¥${t.price.toFixed(2)}</td><td>${money(t.gross)}</td><td>${money(t.fee)}</td><td>${t.seed?'<span class="tag">历史快照初始化</span>':'<span class="tag">手动模拟成交</span>'}</td></tr>`).join('')}</tbody></table></div><div class="hint">模拟费率：佣金万分之2.5（每笔最低5元），过户费十万分之一（买卖双向），卖出印花税万分之五。仅是教学参数，实际各券商和交易规则可能不同。</div></section>`;}
function openTrade(code){const dialog=$('#trade-dialog'),sel=$('#trade-code');sel.innerHTML=SECURITIES.filter(s=>!s.halted).map(s=>`<option value="${s.code}">${s.name} ${s.code}</option>`).join('');sel.value=code&&!stock(code).halted?code:SECURITIES[0].code;$('#trade-form').reset();sel.value=code&&!stock(code).halted?code:SECURITIES[0].code;const s=stock(sel.value);$('#trade-price').value=priceInfo(s.code)?.price??state.prices[s.code]?.price??s.close;$('#trade-qty').value=budgetQuantity(BUDGET_PER_STOCK,Number($('#trade-price').value));updateOrderPreview();dialog.showModal();}
function updateOrderPreview(){const p=Number($('#trade-price').value),q=Number($('#trade-qty').value),side=$('input[name="side"]:checked')?.value??'BUY';if(!Number.isFinite(p)||p<=0||!Number.isInteger(q)||q<=0){$('#order-preview').textContent='输入有效价格与股数以预览';return;}const gross=p*q,fee=feeTotal(fees(side,gross));$('#order-preview').textContent=`成交金额 ${money(gross)} · 费用约 ${money(fee)} · ${side==='BUY'?'所需资金':'预计到账'} ${money(side==='BUY'?gross+fee:gross-fee)}`;}
function openQuote(code){const sel=$('#quote-code');sel.innerHTML=SECURITIES.filter(s=>!s.halted).map(s=>`<option value="${s.code}">${s.name} ${s.code}</option>`).join('');sel.value=code&&!stock(code).halted?code:SECURITIES[0].code;$('#quote-price').value=state.prices[sel.value]?.price;$('#quote-date').value=shDate();$('#quote-dialog').showModal();}
function exportFile(){const raw=JSON.stringify({exportedAt:new Date().toISOString(),kind:'stock-market-paper-v1',state},null,2);const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='stock-market-paper-'+shDate()+'.json';a.click();URL.revokeObjectURL(url);toast('账本已导出（仅本地文件）');}
async function importFile(file){if(!file)return;try{if(file.size>3_000_000)throw Error('文件过大');const data=JSON.parse(await file.text());if(data.kind!=='stock-market-paper-v1'||!validateState(data.state))throw Error('账本不合法或版本不兼容');if(!confirm('导入将覆盖当前浏览器账本，是否继续？'))return;if(!persist(data.state))throw Error('本地存储不可用');state=data.state;render();toast('已导入模拟账本');}catch(err){toast('导入失败：'+err.message);}$('#import-file').value='';}
function bootstrap(){state=load();render();try{if(!localStorage.getItem(STORAGE_KEY))persist(state);}catch{toast('当前浏览器禁止持久化存储，修改可能丢失');}
 document.addEventListener('click',evt=>{const btn=evt.target.closest('button');if(!btn)return;if(btn.dataset.page){page=btn.dataset.page;render();if(page==='charts')requestChart();window.scrollTo(0,0);return;}if(btn.dataset.close){$('#'+btn.dataset.close).close();return;}switch(btn.dataset.action){case'open-charts':chartCode=btn.dataset.code;chartPeriod='minute';page='charts';render();requestChart();window.scrollTo(0,0);break;case'chart-period':chartPeriod=btn.dataset.period;render();requestChart();break;case'chart-symbol':chartCode=btn.dataset.code;render();requestChart();break;case'chart-refresh':requestChart(true);break;case'quotes-refresh':refreshQuotes();break;case'open-trade':openTrade(btn.dataset.code);break;case'open-quote':openQuote(btn.dataset.code);break;case'import':$('#import-file').click();break;case'reset':if(confirm('恢复到11月19日的7笔初始模拟成交？当前所有手动交易和信号修改将被清除。'))transaction(next=>{Object.assign(next,initialState());return {message:'已恢复初始模拟账户'};});break;}});
 $('#export-btn').addEventListener('click',exportFile);$('#import-file').addEventListener('change',evt=>importFile(evt.target.files?.[0]));
 $('#trade-code').addEventListener('change',evt=>{$('#trade-price').value=priceInfo(evt.target.value)?.price??state.prices[evt.target.value]?.price??stock(evt.target.value).close;$('#trade-qty').value=budgetQuantity(BUDGET_PER_STOCK,Number($('#trade-price').value));updateOrderPreview();});
 ['input','change'].forEach(type=>$('#trade-form').addEventListener(type,updateOrderPreview));
 $('#trade-form').addEventListener('submit',evt=>{evt.preventDefault();const code=$('#trade-code').value,side=$('input[name="side"]:checked')?.value,price=Number($('#trade-price').value),quantity=Number($('#trade-qty').value);if(transaction(next=>executeTrade(next,{code,side,price,quantity,date:shDate()})))$('#trade-dialog').close();});
 $('#quote-code').addEventListener('change',evt=>{$('#quote-price').value=state.prices[evt.target.value]?.price;});
 $('#quote-form').addEventListener('submit',evt=>{evt.preventDefault();if(transaction(next=>markPrice(next,$('#quote-code').value,Number($('#quote-price').value),$('#quote-date').value)))$('#quote-dialog').close();});
 document.addEventListener('change',evt=>{const sel=evt.target;if(sel.dataset.action==='chart-select'){chartCode=sel.value;render();requestChart();return;}if(sel.dataset.action==='signal'){transaction(next=>{const code=sel.dataset.code,id=sel.dataset.model,index=Number(sel.dataset.index);if(!next.signals[code])next.signals[code]={};if(!next.signals[code][id])next.signals[code][id]=MODEL_DEFINITIONS.find(m=>m.id===id).checks.map(()=>0);next.signals[code][id][index]=Number(sel.value);return {message:'模型证据状态已更新'};});}});
 refreshQuotes();
 planPoll();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshQuotes();});
}
async function refreshQuotes(){
 if(polling||document.hidden)return;
 polling=true;
 try{
 const symbols=SECURITIES.filter(s=>!s.halted).map(s=>s.code);
 const proxy=new URLSearchParams(location.search).get('proxy')||'';
 const result=await getQuotes(symbols,{proxy});
 const refreshed={...liveQuotes};
 for(const q of result.quotes){if(q.price>0)refreshed[q.code]=q;}
 liveQuotes=refreshed;quotePath=result.source;quoteError=result.errors.join('；');
 render();
 }catch(err){quoteError=String(err.message);render();}finally{polling=false;}
}
function planPoll(){
 const delay=session()==='open'||session()==='auction'?POLL_MS:60000;
 setTimeout(()=>{if(!document.hidden)refreshQuotes();planPoll();},delay);
}
function renderCharts(){
 const s=stock(chartCode),q=priceInfo(chartCode),price=q?.price??s.close??s.referencePrice;
 const periods=[['minute','分时'],['day','日K'],['week','周K'],['month','月K']];
 const key=chartCode+':'+chartPeriod,cached=chartCache.get(key);
 const expired=cached&&(Date.now()-cached.time>(chartPeriod==='minute'?45000:1800000));
 const data=cached?.data;
 const chart=data?chartSvg(data.bars,chartPeriod,data.prevClose):'<div class="chart-empty">尚未获取到真实走势数据。点击“刷新图表”重试。</div>';
 const first=data?.bars[0],last=data?.bars.at(-1);
 const detail=last?(chartPeriod==='minute'?'最新采样 '+e(last.date)+' · 价格 ¥'+last.price.toFixed(2):'最近周期 '+e(last.date)+' · 开 ¥'+last.open.toFixed(2)+' · 高 ¥'+last.high.toFixed(2)+' · 低 ¥'+last.low.toFixed(2)+' · 收 ¥'+last.close.toFixed(2)):'无有效行情数据';
 return heading('MARKET DATA / CHARTS',e(s.name)+' · '+e(s.code),'真实数据驱动的走势展示，行情源及时间会显示；不是交易所许可的专业行情。','<button class="btn subtle" data-action="quotes-refresh">刷新报价</button><button class="btn primary" data-action="chart-refresh">刷新图表</button>')+
 '<section class="panel chart-panel"><div class="chart-head"><div><div class="eyebrow">最新可用报价</div><strong class="chart-price">'+(Number.isFinite(price)?money(price):'--')+'</strong><div class="smallnote">'+e(latestLabel(chartCode))+'</div></div><select class="chart-symbol" data-action="chart-select" aria-label="切换股票">'+SECURITIES.map(x=>'<option value="'+x.code+'" '+(x.code===chartCode?'selected':'')+'>'+e(x.name)+' '+x.code+'</option>').join('')+'</select></div>'+
 '<div class="chart-tabs">'+periods.map(([id,label])=>'<button class="btn mini '+(chartPeriod===id?'primary':'subtle')+'" data-action="chart-period" data-period="'+id+'">'+label+'</button>').join('')+'</div>'+
 '<div class="chart-legend"><span>'+e(data?.source||'待连接东方财富图表接口')+'</span><span>'+e(detail)+'</span><span>'+e(data?.adjustment||'分时原始价')+'</span></div>'+
 '<div class="chart-canvas">'+chart+'</div><div class="chart-keys">'+(chartPeriod==='minute'?'<span style="color:#e5b86f">● 成交价</span><span style="color:#6ba6d3">● 分时均价</span><span>虚线：昨收参考</span>':'<span style="color:#f2c875">● MA5</span><span style="color:#75aee3">● MA10</span><span style="color:#ba91d6">● MA20</span>')+'</div>'+
 (expired?'<div class="hint">当前展示的是此前成功获取的数据；图表暂未刷新。</div>':'')+
 '<div class="hint">价格源非交易所授权API，可能存在网络延迟、交易时段差异和限流。分时图是行情接口的真实分钟数据，非本地模拟；盘中交易按手动输入价记账，不声称能够以显示价格成交。</div></section>';
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
bootstrap();
