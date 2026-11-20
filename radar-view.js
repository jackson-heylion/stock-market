
import {getLiveSectors,getLiveNews,getLiveChanges,getNewsTerms,treemapLayout} from './market-radar.js';
export const radarState={
 sectors:{rows:[],updatedAt:0,checkedAt:0,source:'',error:'',loading:false},
 news:{rows:[],updatedAt:0,checkedAt:0,source:'',warning:'',error:'',loading:false},
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
 if(s.updatedAt)return (s.source?s.source+' · ':'')+(s.warning?'快照可能滞后 · ':'')+'源数据于 '+radarClock(s.updatedAt);
 return '尚未加载';
}

export function heatmapHtml(rows){
 if(!rows.length)return '<div class="radar-empty">板块数据尚未获取，无法生成真实热度图。</div>';
 // Only the largest 16 use treemap rectangles. The full 36-name list below
 // guarantees readable labels without squeezing 3-line text into tiny tiles.
 const selected=rows.slice(0,16),nodes=treemapLayout(selected,100,100);
 const grid='<div class="radar-treemap" role="group" aria-label="前16成交额行业热度图，更多板块见下方完整榜单">'+
  nodes.map(x=>{
   const intensity=Math.min(88,Math.max(20,20+Math.abs(x.pct)*10));
   const up=x.pct>=0,prec=x.pct>0?'+':'';
   const style=`left:${x.x.toFixed(4)}%;top:${x.y.toFixed(4)}%;width:${x.w.toFixed(4)}%;height:${x.h.toFixed(4)}%;--heat-intensity:${intensity.toFixed(1)}%;--heat-active:var(${up?'--radar-up':'--radar-down'});`;
   return `<button class="radar-heat-cell" style="${style}" data-action="radar-sector" data-code="${h(x.code)}" data-name="${h(x.name)}" title="${h(x.name)}：${prec}${x.pct.toFixed(2)}%，成交额${radarShort(x.turnover)}">
      <span class="radar-heat-index">${String(x.index+1).padStart(2,"0")}</span>
      <span class="radar-heat-name">${h(x.name)}</span>
      <strong class="radar-heat-pct">${prec}${x.pct.toFixed(2)}%</strong>
      <small class="radar-heat-turnover">${radarShort(x.turnover)}</small>
   </button>`;
  }).join('')+'</div>';
 const list='<div class="radar-sector-detail"><div class="radar-sector-detail-heading"><strong>板块完整榜单</strong><span>按成交额排序 · ${rows.length}个板块，全部可读、可点击</span></div><div class="radar-sector-grid">'+
  rows.map((x,i)=>`<button class="radar-sector-item" data-action="radar-sector" data-code="${h(x.code)}" data-name="${h(x.name)}" title="查看${h(x.name)}成分股">
    <small>${String(i+1).padStart(2,'0')}</small><span class="radar-sector-item-name">${h(x.name)}</span>
    <strong class="${x.pct>=0?'radar-gain':'radar-loss'}">${x.pct>0?'+':''}${x.pct.toFixed(2)}%</strong>
    <small class="radar-sector-amount">${radarShort(x.turnover)}</small>
   </button>`).join('')+'</div></div>';
 return grid+list;
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
  <div><span>板块样本</span><strong>${sectors.length||'--'}</strong><small>展示成交额前36</small></div>
  <div><span>板块涨 / 跌</span><strong class="radar-dual"><span class="up">${positive}</span> / <span class="down">${negative}</span></strong><small>仅限图中样本</small></div>
  <div><span>最新快讯</span><strong>${headline?radarClock(headline.time):'--'}</strong><small>${news.length}条真实标题</small></div>
  <div><span>异动记录</span><strong>${changes.length||'--'}</strong><small>接口最近一页 · 非全日合计</small></div>
 </div>`;
 return `<div class="radar-root">
  <div class="hero"><div><div class="eyebrow">RADAR</div><h1>市场雷达</h1>
    <p class="subheading">实时行业板块热度、财经快讯高频词与盘口异动监控</p></div>
    <div class="action-row"><button class="btn primary" data-action="radar-refresh" data-source="all">刷新所有数据</button><button class="btn subtle" data-page="quotes">行情中心 ↗</button></div>
  </div>
  ${stats}
  <section class="panel radar-panel">
   <div class="panel-head"><div><h2>行业板块热度图</h2><p>按成交额与涨跌幅呈现行业热度</p></div>
   <div class="radar-panel-actions"><span class="radar-status">${radarSourceStatus('sectors')}</span>${press('sectors','刷新板块')}</div></div>
   <div class="radar-legend"><span class="radar-legend-up">上涨板块 ${positive}</span><span class="radar-legend-down">下跌板块 ${negative}</span><span>东方财富行业板块 · 成交额排序</span></div>
   ${heatmapHtml(sectors)}
  </section>
  <div class="radar-columns">
    <section class="panel radar-panel">
     <div class="panel-head"><div><h2>财经舆情词云</h2><p>近2小时快讯高频词</p></div>
     <div class="radar-panel-actions"><span class="radar-status">${radarSourceStatus('news')}</span>${press('news','刷新快讯')}</div></div>
     ${wordCloudHtml(news)}
     <div class="radar-news-head"><strong>最新财经快讯</strong><div>${selWord?`<button class="btn mini subtle" data-action="radar-clear-word">清除“${h(selWord)}”筛选</button>`:''}<a href="https://kuaixun.eastmoney.com/" target="_blank" rel="noopener noreferrer">查看来源 ↗</a></div></div>
     ${newsListHtml(news)}
    </section>
    <section class="panel radar-panel">
     <div class="panel-head"><div><h2>实时盘口异动</h2><p>盘口大单、拉升与跳水事件监控</p></div>
      <div class="radar-panel-actions"><span class="radar-status">${radarSourceStatus('changes')}</span>${press('changes','刷新异动')}</div></div>
      <div class="radar-filters">${[['all','全部'],['up','上涨类'],['down','下跌类'],['flow','大单类']].map(([id,label])=>`<button class="${radarState.filter===id?'active':''}" data-action="radar-filter" data-value="${id}">${label}</button>`).join('')}</div>
      ${anomaliesHtml()}
      <p class="radar-caveat">接口返回最新分笔异动，休市展示当日最后事件。<a href="https://quote.eastmoney.com/changes/" target="_blank" rel="noopener noreferrer">异动来源 ↗</a></p>
    </section>
  </div>
  <div class="radar-footer">数据来自公开快照，服务异常时保留上一有效记录并标注来源状态。</div>
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
   s.rows=result.rows;s.source=result.source;s.updatedAt=result.receivedAt||Date.now();s.warning=result.warning||'';s.error='';
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
