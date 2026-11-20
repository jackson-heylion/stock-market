
import {SCOPES,SORT_COLUMNS,getRankings,getSectors,getWatchQuotes} from './market-center.js';
import {SECURITIES} from './seed.js';
export const MT_FOLLOW_KEY='stock-market-terminal-follows-v1';
export const MT_RECENT_KEY='stock-market-terminal-recent-v1';
const mt={view:'rank',scope:'all',sectorCode:null,sectorLabel:'',sortKey:'pct',descending:true,
 page:1,size:30,rows:[],total:null,search:'',loading:false,error:'',updatedAt:0,
 seq:0,followed:null,recent:null,sectors:[],sectorError:'',loadingSectors:false,lookupCode:null,lookupRows:[]};
export function terminalFmt(value,digits=2){
 if(typeof value!=='number'||!Number.isFinite(value))return '--';
 return value.toFixed(digits);
}

export function terminalSigned(value,digits=2){
 if(typeof value!=='number'||!Number.isFinite(value))return '--';
 return (value>0?'+':'')+value.toFixed(digits);
}

export function terminalPercent(value){return terminalSigned(value)+'%';}

export function terminalUnit(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)return '--';
 if(value>=1e8)return (value/1e8).toFixed(2)+'亿';
 if(value>=1e4)return (value/1e4).toFixed(2)+'万';
 return value.toFixed(0);
}

export function terminalPe(value){
 if(typeof value!=='number'||!Number.isFinite(value))return '--';
 if(value<0)return '亏损';
 return value.toFixed(2);
}

export function terminalEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

export function terminalColor(value){return typeof value==='number'&&Number.isFinite(value)?value>0?'mt-rise':value<0?'mt-fall':'mt-flat':'mt-flat';}

export function terminalMoney(n){return typeof n==='number'&&Number.isFinite(n)?terminalUnit(n):'--';}

export function terminalGetStorage(key,fallback){
 try{const v=JSON.parse(localStorage.getItem(key));return Array.isArray(v)?v:fallback;}catch{return fallback;}
}

export function terminalSave(key,array){try{localStorage.setItem(key,JSON.stringify(array));}catch{/* no persistent storage */}}

export function terminalFollowed(){
 if(!mt.followed)mt.followed=new Set(terminalGetStorage(MT_FOLLOW_KEY,SECURITIES.map(x=>x.code)).filter(c=>/^\d{6}$/.test(String(c))));
 return mt.followed;
}

export function terminalRecent(){
 if(!mt.recent)mt.recent=terminalGetStorage(MT_RECENT_KEY,[]).filter(x=>x&&/^\d{6}$/.test(String(x.code))&&typeof x.name==='string').slice(0,10);
 return mt.recent;
}

export function terminalViewTitle(){
 if(mt.view==='follow')return '我的关注';
 if(mt.view==='recent')return '最近访问';
 if(mt.view==='lookup')return '代码查询';
 if(mt.view==='sector')return mt.sectorLabel||'行业板块';
 return mt.scope==='all'?'沪深一览':mt.scope==='sh'?'沪市一览':mt.scope==='sz'?'深市一览':SCOPES[mt.scope]?.label??'沪深一览';
}

export function terminalRowList(){
 const word=mt.search.trim().toLowerCase();
 return mt.rows.filter(x=>!word||x.code.includes(word)||x.name.toLowerCase().includes(word));
}

export function renderTerminalRows(){
 const rows=terminalRowList();
 if(!rows.length){
  const msg=mt.loading?'正在加载行情':'没有匹配的行情记录';
  return '<tr><td class="mt-empty" colspan="13">'+terminalEsc(msg)+'</td></tr>';
 }
 const followed=terminalFollowed();
 return rows.map((x,i)=>{
  const isFollowed=followed.has(x.code);
  const position=(mt.page-1)*mt.size+i+1;
  return `<tr class="mt-row">
   <td class="mt-code"><button data-action="mt-chart" data-code="${terminalEsc(x.code)}">${x.exchange==='SH'?'SH':'SZ'}${terminalEsc(x.code)}</button></td>
   <td class="mt-name"><button data-action="mt-chart" data-code="${terminalEsc(x.code)}">${terminalEsc(x.name)}</button></td>
   <td class="${terminalColor(x.pct)} mt-number">${terminalFmt(x.price)}</td>
   <td class="${terminalColor(x.change)} mt-number">${terminalSigned(x.change)}</td>
   <td class="${terminalColor(x.pct)} mt-number">${terminalPercent(x.pct)}</td>
   <td class="${terminalColor(x.ytdPct)} mt-number">${terminalPercent(x.ytdPct)}</td>
   <td class="mt-number">${terminalUnit(x.volume===null?null:x.volume*100)}</td>
   <td class="mt-number">${terminalMoney(x.turnover)}</td>
   <td class="mt-number">${x.turnoverRate===null?'--':terminalPercent(x.turnoverRate)}</td>
   <td class="mt-number">${terminalPe(x.peTtm)}</td>
   <td class="mt-number">${terminalFmt(x.pb)}</td>
   <td class="mt-number">${terminalMoney(x.marketCap)}</td>
   <td class="mt-action"><button aria-label="${isFollowed?'取消关注':'关注'} ${terminalEsc(x.name)}" data-action="mt-follow" data-code="${terminalEsc(x.code)}" class="${isFollowed?'mt-following':'mt-follow'}">${isFollowed?'已关注':'关注'}</button></td>
  </tr>`;
 }).join('');
}

