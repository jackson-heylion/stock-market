#!/usr/bin/env python3
"""Non-destructive network/CORS probe for the watchlist's public market panels."""
import concurrent.futures,json,time,urllib.request,urllib.error
base="https://push2.eastmoney.com/api/qt/clist/get"
fs="m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"
urls={
"speed_f22":f"{base}?pn=1&pz=30&po=1&np=1&fltt=2&invt=2&fid=f22&fs={fs}&fields=f2,f3,f6,f12,f13,f14,f22,f124",
"speed_f22_ascending":f"{base}?pn=1&pz=20&po=0&np=1&fltt=2&invt=2&fid=f22&fs={fs}&fields=f2,f3,f6,f12,f13,f14,f22,f124",
"sector_heat":f"{base}?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f6,f8,f12,f13,f14,f22,f62,f124",
"stock_changes":"https://push2ex.eastmoney.com/getAllStockChanges?type=8201,8202,8193,4,32,64,8207,8209,8211,8213,8215,8204,8203,8194,8,16,128,8208,8210,8212,8214,8216&ut=7eea3edcaed734bea9cbfc24409ed989&pageindex=0&pagesize=60&dpt=wzchanges",
"news_weblist":"https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=30",
"news_listapi":"https://np-listapi.eastmoney.com/nlist/api/list/get?client=web&column_id=102&limit=30&last_time=",
"news_list_compat":"https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=30"
}
def test(arg):
 name,url=arg;start=time.perf_counter()
 try:
  req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0","Origin":"https://jackson-heylion.github.io","Referer":"https://quote.eastmoney.com/","Accept":"application/json,text/plain,*/*"})
  with urllib.request.urlopen(req,timeout=14) as res:
   body=res.read(400000);status=res.status;cors=res.headers.get('Access-Control-Allow-Origin');ctype=res.headers.get('Content-Type')
  s=body.decode("utf-8",errors="replace");summary={}
  try:
   o=json.loads(s);d=o.get('data')
   summary["topKeys"]=list(o.keys())[:12]
   if isinstance(d,dict):
    summary["dataKeys"]=list(d.keys())[:14]
    for k in ("diff","allstock","fastNewsList","list","items","rows","news","data"):
     v=d.get(k)
     if isinstance(v,list):
      summary[k+"Count"]=len(v);summary[k+"Sample"]=v[:1]
    for k in ("total","count","totalCount","last_time"):
     if k in d: summary[k]=d[k]
   elif isinstance(d,list):summary["arrayLength"]=len(d);summary["sample"]=d[:1]
   else:summary["dataSample"]=str(d)[:600]
  except Exception:summary["bodyPrefix"]=s[:700]
  return {"name":name,"status":status,"ms":round((time.perf_counter()-start)*1000),"cors":cors,
   "corsForPage":cors in ("*","https://jackson-heylion.github.io"),"ctype":ctype,"bytes":len(body),"result":summary}
 except Exception as e:return {"name":name,"error":repr(e)[:280],"ms":round((time.perf_counter()-start)*1000)}
with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
 for v in pool.map(test,urls.items()):print(json.dumps(v,ensure_ascii=False),flush=True)
