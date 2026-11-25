#!/usr/bin/env python3
"""Build a same-origin, provenance-stamped public news snapshot for GitHub Pages.

GitHub Pages cannot run a proxy. The public news hostname may work in CI but be
blocked by end-user networks, so publish a best-effort, bounded snapshot.
Never fabricate titles or change the original source publication timestamp.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "data" / "fast-news.json"
PUBLISHED = "https://jackson-heylion.github.io/stock-market/data/fast-news.json"
ORIGIN = "https://np-weblist.eastmoney.com/comm/web/getFastNewsList"
ALT_ORIGIN = "https://np-listapi.eastmoney.com/comm/web/getFastNewsList"
THS_ORIGIN = "https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website"
NOW = datetime.now(timezone.utc)
TZ_CN = timezone(timedelta(hours=8))
def valid_articles(raw):
    if not isinstance(raw, dict):
        return []
    if isinstance(raw.get("articles"), list):
        rows = raw["articles"]
    elif isinstance((raw.get("data") or {}).get("fastNewsList"), list):
        rows = raw["data"]["fastNewsList"]
    elif isinstance((raw.get("data") or {}).get("list"), list):
        rows = []
        for x in raw["data"]["list"]:
            if not isinstance(x, dict):
                continue
            try:
                sec = int(x.get("ctime") or x.get("rtime") or 0)
            except (TypeError, ValueError):
                continue
            if sec <= 1500000000:
                continue
            rows.append({
                "id": str(x.get("id") or x.get("seq") or ""),
                "title": x.get("title") or "",
                "showTime": datetime.fromtimestamp(sec, TZ_CN).strftime("%Y-%m-%d %H:%M:%S")
            })
    else:
        rows = []
    if not isinstance(rows, list):
        return []
    found = set()
    result = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()[:160]
        show_time = str(item.get("showTime") or "").strip()
        try:
            timestamp = datetime.strptime(show_time, "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ_CN)
        except ValueError:
            continue
        if len(title) < 4 or title in found or timestamp > NOW + timedelta(minutes=5) or NOW-timestamp > timedelta(hours=24):
            continue
        found.add(title)
        result.append({
            "id": str(item.get("code") or item.get("id") or title)[:70],
            "title": title,
            "showTime": show_time
        })
    return sorted(result, key=lambda x:x["showTime"], reverse=True)[:100]

def fetch_json(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; StockMarket-NewsSnapshot/1.0)",
        "Accept": "application/json,text/plain,*/*",
        "Referer": "https://kuaixun.eastmoney.com/",
    })
    with urllib.request.urlopen(req, timeout=13) as response:
        return json.loads(response.read(450000).decode("utf-8"))

def build():
    params = urllib.parse.urlencode({
        "client": "web", "biz": "web_724", "fastColumn": "102",
        "sortEnd": "", "pageSize": "100", "req_trace": str(time.time_ns())
    })
    source = "东方财富7×24快讯"
    try:
        source_articles = []
        last_err = None
        for endpoint, label in [
            (ORIGIN + "?" + params, "东方财富7×24快讯"),
            (ALT_ORIGIN + "?" + params, "东方财富7×24快讯"),
            (THS_ORIGIN, "同花顺7×24快讯"),
        ]:
            try:
                candidate = valid_articles(fetch_json(endpoint))
                if candidate:
                    source_articles = candidate
                    source = label
                    break
            except Exception as err:
                last_err = err
        if not source_articles:
            raise RuntimeError(f"Upstream returned no validated news headlines: {last_err}")
        try:
            previous = valid_articles(json.loads(DEST.read_text(encoding='utf-8')))
        except Exception:
            previous = []
        articles = valid_articles({'articles':source_articles+previous})
        fetched_at = NOW.isoformat()
        state = "fresh"
    except Exception as e:
        print("Primary news source failed:", str(e)[:200])
        # The previously published snapshot is still authentic. Retain its
        # original fetch timestamp; never relabel it as current data.
        try:
            prior = json.loads(DEST.read_text(encoding='utf-8')) if DEST.exists() else fetch_json(PUBLISHED+"?v="+str(int(time.time())))
            articles = valid_articles(prior)
            fetched_at = str(prior.get("fetchedAt") or "")
            original = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
            if not articles or NOW-original > timedelta(hours=24) or original > NOW+timedelta(minutes=5):
                raise ValueError("Previously published news is absent or too old")
            state = "stale"
        except Exception as e2:
            print("Previous Pages snapshot unavailable:", str(e2)[:160])
            articles, fetched_at, state = [], NOW.isoformat(), "unavailable"
    output = {
        "schema": 1, "source": source,
        "fetchedAt": fetched_at, "buildAt": NOW.isoformat(),
        "state": state, "articles": articles,
        "description": "Public 7x24 financial news titles, not social-media sentiment."
    }
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(output, ensure_ascii=False, separators=(",",":")), encoding="utf-8")
    print(json.dumps({"artifact":str(DEST.relative_to(ROOT)), "state":state,
        "source":source, "count":len(articles), "fetchedAt":fetched_at}, ensure_ascii=False))
if __name__ == "__main__":
    build()
