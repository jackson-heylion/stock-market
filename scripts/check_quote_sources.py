#!/usr/bin/env python3
"""Smoke-test anonymous quote sources from the GitHub Actions runner (not a mainland probe)."""
import json, re, time, urllib.request, urllib.error
from datetime import datetime, timezone
symbols = "sh601133,sz300829,sh603931,sh600156,sz000635,sh600520,sz301348,sz002579"
secids = "1.601133,0.300829,1.603931,1.600156,0.000635,1.600520,0.301348,0.002579"
urls = {
  "tencent": ("https://qt.gtimg.cn/q=" + symbols, {}),
  "sina": ("https://hq.sinajs.cn/list=" + symbols, {"Referer":"https://finance.sina.com.cn/"}),
  "eastmoney": ("https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=" + secids + "&fields=f12,f14,f2,f3,f4,f5,f6,f86", {"Referer":"https://quote.eastmoney.com/"}),
}
for name, (url, extra) in urls.items():
  start=time.perf_counter()
  headers={"User-Agent":"Mozilla/5.0 (compatible; QuoteSourceSmokeTest/1.0)", "Origin":"https://jackson-heylion.github.io", **extra}
  try:
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=12) as r:
      data=r.read(500000)
      status=r.status
      cors=r.headers.get("Access-Control-Allow-Origin")
      content_type=r.headers.get("Content-Type")
    txt=data.decode("utf-8" if name=="eastmoney" else "gb18030",errors="replace")
    matches=[]
    if name=="tencent":
      for code,raw in re.findall(r'v_((?:sh|sz)\d{6})="([^"\n]+)"',txt):
        f=raw.split("~")
        if len(f)>30: matches.append({"code":code,"name":f[1],"price":f[3],"quote_time":f[30]})
    elif name=="sina":
      for code,raw in re.findall(r'var hq_str_((?:sh|sz)\d{6})="([^"\n]+)"',txt):
        f=raw.split(",")
        if len(f)>31: matches.append({"code":code,"name":f[0],"price":f[3],"quote_time":f[30]+" "+f[31]})
    else:
      try:
        for obj in (json.loads(txt).get("data") or {}).get("diff") or []:
          matches.append({"code":obj.get("f12"),"name":obj.get("f14"),"price":obj.get("f2"),"quote_time_raw":obj.get("f86")})
      except (ValueError,TypeError,AttributeError): pass
    valid=sum(1 for x in matches if str(x.get("price","")).replace(".","",1).isdigit() and float(x["price"])>0)
    result={"name":name,"status":status,"elapsed_ms":round((time.perf_counter()-start)*1000),"bytes":len(data),"parsed":len(matches),"valid_prices":valid,"sample":matches[:2],"cors_allow_origin":cors,"cors_for_pages":cors in ("*","https://jackson-heylion.github.io"),"content_type":content_type,"body_prefix_if_invalid":None if matches else txt[:120]}
  except Exception as e:
    result={"name":name,"status":"ERROR","elapsed_ms":round((time.perf_counter()-start)*1000),"error":repr(e)[:250]}
  result["checked_utc"]=datetime.now(timezone.utc).isoformat()
  print(json.dumps(result,ensure_ascii=False),flush=True)

# Verify separate chart hosts: a successful quote does not prove that minute/Kline CORS works.
chart_endpoints = {
 "minute": "https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=1.601133&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0",
 "daily": "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.601133&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&beg=20200101&end=20500101&lmt=140",
}
for name, url in chart_endpoints.items():
 start=time.perf_counter()
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0","Origin":"https://jackson-heylion.github.io","Referer":"https://quote.eastmoney.com/"}),timeout=12) as response:
   status=response.status
   cors=response.headers.get("Access-Control-Allow-Origin")
   obj=json.loads(response.read(500000).decode("utf-8"))
  row=(obj.get("data") or {})
  data=row.get("trends") if name=="minute" else row.get("klines")
  result={"name":name,"status":status,"parsed":len(data or []),"sample":(data or [])[:1],
    "cors_allow_origin":cors,"cors_for_pages":cors in ("*","https://jackson-heylion.github.io"),
    "elapsed_ms":round((time.perf_counter()-start)*1000)}
 except Exception as err:
  result={"name":name,"status":"ERROR","error":repr(err)[:250]}
 print(json.dumps(result,ensure_ascii=False),flush=True)

