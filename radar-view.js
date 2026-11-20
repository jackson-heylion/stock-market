
import {getLiveSectors,getLiveNews,getLiveChanges,getNewsTerms,treemapLayout} from './market-radar.js';
export const radarState={
 sectors:{rows:[],updatedAt:0,checkedAt:0,source:'',error:'',loading:false},
 news:{rows:[],updatedAt:0,checkedAt:0,source:'',error:'',loading:false},
 changes:{rows:[],updatedAt:0,checkedAt:0,source:'',error:'',loading:false},
 filter:'all',selectedWord:''
};
export function h(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

export function radarShort(v){
 if(!Number.isFinite(v))return '--';
 if(v>=1e8)return (v/1e8).toFixed(2)+'亿';
 if(v>=1e4)return (v/1e4).toFixed(1)+'万';
 return v.toFixed(0);
}

export function radarClock(ts){
 if(!Number.isFinite(ts))return '--';
 return new Date(ts).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
}

export function radarSourceStatus(key){
 const s=radarState[key];
 if(s.loading)return '获取中…';
 if(s.error)return (s.updatedAt?'源异常 · 沿用'+radarClock(s.updatedAt)+'成功快照':'源异常 · 无有效快照')+' · '+h(s.error.slice(0,38));
 if(s.updatedAt)return '请求于 '+radarClock(s.updatedAt);
 return '尚未加载';
}

export function heatmapHtml(rows){
 if(!rows.length)return '<div class="radar-empty">板块数据尚未获取，无法生成真实热度图。</div>';
 const nodes=treemapLayout(rows,100,100);
 return '<div class="radar-treemap" role="group" aria-label="按板块成交额分配面积，颜色代表涨跌幅">'+
  nodes.map(x=>{
   const intensity=Math.min(85,Math.max(12,12+Math.abs(x.pct)*12));
   const up=x.pct>=0,prec=x.pct>0?'+':'';
   const detail=x.w>14&&x.h>13;
   const visible=x.w>9&&x.h>8;
   const style=`left:${x.x.toFixed(4)}%;top:${x.y.toFixed(4)}%;width:${x.w.toFixed(4)}%;height:${x.h.toFixed(4)}%;--heat-intensity:${intensity.toFixed(1)}%;--heat-active:var(${up?'--radar-up':'--radar-down'});`;
   return `<button class="radar-heat-cell" style="${style}" data-action="radar-sector" data-code="${h(x.code)}" data-name="${h(x.name)}" title="${h(x.name)}：${x.pct>0?'+':''}${x.pct.toFixed(2)}%，成交额${radarShort(x.turnover)}">
      ${visible?`<span class="radar-heat-name">${h(x.name)}</span><strong>${prec}${x.pct.toFixed(2)}%</strong>`:'<span class="sr-only">'+h(x.name)+'</span>'}
      ${detail?`<small>${radarShort(x.turnover)}</small>`:''}
   </button>`;
  }).join('')+'</div>';
}

export function wordCloudHtml(news){
 const terms=getNewsTerms(news,{now:Date.now(),maxAgeMs:2*3600000,limit:32});
 if(!terms.length)return '<div class="radar-empty">近2小时内没有足够的真实新闻标题，暂不生成词云。</div>';
 const max=Math.max(1,...terms.map(x=>x.count)),min=Math.min(...terms.map(x=>x.count));
 return '<div class="radar-cloud" aria-label="最近2小时东方财富7×24新闻标题词频">'+
  terms.map((x,i)=>{
   const scale=(x.count-min)/Math.max(1,max-min);
   const size=(14+scale*20).toFixed(1),tone=i%3,active=radarState.selectedWord===x.word;
   return `<button class="radar-word ${active?'active':''}" data-action="radar-word" data-word="${h(x.word)}"
     style="font-size:${size}px;--word-weight:${scale.toFixed(3)}" title="标题提及 ${x.count} 次，点击查看相关新闻"><span>${h(x.word)}</span><small>${x.count}</small></button>`;
  }).join('')+'</div>';
}

export function newsListHtml(news){
 const word=radarState.selectedWord;
 const selected=word?news.filter(x=>x.title.includes(word)):news;
 const rows=selected.slice(0,9);
 if(!rows.length)return `<p class="radar-empty">${word?'当前新闻标题没有包含该词的记录':'暂无可用的真实快讯'}</p>`;
 return '<div class="radar-news-list">'+rows.map((x,i)=>
  `<article class="radar-news-line"><time>${radarClock(x.time)}</time><span>${h(x.title)}</span></article>`
 ).join('')+'</div>';
}

export function anomaliesHtml(){
 const types=radarState.filter;
 const items=radarState.changes.rows.filter(x=>types==='all'||x.category===types).slice(0,45);
 if(!items.length)return '<div class="radar-empty">当前过滤条件下没有真实异动记录。</div>';
 return `<div class="radar-anomalies"><div class="radar-events-head"><span>时间</span><span>股票</span><span>异动事件</span><span>原始参数</span></div>`+
  items.map(x=>`<div class="radar-event">
    <time>${h(x.time)}</time>
    <button data-action="radar-stock" data-code="${h(x.code)}" data-name="${h(x.name)}" title="打开${h(x.name)}走势图">${h(x.name)}<small>${h(x.code)}</small></button>
    <span class="radar-event-type ${x.category}">${h(x.label)}</span>
    <small class="radar-raw" title="接口原始附加参数（未解释含义）">${h(x.info||'--')}</small>
   </div>`).join('')+'</div>';
}

export function renderRadar(){
 const sectors=radarState.sectors.rows,news=radarState.news.rows,changes=radarState.changes.rows;
 const positive=sectors.filter(x=>x.pct>0).length,negative=sectors.filter(x=>x.pct<0).length;
 const headline=news[0],strongest=sectors.reduce((v,x)=>!v||x.pct>v.pct?x:v,null);
 const latest=changes[0],selWord=radarState.selectedWord;
 const press=(key,label)=>`<button class="btn mini subtle" data-action="radar-refresh" data-source="${key}">${label}</button>`;
 const stats=`<div class="radar-summary">
  <div><span>板块样本</span><strong>${sectors.length||'--'}</strong><small>按成交额选取前36</small></div>
  <div><span>板块涨 / 跌</span><strong class="radar-dual"><span class="up">${positive}</span> / <span class="down">${negative}</span></strong><small>仅限图中样本</small></div>
  <div><span>最新快讯</span><strong>${headline?radarClock(headline.time):'--'}</strong><small>${news.length}条真实标题</small></div>
  <div><span>异动记录</span><strong>${changes.length||'--'}</strong><small>接口最近一页 · 非全日合计</small></div>
 </div>`;
 return `<div class="radar-root">
  <div class="hero"><div><div class="eyebrow">MARKET / SIGNAL RADAR</div><h1>市场雷达</h1>
    <p class="subheading">板块热度、财经快讯词频、盘口异动，均来自可核验的公开接口。自动定时刷新，停盘后显示最后一次有效数据。</p></div>
    <div class="action-row"><button class="btn primary" data-action="radar-refresh" data-source="all">刷新所有数据</button><button class="btn subtle" data-page="quotes">行情中心 ↗</button></div>
  </div>
  ${stats}
  <section class="panel radar-panel">
   <div class="panel-head"><div><h2>行业板块热度图</h2><p>板块涨跌幅决定颜色，成交额决定面积（小板块保留最低可读面积）。选择板块可进入行情中心。</p></div>
   <div class="radar-panel-actions"><span class="radar-status">${radarSourceStatus('sectors')}</span>${press('sectors','刷新板块')}</div></div>
   <div class="radar-legend"><span class="radar-legend-up">上涨板块 ${positive}</span><span class="radar-legend-down">下跌板块 ${negative}</span><span>数据源：东方财富行业板块，按成交额前36</span></div>
   ${heatmapHtml(sectors)}
  </section>
  <div class="radar-columns">
    <section class="panel radar-panel">
     <div class="panel-head"><div><h2>财经舆情词云</h2><p>最近2小时内的真实7×24快讯标题提及次数，不代表社交平台热度或看多看空评分。</p></div>
     <div class="radar-panel-actions"><span class="radar-status">${radarSourceStatus('news')}</span>${press('news','刷新快讯')}</div></div>
     ${wordCloudHtml(news)}
     <div class="radar-news-head"><strong>最新财经快讯</strong><div>${selWord?`<button class="btn mini subtle" data-action="radar-clear-word">清除“${h(selWord)}”筛选</button>`:''}<a href="https://kuaixun.eastmoney.com/" target="_blank" rel="noopener noreferrer">查看来源 ↗</a></div></div>
     ${newsListHtml(news)}
    </section>
    <section class="panel radar-panel">
     <div class="panel-head"><div><h2>实时盘口异动</h2><p>火箭发射、快速反弹、封板、大单、跳水等源端事件。展示原始触发时间，并非交易所逐笔推送。</p></div>
      <div class="radar-panel-actions"><span class="radar-status">${radarSourceStatus('changes')}</span>${press('changes','刷新异动')}</div></div>
      <div class="radar-filters">${[['all','全部'],['up','上涨类'],['down','下跌类'],['flow','大单类']].map(([id,label])=>`<button class="${radarState.filter===id?'active':''}" data-action="radar-filter" data-value="${id}">${label}</button>`).join('')}</div>
      ${anomaliesHtml()}
      <p class="radar-caveat">接口只返回最近一页异动，且时间仅为 HH:mm:ss；休市时可能继续显示当日最后事件，未提供的日期不作推断。<a href="https://quote.eastmoney.com/changes/" target="_blank" rel="noopener noreferrer">异动数据来源 ↗</a></p>
    </section>
  </div>
  <div class="radar-footer">行情热度 ≠ 投资建议。词云只统计标题而非社交媒体情绪；公开接口无时效性保证，失败时保留上次成功数据并明确标注异常。</div>
 </div>`;
}

export async function refreshRadar({force=false,source='all',onUpdate=()=>{}}={}){
 const config=[
  {key:'sectors',ttl:45000,fn:getLiveSectors},
  {key:'news',ttl:60000,fn:getLiveNews},
  {key:'changes',ttl:15000,fn:getLiveChanges}
 ];
 const now=Date.now();
 const tasks=config.filter(c=>source==='all'||source===c.key).filter(c=>{
  const target=radarState[c.key];return !target.loading&&(force||!(target.checkedAt||target.updatedAt)||now-(target.checkedAt||target.updatedAt)>=c.ttl);
 }).map(async c=>{
  const s=radarState[c.key];s.loading=true;
  try{
   const result=await c.fn();
   s.rows=result.rows;s.source=result.source;s.updatedAt=Date.now();s.error='';
  }catch(err){s.error=String(err.message||err);}
  finally{s.checkedAt=Date.now();s.loading=false;}
 });
 if(!tasks.length)return;
 try{await Promise.allSettled(tasks);}finally{onUpdate();}
}

export function handleRadarClick(btn,{onUpdate=()=>{},openStock=()=>{},openSector=()=>{}}={}){
 const action=btn.dataset.action,source=btn.dataset.source;
 if(action==='radar-refresh'){refreshRadar({force:true,source,onUpdate});return true;}
 if(action==='radar-filter'&&['all','up','down','flow'].includes(btn.dataset.value)){
  radarState.filter=btn.dataset.value;onUpdate();return true;
 }
 if(action==='radar-word'){
  const word=String(btn.dataset.word||'');
  if(!word)return true;
  radarState.selectedWord=radarState.selectedWord===word?'':word;onUpdate();return true;
 }
 if(action==='radar-clear-word'){radarState.selectedWord='';onUpdate();return true;}
 if(action==='radar-stock'&&/^\d{6}$/.test(btn.dataset.code||'')){
  openStock(btn.dataset.code,btn.dataset.name);return true;
 }
 if(action==='radar-sector'&&/^BK\d{3,6}$/.test(btn.dataset.code||'')){
  openSector(btn.dataset.code,btn.dataset.name);return true;
 }
 return false;
}
