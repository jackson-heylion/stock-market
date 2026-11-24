
import {getLiveSectors,getLiveNews,getLiveChanges,getNewsTerms,treemapLayout,newsSentiment,sentimentTerms} from './market-radar.js';
import {getMarketBreadth,getMarketIndices} from './market-center.js';
import {calculateFearGreed} from './fear-greed.js';
import {getCommunity,communityReport} from './community.js';
export const radarState={
 community:{rows:[],boards:[],updatedAt:0,checkedAt:0,source:'',warning:'',error:'',loading:false},
 communityHours:2,communityTone:'all',communityWord:'',communityBoard:'all',communitySource:'all',
 breadth:{rows:[],updatedAt:0,checkedAt:0,source:'',error:'',loading:false},
 indices:{rows:[],updatedAt:0,checkedAt:0,source:'',error:'',loading:false},
 sectors:{rows:[],updatedAt:0,checkedAt:0,source:'',error:'',loading:false},
 news:{rows:[],updatedAt:0,checkedAt:0,source:'',warning:'',error:'',loading:false},
 changes:{rows:[],updatedAt:0,checkedAt:0,source:'',error:'',loading:false},
 filter:'all',selectedWord:'',newsHours:2,newsTone:'all'
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

const TONE_LABELS={positive:'偏正面',negative:'偏负面',mixed:'正负并存',neutral:'无明确方向'};
export function sentimentHtml(report){
 const keys=Object.keys(TONE_LABELS),n=report.total;
 const direction=report.score===null?'方向不足':report.score>=25?'偏正面':report.score<=-25?'偏负面':'方向分歧';
 return '<div class="radar-sentiment"><div class="radar-sentiment-title"><strong>标题情绪：'+direction+'</strong><span>方向指数 '+(report.score??'--')+' / ±100 · '+n+'条去重标题</span></div>'+
 '<div class="radar-sentiment-bar" role="img" aria-label="正面、负面、混合、中性标题比例">'+keys.map(k=>'<span class="tone-'+k+'" style="width:'+(n?report.counts[k]/n*100:0)+'%"></span>').join('')+'</div>'+
 '<div class="radar-tone-filters">'+[['all','全部'],...keys.map(k=>[k,TONE_LABELS[k]])].map(([k,label])=>'<button data-action="radar-news-tone" data-value="'+k+'" class="'+(radarState.newsTone===k?'active':'')+' tone-text-'+k+'">'+label+' '+(k==='all'?n:report.counts[k])+'</button>').join('')+'</div>'+
 '<div class="radar-caveat">仅东方财富已获取标题的词典方向；明确方向覆盖 '+report.coverage+'%。不是全网投资者情绪或涨跌预测，混合/中性不计入方向指数。</div></div>';
}
export function wordCloudHtml(news){
 const report=newsSentiment(news,{hours:radarState.newsHours});
 const terms=sentimentTerms(report,{hours:radarState.newsHours,limit:32});
 if(!terms.length)return '<div class="radar-empty">所选时段没有足够的真实新闻标题，暂不生成词云。</div>';
 const max=Math.max(1,...terms.map(x=>x.count)),min=Math.min(...terms.map(x=>x.count));
 return '<div class="radar-cloud" aria-label="新闻标题词频及方向">'+terms.map(x=>{
   const scale=(x.count-min)/Math.max(1,max-min),size=(15+scale*22).toFixed(1),active=radarState.selectedWord===x.word;
   const c=x.counts;
   return '<button class="radar-word tone-word-'+x.tone+(active?' active':'')+'" data-action="radar-word" data-word="'+h(x.word)+'" style="font-size:'+size+'px" title="正面 '+c.positive+' · 负面 '+c.negative+' · 混合 '+c.mixed+' · 中性 '+c.neutral+'"><span>'+h(x.word)+'</span><small>'+x.count+'</small></button>';
 }).join('')+'</div>';
}
export function newsListHtml(news){
 const report=newsSentiment(news,{hours:radarState.newsHours}),word=radarState.selectedWord;
 const selected=report.rows.filter(x=>(!word||x.title.toUpperCase().includes(word.toUpperCase()))&&(radarState.newsTone==='all'||x.tone===radarState.newsTone));
 if(!selected.length)return '<p class="radar-empty">所选时段/情绪/词语没有匹配的真实新闻。</p>';
 return '<div class="radar-news-list sentiment-news-list">'+selected.slice(0,60).map(x=>{
  const evidence=[...x.positive,...x.negative].map(h).join('、');
  return '<article class="radar-news-line"><time>'+h(x.timeLabel||radarClock(x.time))+'</time><div><span class="radar-tone-label tone-text-'+x.tone+'">'+TONE_LABELS[x.tone]+'</span> <span>'+h(x.title)+'</span>'+(evidence?'<small>识别词：'+evidence+'</small>':'')+'</div></article>';
 }).join('')+'</div>';
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

export function fearGreedHtml(report){
 const {score,label,tone,coverage,factors,marketDate,session}=report;
 const angle=score===null?null:Math.PI*(1-score/100);
 const needle=angle===null?'':('<line x1="160" y1="151" x2="'+(160+110*Math.cos(angle)).toFixed(2)+'" y2="'+(151-110*Math.sin(angle)).toFixed(2)+'" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="160" cy="151" r="5" fill="currentColor"/>');
 const arcs=[[0,25,'#16896e'],[25,45,'#6eae93'],[45,56,'#b4a26c'],[56,76,'#e48582'],[76,100,'#d84c62']].map(([a,b,c])=>{
  const point=v=>[160+126*Math.cos(Math.PI*(1-v/100)),151-126*Math.sin(Math.PI*(1-v/100))].map(x=>x.toFixed(2)).join(' ');
  return '<path d="M '+point(a)+' A 126 126 0 0 1 '+point(b)+'" fill="none" stroke="'+c+'" stroke-width="20"/>';
 }).join('');
 return '<section class="panel radar-panel fg-panel"><div class="panel-head"><div><h2>A股恐慌与贪婪指数</h2><p>自研风险偏好代理 · 0–100 · '+h(session)+'</p></div><button class="btn mini subtle" data-action="radar-refresh" data-source="fear-greed">刷新指数</button></div>'+
 '<div class="fg-layout"><div class="fg-meter"><svg viewBox="0 0 320 180" role="img" aria-label="恐慌贪婪指数 '+h(score??'未计算')+'">'+arcs+needle+'<text x="24" y="176" font-size="11" fill="currentColor">0 恐慌</text><text x="296" y="176" font-size="11" text-anchor="end" fill="currentColor">100 贪婪</text><text x="160" y="18" text-anchor="middle" font-size="10" fill="currentColor">50</text></svg>'+
 '<div class="fg-value '+h(tone)+'"><strong>'+(score??'--')+'</strong><span>'+h(label)+'</span></div><small>有效权重 '+coverage+'% · 行情日期 '+h(marketDate||'未核验')+'</small></div>'+
 '<div class="fg-factors">'+factors.map(f=>'<div class="fg-factor"><div><b>'+h(f.label)+'</b><span>权重 '+f.weight+'% · '+(f.score??'缺失')+'</span></div><div class="fg-track"><i style="width:'+(f.score??0)+'%"></i></div><small>'+h(f.detail)+'</small></div>').join('')+'</div></div>'+
 '<p class="radar-caveat">0–24极度恐慌，25–44恐慌，45–55中性，56–75贪婪，76–100极度贪婪。指数动量按±3%映射到0–100；涨跌家数和行业强弱按上涨加半数平盘比例；新闻方向映射到0–100。三项市场因子必须有效，缺少新闻则按85%权重归一。非连续交易时段不生成新的综合指数。东方财富/腾讯公开报价，非CNN官方指数或交易指令。</p></section>';
}

export function communityHtml(){
 const s=radarState.community,now=Date.now(),fresh=s.updatedAt&&now-s.updatedAt<=2*3600000&&!s.error;
 const all=communityReport(fresh?s.rows:[],{now,hours:radarState.communityHours,source:radarState.communitySource});
 const report=communityReport(fresh?s.rows:[],{now,hours:radarState.communityHours,board:radarState.communityBoard,source:radarState.communitySource});
 const word=radarState.communityWord,tone=radarState.communityTone;
 const rows=report.rows.filter(x=>(tone==='all'||x.tone===tone)&&(!word||x.title.toUpperCase().includes(word.toUpperCase())));
 const labels={positive:'偏多',negative:'偏空',mixed:'分歧',neutral:'中性'};
 const active=Object.keys(labels),counts=report.counts,score=report.score;
 const sourceCount=s.boards.filter(b=>b.status==='ok').length;
 const max=Math.max(1,...report.terms.map(t=>t.count));
 return '<section class="panel radar-panel community-panel"><div class="panel-head"><div><h2>社区舆情 · 股吧 / 虎扑 / 淘股吧</h2><p>公开帖子标题样本 · 独立于财经新闻 · 不代表事实或全体投资者</p></div><div class="radar-panel-actions"><span class="radar-status">'+radarSourceStatus('community')+'</span><button class="btn mini subtle" data-action="radar-refresh" data-source="community">刷新讨论</button></div></div>'+
 '<div class="radar-filters">'+[2,6,24].map(n=>'<button data-action="radar-community-hours" data-value="'+n+'" class="'+(radarState.communityHours===n?'active':'')+'">近'+n+'小时</button>').join('')+'</div>'+
 '<div class="radar-filters">'+[['all','全部平台'],['东方财富股吧','东方财富股吧'],['虎扑','虎扑股票区'],['淘股吧','淘股吧']].map(([id,label])=>{const b=s.boards.filter(x=>x.source===id),n=b.filter(x=>x.status==='ok').length;return '<button data-action="radar-community-source" data-value="'+h(id)+'" class="'+(radarState.communitySource===id?'active':'')+'">'+h(label)+(id==='all'?'':' · '+n+'/'+b.length)+'</button>';}).join('')+'</div>'+
 '<div class="community-summary"><div><small>社区方向指数</small><strong class="tone-text-'+(score===null?'neutral':score>0?'positive':score<0?'negative':'mixed')+'">'+(score===null?'--':score)+'</strong><span>'+(score===null?'样本不足':score>20?'偏多':score<-20?'偏空':'分歧')+'</span></div><div><small>去重讨论样本</small><strong>'+report.total+'</strong><span>明确方向 '+report.coverage+'%</span></div><div><small>成功采集讨论区</small><strong>'+sourceCount+' / '+s.boards.length+'</strong><span>仅监控样本</span></div></div>'+
 '<div class="radar-sentiment-bar">'+active.map(k=>'<span class="tone-'+k+'" style="width:'+(report.total?counts[k]/report.total*100:0)+'%"></span>').join('')+'</div>'+
 '<div class="radar-tone-filters">'+[['all','全部'],...active.map(k=>[k,labels[k]])].map(([k,l])=>'<button data-action="radar-community-tone" data-value="'+k+'" class="'+(tone===k?'active':'')+' tone-text-'+k+'">'+l+' '+(k==='all'?report.total:counts[k])+'</button>').join('')+'</div>'+
 '<div class="radar-news-head"><strong>讨论热度排行</strong><button class="btn mini subtle" data-action="radar-community-board" data-value="all">全部讨论区</button></div><div class="community-board-list">'+all.boards.map(b=>'<button data-action="radar-community-board" data-value="'+h(b.code)+'" class="'+(radarState.communityBoard===b.code?'active':'')+'"><strong>'+h(b.name)+'</strong><small>'+b.count+'帖 · 多'+b.positive+' / 空'+b.negative+' · 评论 '+(b.comments??'--')+'</small></button>').join('')+'</div>'+
 '<div class="radar-news-head"><strong>社区情绪词云</strong>'+(word?'<button class="btn mini subtle" data-action="radar-community-word" data-value="">清除“'+h(word)+'”</button>':'')+'</div><div class="radar-cloud">'+report.terms.map(t=>'<button class="radar-word tone-word-'+t.tone+(word===t.word?' active':'')+'" data-action="radar-community-word" data-value="'+h(t.word)+'" style="font-size:'+(14+20*t.count/max)+'px">'+h(t.word)+' <small>'+t.count+'</small></button>').join('')+'</div>'+
 '<div class="radar-news-head"><strong>公开讨论原帖</strong><a href="https://guba.eastmoney.com/" target="_blank" rel="noopener noreferrer">股吧来源 ↗</a></div>'+
 (rows.length?'<div class="radar-news-list sentiment-news-list">'+rows.slice(0,80).map(x=>'<article class="radar-news-line"><time>'+h(new Date(x.time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))+'</time><div><span class="radar-tone-label tone-text-'+x.tone+'">'+labels[x.tone]+'</span> <a href="'+h(x.url)+'" target="_blank" rel="noopener noreferrer">'+h(x.title)+'</a><small>'+h(x.source)+' · '+h(x.board)+' · '+(x.timeKind==='activity'?'列表活动时间':'发帖时间')+' · 阅读 '+(x.reads??'--')+' · 评论 '+(x.comments??'--')+' · 识别词 '+h([...x.positive,...x.negative].join('、')||'无')+'</small></div></article>').join('')+'</div>':'<div class="radar-empty">'+(fresh?'当前筛选无有效样本':'社区数据未取得或已过期，不计算情绪')+'</div>')+
 '<p class="radar-caveat">东方财富股吧覆盖观察及持仓相关股票，虎扑股票区、淘股吧社区总版覆盖公开讨论列表。虎扑默认最新回复列表，时间标为活动时间而非发帖时间；各来源样本不代表全站，不采集用户身份、正文或私人内容。指数至少10条去重标题和5条方向明确标题才计算。阅读及评论为来源累积计数，不代表独立用户。词典可能误判反讽；不作为真实交易信号，且不改动综合恐慌贪婪指数权重。</p></section>';
}

const FG_KEY='stock-market-fg-last-v1';
function displayedFearGreed(){const current=calculateFearGreed(radarState);if(current.score!==null){try{localStorage.setItem(FG_KEY,JSON.stringify(current));}catch{}return current;}try{const old=JSON.parse(localStorage.getItem(FG_KEY));if(old?.version===current.version&&Number.isInteger(old.score)&&old.score>=0&&old.score<=100&&Number.isFinite(old.asOf)&&old.asOf<=Date.now()&&Array.isArray(old.factors))return {...old,session:'历史有效快照 · '+new Date(old.asOf).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' · 非实时'};}catch{}return current;}
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
  ${fearGreedHtml(displayedFearGreed())}
  <section class="panel radar-panel">
   <div class="panel-head"><div><h2>行业板块热度图</h2><p>按成交额与涨跌幅呈现行业热度</p></div>
   <div class="radar-panel-actions"><span class="radar-status">${radarSourceStatus('sectors')}</span>${press('sectors','刷新板块')}</div></div>
   <div class="radar-legend"><span class="radar-legend-up">上涨板块 ${positive}</span><span class="radar-legend-down">下跌板块 ${negative}</span><span>东方财富行业板块 · 成交额排序</span></div>
   ${heatmapHtml(sectors)}
  </section>
  <div class="radar-columns">
    <section class="panel radar-panel">
     <div class="panel-head"><div><h2>财经舆情与词云</h2><p>新闻标题方向、关键词及实际快讯</p></div>
     <div class="radar-panel-actions"><span class="radar-status">${radarSourceStatus('news')}</span>${press('news','刷新快讯')}</div></div>
     <div class="radar-filters">${[2,6,24].map(h=>`<button data-action="radar-news-hours" data-value="${h}" class="${radarState.newsHours===h?'active':''}">近${h}小时</button>`).join('')}</div>
     ${sentimentHtml(newsSentiment(news,{hours:radarState.newsHours}))}
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
  ${communityHtml()}
  <div class="radar-footer">数据来自公开快照，服务异常时保留上一有效记录并标注来源状态。</div>
 </div>`;
}

export async function refreshRadar({force=false,source='all',onUpdate=()=>{}}={}){
 const config=[
  {key:'breadth',ttl:45000,fn:async()=>{const b=await getMarketBreadth();if(!b)throw Error('涨跌家数不可用');return {rows:[b],source:b.source,receivedAt:Date.now()};}},
  {key:'indices',ttl:45000,fn:async()=>({rows:await getMarketIndices(),source:'腾讯财经主要指数',receivedAt:Date.now()})},
  {key:'sectors',ttl:45000,fn:getLiveSectors},
  {key:'news',ttl:60000,fn:getLiveNews},
  {key:'community',ttl:60000,fn:getCommunity},
  {key:'changes',ttl:15000,fn:getLiveChanges}
 ];
 const now=Date.now();
 const tasks=config.filter(c=>source==='all'||source===c.key||source==='fear-greed'&&['breadth','indices','sectors','news'].includes(c.key)).filter(c=>{
  const target=radarState[c.key];return !target.loading&&(force||!(target.checkedAt||target.updatedAt)||now-(target.checkedAt||target.updatedAt)>=c.ttl);
 }).map(async c=>{
  const s=radarState[c.key];s.loading=true;
  try{
   const result=await c.fn();
   s.rows=result.rows;if(c.key==='community')s.boards=result.boards||[];s.source=result.source;s.updatedAt=result.receivedAt||Date.now();s.warning=result.warning||'';s.error='';
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
 if(action==='radar-news-hours'&&[2,6,24].includes(Number(btn.dataset.value))){radarState.newsHours=Number(btn.dataset.value);onUpdate();return true;}
 if(action==='radar-news-tone'&&['all',...Object.keys(TONE_LABELS)].includes(btn.dataset.value)){radarState.newsTone=btn.dataset.value;onUpdate();return true;}
 if(action==='radar-community-source'&&['all','东方财富股吧','虎扑','淘股吧'].includes(btn.dataset.value)){radarState.communitySource=btn.dataset.value;radarState.communityBoard='all';radarState.communityWord='';onUpdate();return true;}
 if(action==='radar-community-hours'&&[2,6,24].includes(Number(btn.dataset.value))){radarState.communityHours=Number(btn.dataset.value);onUpdate();return true;}
 if(action==='radar-community-tone'&&['all','positive','negative','mixed','neutral'].includes(btn.dataset.value)){radarState.communityTone=btn.dataset.value;onUpdate();return true;}
 if(action==='radar-community-word'){const w=String(btn.dataset.value||'');radarState.communityWord=radarState.communityWord===w?'':w;onUpdate();return true;}
 if(action==='radar-community-board'){const v=String(btn.dataset.value||'all');if(v==='all'||radarState.community.rows.some(x=>x.code===v)){radarState.communityBoard=v;onUpdate();}return true;}
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