# Market center / indices diagnostic. Unofficial Eastmoney discovery endpoints.
market_urls={
 "indices_tencent":"https://qt.gtimg.cn/q=sh000001,sz399001,sz399006,sh000688,sh000300",
 "market_gainers":"https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f5,f6,f12,f13,f14,f15,f16,f17,f18",
 "market_losers":"https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=0&np=1&fltt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f5,f6,f12,f13,f14,f15,f16,f17,f18",
 "market_turnover":"https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&fid=f6&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f5,f6,f12,f13,f14,f15,f16,f17,f18",
 "sector_industry":"https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=15&po=1&np=1&fltt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f5,f6,f12,f13,f14",
 "breadth_sse":"https://push2.eastmoney.com/api/qt/stock/get?invt=2&fltt=2&fields=f43,f57,f58,f104,f105,f106,f47,f48&secid=1.000001",
 "breadth_szse":"https://push2.eastmoney.com/api/qt/stock/get?invt=2&fltt=2&fields=f43,f57,f58,f104,f105,f106,f47,f48&secid=0.399001",
}
for name,url in market_urls.items():
 start=time.perf_counter()
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0","Origin":"https://jackson-heylion.github.io","Referer":"https://quote.eastmoney.com/"}),timeout=12) as response:
   status=response.status
   cors=response.headers.get("Access-Control-Allow-Origin")
   txt=response.read(700000).decode("gb18030" if name=="indices_tencent" else "utf-8",errors="replace")
  if name=="indices_tencent":
   sample=[x for x in re.findall(r'(v_(?:sh|sz)\\d{6}="[^"]+")',txt)][:2]
   summary={"count":txt.count("v_"),"sample":sample}
  else:
   obj=json.loads(txt)
   data=obj.get("data") or {}
   diff=data.get("diff") or []
   summary={"total":data.get("total"),"count":len(diff) if isinstance(diff,list) else 0,"sample":diff[:2] if isinstance(diff,list) else data}
  out={"name":name,"status":status,"elapsed_ms":round((time.perf_counter()-start)*1000),
   "cors":cors,"cors_for_pages":cors in ("*","https://jackson-heylion.github.io"),"result":summary}
 except Exception as err:out={"name":name,"status":"ERROR","error":repr(err)[:200]}
 print(json.dumps(out,ensure_ascii=False),flush=True)

# Show actual index payload and market breadth fields rather than misinterpreting null diff.
for name,url in [("breadth_payload","https://push2.eastmoney.com/api/qt/stock/get?invt=2&fltt=2&fields=f43,f57,f58,f104,f105,f106,f47,f48&secid=1.000001"),
("index_tencent_sample","https://qt.gtimg.cn/q=sh000001,sz399001")]:
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0","Origin":"https://jackson-heylion.github.io"}),timeout=10) as resp:
   body=resp.read(100000).decode("gb18030",errors="replace")
  obj=json.loads(body) if name=="breadth_payload" else body[:300]
  print(json.dumps({"name":name,"payload":obj},ensure_ascii=False),flush=True)
 except Exception as err:print(json.dumps({"name":name,"error":str(err)},ensure_ascii=False),flush=True)

# Can the market-wide A-share list be retrieved to compute breadth with a complete denominator?
try:
 u="https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=6000&po=1&np=1&fltt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f3,f6,f12,f13"
 ts=time.perf_counter()
 with urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":"Mozilla/5.0","Origin":"https://jackson-heylion.github.io"}),timeout=20) as rr:
  body=rr.read(3000000)
  cors=rr.headers.get("Access-Control-Allow-Origin")
 data=json.loads(body.decode("utf-8")).get("data") or {}
 items=data.get("diff") or []
 print(json.dumps({"name":"market_breadth_full_probe","total":data.get("total"),"count":len(items),
 "up":sum(1 for x in items if isinstance(x.get("f3"),(int,float)) and x["f3"]>0),
 "down":sum(1 for x in items if isinstance(x.get("f3"),(int,float)) and x["f3"]<0),
 "flat":sum(1 for x in items if isinstance(x.get("f3"),(int,float)) and x["f3"]==0),
 "body_bytes":len(body),"elapsed_ms":round((time.perf_counter()-ts)*1000),
 "cors_for_pages":cors in ("*","https://jackson-heylion.github.io")},ensure_ascii=False),flush=True)
except Exception as err:print(json.dumps({"name":"market_breadth_full_probe","error":repr(err)[:300]}),flush=True)

# Near-close read-only paper-portfolio snapshot; keeps raw source timestamps.
try:
 from datetime import datetime
 code_ref={"601133":17.33,"300829":27.00,"603931":29.15,"600156":8.90,
  "600520":22.17,"301348":21.66,"002579":12.17}
 now=datetime.now(timezone.utc)
 with urllib.request.urlopen(urllib.request.Request(
  "https://qt.gtimg.cn/q=sh601133,sz300829,sh603931,sh600156,sh600520,sz301348,sz002579,sz000635,sh000001,sz399006",
  headers={"User-Agent":"Mozilla/5.0","Origin":"https://jackson-heylion.github.io"}),timeout=12) as response:
  raw=response.read(100000).decode("gb18030",errors="replace")
 rows=[]
 for code,body in re.findall(r'v_((?:sh|sz)\d{6})="([^"\n]+)"',raw):
  f=body.split("~")
  if len(f)<32:continue
  try:
   price,prev=float(f[3]),float(f[4]);qty_ref=code_ref.get(code[2:])
   row={"name":f[1],"code":code[2:],"current":price,"prev":prev,
    "pct":round((price/prev-1)*100,2) if prev else None,
    "high":f[33] if len(f)>33 else None,"low":f[34] if len(f)>34 else None,
    "quote_ts":f[30],"initial_entry":qty_ref,
    "entry_return_pct":round((price/qty_ref-1)*100,2) if qty_ref and price>0 else None}
   rows.append(row)
  except (ValueError,ZeroDivisionError):continue
 print(json.dumps({"name":"tail_manual_portfolio","checked_utc":now.isoformat(),"quotes":rows},ensure_ascii=False),flush=True)
 print(json.dumps({"name":"tail_strategy_live_audit","quote_count":len(rows),
  "quote_dates":sorted(set(str(x["quote_ts"])[:8] for x in rows)),
  "quote_min_time":min((x["quote_ts"] for x in rows),default=None),
  "quote_max_time":max((x["quote_ts"] for x in rows),default=None)},
  ensure_ascii=False),flush=True)
except Exception as err:
 print(json.dumps({"name":"tail_manual_portfolio","error":repr(err)[:350]},ensure_ascii=False),flush=True)
