export function movingAverage(bars,period){
 return bars.map((x,i)=>i+1<period?null:bars.slice(i+1-period,i+1).reduce((v,b)=>v+b.close,0)/period);
}

export function minuteSlot(date){
 const m=String(date).match(/^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2})$/);
 if(!m)return null;
 const t=Number(m[1])*60+Number(m[2]);
 if(Number(m[2])>59)return null;
 return t>=570&&t<=690?t-570:t>=780&&t<=900?t-660:null;
}
const fmt=n=>Number.isFinite(n)?n.toFixed(2):'--';
const shortVol=n=>n>=1e8?(n/1e8).toFixed(1)+'亿':n>=1e4?(n/1e4).toFixed(1)+'万':String(Math.round(n));
export function minuteChartSvg(input,prevClose){
 const dates=input.filter(b=>minuteSlot(b.date)!==null&&Number.isFinite(b.price)&&b.price>0).map(b=>b.date.slice(0,10)).sort();
 if(!dates.length)return '<div class="chart-empty">暂无真实交易时段分钟数据。</div>';
 const date=dates.at(-1),unique=new Map();
 for(const b of input)if(String(b.date).startsWith(date+' ')&&minuteSlot(b.date)!==null&&Number.isFinite(b.price)&&b.price>0)unique.set(b.date,b);
 const bars=[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
 const W=960,H=450,L=64,R=66,T=26,B=298,V=329,VB=411,P=W-L-R;
 const prev=Number.isFinite(prevClose)&&prevClose>0?prevClose:null;
 const vals=bars.flatMap(b=>[b.price,...(Number.isFinite(b.avg)&&b.avg>0?[b.avg]:[])]);
 const lo=Math.min(...vals),hi=Math.max(...vals),mid=prev??(hi+lo)/2,span=Math.max(Math.abs(hi-mid),Math.abs(lo-mid),mid*.003)*1.08;
 const x=s=>L+s/240*P,y=p=>T+(mid+span-p)/(2*span)*(B-T);
 const point=(b,p)=>x(minuteSlot(b.date)).toFixed(2)+','+y(p).toFixed(2);
 const maxVol=Math.max(1,...bars.map(b=>Number.isFinite(b.volume)&&b.volume>=0?b.volume:0));
 const segments=(selector)=>{let out=[],part=[],last=null;for(const b of bars){
  const slot=minuteSlot(b.date),v=selector(b);
  if(last!==null&&(slot-last>1||slot===last)){if(part.length)out.push(part);part=[];}
  if(!Number.isFinite(v)||v<=0){if(part.length)out.push(part);part=[];}else part.push(point(b,v));
  last=slot;
 }if(part.length)out.push(part);return out;};
 let svg='<svg class="market-svg minute-svg" viewBox="0 0 960 450" role="img" aria-label="真实分时价格、涨跌幅、均价和成交量"><g class="minute-grid">';
 for(let i=0;i<=4;i++){
  const v=mid+span-i*span/2,yy=y(v),pct=prev?(v/prev-1)*100:null;
  const color=i===2?'var(--chart-label)':i<2?'#e65f74':'#4ac3a6';
  svg+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'" stroke="'+(i===2&&prev?'#b9a07c':'var(--chart-grid)')+'" stroke-dasharray="4 4"/><text x="'+(L-8)+'" y="'+(yy+4)+'" text-anchor="end" font-size="12" fill="'+color+'">'+fmt(v)+'</text>';
  if(pct!==null)svg+='<text x="'+(W-R+7)+'" y="'+(yy+4)+'" font-size="12" fill="'+color+'">'+(pct>0?'+':'')+fmt(pct)+'%</text>';
 }
 for(const [s,label] of [[0,'09:30'],[60,'10:30'],[120,'11:30 / 13:00'],[180,'14:00'],[240,'15:00']]){
  svg+='<line x1="'+x(s)+'" x2="'+x(s)+'" y1="'+T+'" y2="'+VB+'" stroke="var(--chart-grid)" stroke-dasharray="3 5"/><text x="'+x(s)+'" y="435" font-size="11" text-anchor="middle" fill="var(--chart-label)">'+label+'</text>';
 }
 svg+='</g><line x1="'+L+'" x2="'+(W-R)+'" y1="'+(V-9)+'" y2="'+(V-9)+'" stroke="var(--chart-divider)"/><text x="8" y="'+(V+11)+'" fill="var(--chart-label)" font-size="11">成交量</text><text x="'+(L-8)+'" y="'+(V+26)+'" text-anchor="end" fill="var(--chart-label)" font-size="10">'+shortVol(maxVol)+'</text>';
 for(const [sel,color,width] of [[b=>b.price,'var(--chart-primary)',2.2],[b=>b.avg,'var(--chart-secondary)',1.5]]){
  for(const p of segments(sel))svg+=p.length===1?'<circle cx="'+p[0].split(',')[0]+'" cy="'+p[0].split(',')[1]+'" r="2" fill="'+color+'"/>':'<polyline points="'+p.join(' ')+'" fill="none" stroke="'+color+'" stroke-width="'+width+'"/>';
 }
 bars.forEach((b,i)=>{
  const xx=x(minuteSlot(b.date)),vol=Number.isFinite(b.volume)&&b.volume>=0?b.volume:0,h=vol/maxVol*(VB-V);
  const reference=i?bars[i-1].price:prev??b.price,color=b.price>reference?'#e65f74':b.price<reference?'#4ac3a6':'#8491a3';
  svg+='<rect x="'+(xx-1.3)+'" y="'+(VB-h)+'" width="2.6" height="'+h+'" fill="'+color+'" opacity=".85"/>';
 });
 const last=bars.at(-1),px=x(minuteSlot(last.date)),py=y(last.price);
 svg+='<circle cx="'+px+'" cy="'+py+'" r="4" fill="var(--chart-primary)" stroke="var(--chart-grid)"/><g class="minute-crosshair" visibility="hidden" pointer-events="none"><line class="minute-cross-x" y1="'+T+'" y2="'+VB+'" stroke="var(--chart-label)" stroke-dasharray="4 3"/><line class="minute-cross-y" x1="'+L+'" x2="'+(W-R)+'" stroke="var(--chart-label)" stroke-dasharray="4 3"/><circle class="minute-cross-dot" r="4" fill="var(--chart-primary)"/></g>';
 for(const b of bars){
  const xx=x(minuteSlot(b.date)),yy=y(b.price),pct=prev?fmt((b.price/prev-1)*100)+'%':'--';
  const label=b.date.slice(11)+' · 价格 '+fmt(b.price)+' · 涨跌 '+pct+' · 均价 '+fmt(b.avg)+' · 量 '+(Number.isFinite(b.volume)?shortVol(b.volume):'--');
  svg+='<rect class="minute-hit" x="'+(xx-1.8)+'" y="'+T+'" width="3.6" height="'+(VB-T)+'" fill="transparent" data-x="'+xx+'" data-y="'+yy+'" data-detail="'+label+'"><title>'+label+'</title></rect>';
 }
 return '<div class="minute-detail" aria-live="polite">'+date+' · '+last.date.slice(11)+' · 价格 '+fmt(last.price)+' · 涨跌 '+(prev?fmt((last.price/prev-1)*100)+'%':'--')+' · 均价 '+fmt(last.avg)+' · 成交量 '+(Number.isFinite(last.volume)?shortVol(last.volume):'--')+'</div>'+svg+'</svg><div class="minute-note">固定交易时段 · 午休压缩 · 未取得的时段留白 · 触碰/悬停查看真实分钟数据</div>';
}
export function showMinutePoint(target){
 if(!target?.classList?.contains('minute-hit'))return;
 const svg=target.closest('svg'),x=target.dataset.x,y=target.dataset.y,c=svg.querySelector('.minute-crosshair');
 c.setAttribute('visibility','visible');
 const v=svg.querySelector('.minute-cross-x'),h=svg.querySelector('.minute-cross-y'),dot=svg.querySelector('.minute-cross-dot');
 v.setAttribute('x1',x);v.setAttribute('x2',x);h.setAttribute('y1',y);h.setAttribute('y2',y);dot.setAttribute('cx',x);dot.setAttribute('cy',y);
 const detail=svg.previousElementSibling;if(detail?.classList.contains('minute-detail'))detail.textContent=target.dataset.detail;
}
export function chartSvg(bars,period="minute",prevClose=null){
 if(!Array.isArray(bars)||bars.length===0)return '<div class="chart-empty">暂无真实行情图表数据，请稍后刷新。</div>';
 if(period==='minute')return minuteChartSvg(bars,prevClose);
 const isMinute=period==="minute",W=960,H=384,left=58,right=16,top=20,bottom=38,volumeTop=300,priceBottom=276,plotW=W-left-right,plotH=priceBottom-top;
 const vals=isMinute?bars.map(b=>b.price):bars.flatMap(b=>[b.high,b.low]);
 const withPrev=isMinute&&Number.isFinite(prevClose)&&prevClose>0?[prevClose]:[];
 const lo=Math.min(...vals,...withPrev),hi=Math.max(...vals,...withPrev),margin=Math.max((hi-lo)*.09,hi*.002),min=lo-margin,max=hi+margin,span=max-min||1;
 const x=i=>left+(i+0.5)*plotW/bars.length;
 const y=p=>top+(max-p)/span*plotH;
 const maxVol=Math.max(1,...bars.map(b=>b.volume||0)),vw=Math.max(1,plotW/bars.length*.62);
 let out='<svg class="market-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+(isMinute?'真实分时走势图及分钟成交量':'真实'+(period==="day"?'日':period==="week"?'周':'月')+'K线与成交量')+'">';
 for(let i=0;i<=4;i++){
  const gy=top+plotH*i/4,value=max-span*i/4;
  out+='<line x1="'+left+'" x2="'+(W-right)+'" y1="'+gy+'" y2="'+gy+'" stroke="var(--chart-grid)" stroke-dasharray="3 5"/>';
  out+='<text x="'+(left-8)+'" y="'+(gy+4)+'" fill="var(--chart-label)" font-size="12" text-anchor="end">'+value.toFixed(2)+'</text>';
 }
 if(isMinute){
  if(Number.isFinite(prevClose)&&prevClose>0){
   const gy=y(prevClose);
   out+='<line x1="'+left+'" x2="'+(W-right)+'" y1="'+gy+'" y2="'+gy+'" stroke="#b9a07c" stroke-dasharray="5 5"/>';
  }
  out+='<polyline fill="none" stroke="var(--chart-primary)" stroke-width="2.3" points="'+bars.map((b,i)=>x(i).toFixed(1)+','+y(b.price).toFixed(1)).join(' ')+'"/>';
  const avgPoints=bars.filter(b=>Number.isFinite(b.avg)&&b.avg>0);
  if(avgPoints.length>1)out+='<polyline fill="none" stroke="var(--chart-secondary)" stroke-width="1.5" points="'+bars.map((b,i)=>Number.isFinite(b.avg)&&b.avg>0?x(i).toFixed(1)+','+y(b.avg).toFixed(1):null).filter(Boolean).join(' ')+'"/>';
 }else{
  const step=plotW/bars.length,bodyW=Math.max(1,Math.min(10,step*.65));
  bars.forEach((b,i)=>{
   const up=b.close>=b.open,color=up?"#e65f74":"#4ac3a6",xx=x(i),yy=Math.min(y(b.open),y(b.close)),hh=Math.max(1,Math.abs(y(b.close)-y(b.open)));
   out+='<line x1="'+xx+'" x2="'+xx+'" y1="'+y(b.high)+'" y2="'+y(b.low)+'" stroke="'+color+'" stroke-width="1.3"/>';
   out+='<rect x="'+(xx-bodyW/2)+'" y="'+yy+'" width="'+bodyW+'" height="'+hh+'" fill="'+color+'"/>';
  });
  [[5,"var(--chart-ma5)"],[10,"var(--chart-ma10)"],[20,"var(--chart-ma20)"]].forEach(pair=>{
   const averages=movingAverage(bars,pair[0]);
   const points=averages.map((v,i)=>v===null?null:x(i).toFixed(1)+','+y(v).toFixed(1)).filter(Boolean);
   if(points.length)out+='<polyline fill="none" stroke="'+pair[1]+'" stroke-width="1.6" points="'+points.join(' ')+'"/>';
  });
 }
 bars.forEach((b,i)=>{
  const xx=x(i),volH=Math.max(0,(Number(b.volume)||0)/maxVol*54),color=isMinute?(i===0||b.price>=bars[Math.max(0,i-1)].price?"#d56d7d":"#4ac3a6"):(b.close>=b.open?"#d56d7d":"#4ac3a6");
  out+='<rect x="'+(xx-vw/2)+'" y="'+(volumeTop+56-volH)+'" width="'+vw+'" height="'+volH+'" fill="'+color+'" opacity=".76"/>';
 });
 const tickCount=Math.min(6,bars.length),tickIndices=[...new Set(Array.from({length:tickCount},(_,i)=>Math.round(i*(bars.length-1)/Math.max(1,tickCount-1))))];
 for(const i of tickIndices){
  const label=isMinute?String(bars[i].date).slice(11,16):String(bars[i].date).slice(2);
  out+='<text x="'+x(i)+'" y="'+(H-10)+'" text-anchor="middle" fill="var(--chart-label)" font-size="11">'+label+'</text>';
 }
 out+='<line x1="'+left+'" y1="'+(volumeTop-5)+'" x2="'+(W-right)+'" y2="'+(volumeTop-5)+'" stroke="var(--chart-divider)"/>';
 out+='<text x="12" y="'+(volumeTop+11)+'" fill="var(--chart-label)" font-size="11">成交量</text>';
 out+='</svg>';
 return out;
}
