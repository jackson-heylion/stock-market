export function movingAverage(bars,period){
 return bars.map((x,i)=>i+1<period?null:bars.slice(i+1-period,i+1).reduce((v,b)=>v+b.close,0)/period);
}

export function chartSvg(bars,period="minute",prevClose=null){
 if(!Array.isArray(bars)||bars.length===0)return '<div class="chart-empty">暂无真实行情图表数据，请稍后刷新。</div>';
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