export function renderMarketTerminal(){
 const followed=terminalFollowed(),recent=terminalRecent();
 const header=[
  ['code','股票代码'],['name','股票名称'],['price','当前价'],['change','涨跌额'],['pct','涨跌幅'],
  ['ytdPct','年初至今'],['volume','成交量'],['turnover','成交额'],['turnoverRate','换手率'],
  ['peTtm','市盈率(TTM)'],['pb','市净率'],['marketCap','市值']
 ];
 const sortValue=(name)=>mt.sortKey===name?(mt.descending?' ▼':' ▲'):' ▾';
 const marketSections=[
  ['all','沪深一览'],['sh','沪市一览'],['sz','深市一览'],
  ['main','沪深主板'],['gem','创业板'],['star','科创板']
 ];
 const rankItems=[
  ['pct','涨幅排行'],['change','涨跌额排行'],['turnover','成交额排行'],
  ['volume','成交量排行'],['turnoverRate','换手率排行'],['ytdPct','年初至今排行'],['marketCap','市值排行']
 ];
 const menus=(items,type)=>items.map(([id,label])=>`<button class="mt-side-item ${type==='scope'&&mt.view==='rank'&&mt.scope===id?'selected':''}${type==='sort'&&mt.view==='rank'&&mt.sortKey===id?' selected':''}" data-action="${type==='scope'?'mt-scope':'mt-sort-menu'}" data-value="${terminalEsc(id)}">${terminalEsc(label)}</button>`).join('');
 const sectors=(mt.sectors||[]).map(s=>`<button class="mt-side-item ${mt.view==='sector'&&mt.sectorCode===s.code?'selected':''}" data-action="mt-sector" data-code="${terminalEsc(s.code)}" data-name="${terminalEsc(s.name)}">${terminalEsc(s.name)}</button>`).join('');
 const makeSection=(title,content)=>`<section class="mt-menu-section"><div class="mt-side-heading">${title}</div>${content}</section>`;
 const recentList=recent.length?recent.map(s=>`<button class="mt-side-item" data-action="mt-chart" data-code="${terminalEsc(s.code)}">${terminalEsc(s.name)} <small>${terminalEsc(s.code)}</small></button>`).join(''):'<p class="mt-no-recent">暂时没有访问记录</p>';
 const pagingTotal=mt.total===null?'--':mt.total.toLocaleString('zh-CN');
 const maxPage=mt.total===null?null:Math.max(1,Math.ceil(mt.total/mt.size));
 const shown=mt.rows.length;
 const updated=mt.updatedAt?new Date(mt.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'尚未连接';
 const viewTitle=terminalViewTitle();
 return `<div class="market-terminal">
  <aside class="mt-side">
   ${makeSection('最近访问','<div class="mt-recent-actions"><button data-action="mt-view" data-value="recent">最近访问（'+recent.length+'）</button><button data-action="mt-clear-recent" '+(recent.length?'':'disabled')+'>清空</button></div>'+recentList)}
   ${makeSection('我的关注',`<button class="mt-side-item ${mt.view==='follow'?'selected':''}" data-action="mt-view" data-value="follow">关注股票（${followed.size}）</button>`)}
   ${makeSection('沪深股市',menus(marketSections,'scope'))}
   ${makeSection('行情排行',menus(rankItems,'sort'))}
   ${makeSection('行业板块（东财）',`<button class="mt-side-item" data-action="mt-load-sectors">↻ 加载行业分类</button>${mt.sectorError?`<p class="mt-no-recent">${terminalEsc(mt.sectorError)}</p>`:''}${sectors}`)}
  </aside>
  <div class="mt-content">
   <div class="mt-topline">
    <div class="mt-breadcrumb">行情中心 <span>›</span> 沪深股市 <span>›</span> <strong>${terminalEsc(viewTitle)}</strong></div>
    <div class="mt-pagesize"><span>每页显示：</span>${[30,60,90].map(v=>`<button data-action="mt-size" data-value="${v}" class="${mt.size===v?'selected':''}">${v}</button>`).join('')}</div>
   </div>
   <div class="mt-toolbar">
    <div class="mt-heading"><strong>${terminalEsc(viewTitle)}</strong><span> · ${mt.view==='rank'?terminalEsc(SORT_COLUMNS[mt.sortKey]?.label||'涨跌幅'):'证券报价'}</span></div>
    <div class="mt-utilities">
     <label class="mt-search-label"><span>⌕</span><input id="mt-search" type="search" value="${terminalEsc(mt.search)}" placeholder="筛选本页 / 输入6位代码" autocomplete="off"/></label>
     <button class="mt-lookup" data-action="mt-lookup">查代码</button>
     <button class="mt-refresh" data-action="mt-refresh" ${mt.loading?'disabled':''}>${mt.loading?'更新中…':'刷新行情'}</button>
    </div>
   </div>
   <div class="mt-table-wrap"><table class="mt-table">
     <thead><tr>${header.map(([key,label])=>`<th><button class="mt-sort ${mt.sortKey===key?'active':''}" data-action="mt-sort" data-value="${key}" title="按${terminalEsc(label)}全榜单排序">${terminalEsc(label)}<span>${sortValue(key)}</span></button></th>`).join('')}<th>操作</th></tr></thead>
     <tbody id="mt-table-body">${renderTerminalRows()}</tbody>
   </table></div>
   <div class="mt-bottomline">
    <div class="mt-source">${mt.error?'数据源异常：'+terminalEsc(mt.error)+'；':''}东方财富公开行情 · 接口取数 ${updated} · 已展示 ${shown} 条 / 榜单总量 ${pagingTotal} · 不保证实时性</div>
    <div class="mt-pagination">
      <button data-action="mt-page" data-value="prev" ${mt.page<=1?'disabled':''}>上一页</button>
      <span>第 ${mt.page} ${maxPage?' / '+maxPage:' '} 页</span>
      <button data-action="mt-page" data-value="next" ${(maxPage!==null&&mt.page>=maxPage)?'disabled':''}>下一页</button>
    </div>
   </div>
   <div class="mt-note">单位：成交量按股显示（行情源为手，每手100股），成交额/市值按元换算；年初至今、PE(TTM)、市净率缺失时显示“--”。排序由数据源服务端完成，搜索仅筛选当前已加载页。股票数据仅供研究，关注列表不会产生模拟买入订单。</div>
  </div>
 </div>`;
}

export function terminalLookupCurrent(code){return mt.rows.find(x=>x.code===code)||mt.lookupRows?.find(x=>x.code===code)||null;}

export function terminalVisit(code,name){
 const rec=terminalRecent().filter(x=>x.code!==code);
 rec.unshift({code,name:name||code});
 mt.recent=rec.slice(0,10);terminalSave(MT_RECENT_KEY,mt.recent);
}

export function terminalSetScope(scope){
 if(!SCOPES[scope])return false;
 Object.assign(mt,{view:'rank',scope,sectorCode:null,sectorLabel:'',page:1,rows:[],total:null,updatedAt:0,error:'',search:''});
 return true;
}

export function terminalSetSort(sort){
 if(!SORT_COLUMNS[sort])return false;
 Object.assign(mt,{view:'rank',sortKey:sort,descending:sort==='code'?false:true,page:1,rows:[],total:null,updatedAt:0,error:'',search:''});
 return true;
}

export function refreshTerminal(force=false,rerender=()=>{}){
 if(mt.loading&&!force)return;
 if(!force&&mt.updatedAt&&Date.now()-mt.updatedAt<45000)return;
 const seq=++mt.seq;
 mt.loading=true;
 const view=mt.view,scope=mt.scope,sectorCode=mt.sectorCode,sortKey=mt.sortKey,descending=mt.descending,page=mt.page,size=mt.size;
 const codes=view==='follow'?[...terminalFollowed()]:view==='recent'?terminalRecent().map(x=>x.code):view==='lookup'?mt.lookupCode?[mt.lookupCode]:[]:null;
 const request=codes!==null?codes.length?getWatchQuotes(codes):Promise.resolve([]):
 getRankings('gainers',scope,{page,size,sortKey,descending,sectorCode:view==='sector'?sectorCode:null});
 return Promise.resolve(request).then(result=>{
  if(seq!==mt.seq)return;
  if(codes!==null){
   const byCode=new Map(result.map(x=>[x.code,x]));
   mt.lookupRows=result;
   mt.rows=codes.map(code=>byCode.get(code)).filter(Boolean).sort((a,b)=> {
    const one=a[sortKey],two=b[sortKey];
    return (typeof one==='number'&&typeof two==='number'?(one-two):String(one||'').localeCompare(String(two||'')))*(descending?-1:1);
   });
   mt.total=mt.rows.length;
  }else{
   mt.rows=result.rows;
   mt.total=result.total;
  }
  mt.error='';mt.updatedAt=Date.now();
 }).catch(err=>{
  if(seq===mt.seq){mt.error=String(err.message);mt.updatedAt=Date.now();}
 }).finally(()=>{
  if(seq!==mt.seq)return;
  mt.loading=false;rerender();
 });
}

export async function loadTerminalSectors(rerender=()=>{}){
 if(mt.loadingSectors)return;
 mt.loadingSectors=true;
 try{const result=await getSectors();mt.sectors=result.rows;mt.sectorError='';}
 catch(err){mt.sectorError=String(err.message);}
 finally{mt.loadingSectors=false;rerender();}
}

export function terminalSearchInput(input){
 mt.search=String(input||'').trim().slice(0,80);
 const body=document.querySelector('#mt-table-body');
 if(body)body.innerHTML=renderTerminalRows();
}

export function handleTerminalClick(btn,{rerender=()=>{},openChart=()=>{},notify=()=>{}}={}){
 const action=btn.dataset.action,v=btn.dataset.value,code=btn.dataset.code;
 switch(action){
 case'mt-scope':if(!terminalSetScope(v))return;rerender();refreshTerminal(true,rerender);break;
 case'mt-sort-menu':if(!terminalSetSort(v))return;rerender();refreshTerminal(true,rerender);break;
 case'mt-sort':{
  if(!SORT_COLUMNS[v])return;
  const reverse=mt.sortKey===v;
  mt.sortKey=v;mt.descending=reverse?!mt.descending:v==='code'?false:true;mt.page=1;mt.updatedAt=0;mt.rows=[];
  rerender();refreshTerminal(true,rerender);break;
 }
 case'mt-size':{
  const size=Number(v);if(![30,60,90].includes(size))return;
  mt.size=size;mt.page=1;mt.rows=[];mt.updatedAt=0;rerender();refreshTerminal(true,rerender);break;
 }
 case'mt-page':{
  const next=mt.page+(v==='prev'?-1:v==='next'?1:0);
  const maxPage=mt.total===null?null:Math.max(1,Math.ceil(mt.total/mt.size));
  if(next<1||maxPage!==null&&next>maxPage||next===mt.page)return;
  mt.page=next;mt.rows=[];mt.updatedAt=0;rerender();refreshTerminal(true,rerender);break;
 }
 case'mt-refresh':refreshTerminal(true,rerender);break;
 case'mt-follow':{
  if(!/^\d{6}$/.test(code))return;
  const follow=terminalFollowed();
  if(follow.has(code))follow.delete(code);else follow.add(code);
  terminalSave(MT_FOLLOW_KEY,[...follow]);
  if(mt.view==='follow'){mt.updatedAt=0;refreshTerminal(true,rerender);}else rerender();
  break;
 }
 case'mt-view':{
  if(!['follow','recent'].includes(v))return;
  mt.view=v;mt.page=1;mt.rows=[];mt.total=null;mt.search='';mt.updatedAt=0;
  rerender();refreshTerminal(true,rerender);break;
 }
 case'mt-clear-recent':mt.recent=[];terminalSave(MT_RECENT_KEY,[]);rerender();break;
 case'mt-load-sectors':loadTerminalSectors(rerender);break;
 case'mt-sector':{
  if(!/^BK\d{3,6}$/.test(code))return;
  mt.view='sector';mt.sectorCode=code;mt.sectorLabel=btn.dataset.name||code;mt.page=1;
  mt.rows=[];mt.total=null;mt.updatedAt=0;mt.search='';
  rerender();refreshTerminal(true,rerender);break;
 }
 case'mt-chart':{
  if(!/^\d{6}$/.test(code))return;
  const row=terminalLookupCurrent(code),s=SECURITIES.find(x=>x.code===code);
  terminalVisit(code,row?.name||s?.name||code);
  openChart(code,row||s||{code,name:code});break;
 }
 case'mt-lookup':{
  const query=mt.search.trim();
  if(!/^\d{6}$/.test(query)){notify('请输入6位A股证券代码进行精确查询');return;}
  mt.lookupCode=query;mt.view='lookup';mt.rows=[];mt.total=null;mt.page=1;mt.search='';mt.updatedAt=0;
  rerender();refreshTerminal(true,rerender);break;
 }
 }
}
