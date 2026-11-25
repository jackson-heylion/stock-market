#!/usr/bin/env python3
"""Bounded public Guba title snapshot; no logins, user identifiers, or full texts."""
from datetime import datetime, timezone, timedelta
from pathlib import Path
import json, re, time, urllib.request, urllib.parse, urllib.error, urllib.robotparser, html
from concurrent.futures import ThreadPoolExecutor
from forum_sources import collect_forum
ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'data' / 'community.json'
NOW = datetime.now(timezone.utc)
CN = timezone(timedelta(hours=8))
HOST = 'https://guba.eastmoney.com'
UA = 'StockMarketResearchSnapshot/1.0'
BASE = {'zssh000001':'上证指数','zssz399006':'创业板指','300308':'中际旭创','300476':'胜宏科技',
        '601133':'柏诚股份','300829':'金丹科技','603931':'格林达','600156':'华升股份',
        '600520':'三佳科技','301348':'蓝箭电子','002579':'中京电子'}
def fetch(url, limit=2_500_000):
    req = urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'text/html,application/json,*/*'})
    with urllib.request.urlopen(req,timeout=12) as r:
        if urllib.parse.urlparse(r.geturl()).hostname != 'guba.eastmoney.com':
            raise ValueError('unexpected redirect')
        return r.read(limit).decode('utf-8','replace')
def post_time(value):
    try:
        if isinstance(value,(int,float)) or str(value).isdigit():
            t=float(value); t=t/1000 if t>1e12 else t
            return datetime.fromtimestamp(t,timezone.utc)
        t=datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return t.replace(tzinfo=CN) if t.tzinfo is None else t
    except (ValueError,OverflowError,OSError,TypeError):
        return None
def article_arrays(raw):
    # Public list pages embed JSON. Match arrays by actual post schema, not arbitrary links.
    decoder=json.JSONDecoder()
    for m in re.finditer(r'\[\s*\{\s*"post_(?:id|title|type|publish_time|stockbar_code)"',raw):
        try:
            value,_=decoder.raw_decode(raw[m.start():])
            if isinstance(value,list): yield value
        except ValueError: pass
    # Some versions place the list in an object with an earlier non-post key.
    for m in re.finditer(r'"(?:re|data|list|posts|article_list|post_list|articleList)"\s*:\s*(\[)',raw):
        try:
            value,_=decoder.raw_decode(raw[m.start(1):])
            if isinstance(value,list): yield value
        except ValueError: pass
def counter(v):
    try:
        n=int(v)
        return n if 0<=n<=10**9 else None
    except (TypeError,ValueError): return None
def normalize(rows,code,board,now=NOW):
    out={}
    for p in rows:
        if not isinstance(p,dict): continue
        pid=str(p.get('post_id') or p.get('postid') or '')
        title=html.unescape(re.sub(r'<[^>]*>','',str(p.get('post_title') or ''))).strip()
        t=post_time(p.get('post_publish_time'))
        bar=str(p.get('post_stockbar_code') or code)
        if not re.fullmatch(r'\d{5,20}',pid) or len(title)<2 or bar!=code or not t or t>now or now-t>timedelta(hours=24):
            continue
        # Explicitly exclude known publisher/announcement/forwarded article types and author names.
        # No author identifier is persisted.
        typ=p.get('post_type')
        name=str(p.get('post_user',{}).get('user_nickname','') if isinstance(p.get('post_user'),dict) else '')
        name=name or str(p.get('user_nickname') or '')
        if str(typ)!='0' or re.search(r'(资讯|公告|研报|东方财富资讯)',name) or re.search(r'^(公告|研报|资讯)[：:]|^.{1,20}:关于',title):
            continue
        out[pid]={'id':pid,'title':title[:160],'publishedAt':t.isoformat(),'board':board,'code':code,
                  'url':HOST+'/news,'+code+','+pid+'.html','reads':counter(p.get('post_click_count',p.get('post_read_count'))),
                  'comments':counter(p.get('post_comment_count',p.get('post_comments_count'))),
                  'source':'东方财富股吧'}
    return list(out.values())
def collect(code,board,robots):
    url=HOST+'/list,'+code+',f.html'
    if not robots.can_fetch(UA,url):
        return [],{'code':code,'board':board,'status':'blocked','error':'robots disallows public list'}
    try:
        raw=fetch(url)
        rows=[p for arr in article_arrays(raw) for p in arr]
        if not rows: raise ValueError('no recognized public post list')
        data=normalize(rows,code,board)
        return data,{'code':code,'board':board,'status':'ok','count':len(data)}
    except Exception as e:
        return [],{'code':code,'board':board,'status':'unavailable','error':str(e)[:100]}
def build():
    robots=urllib.robotparser.RobotFileParser()
    try:
        try:
            robots.parse(fetch(HOST+'/robots.txt',100_000).splitlines())
        except urllib.error.HTTPError as he:
            if he.code == 404:
                robots.parse([])
            else:
                raise
        # Respect declared crawl delay; bounded sequential requests, no circumvention.
        delay=max(2,robots.crawl_delay(UA) or robots.crawl_delay('*') or 0)
        boards=dict(BASE)
        try:
            bot=json.loads((ROOT/'data'/'bot.json').read_text())
            for c in list(bot.get('holdings',{}).values())+bot.get('openFive',{}).get('candidates',[]):
                if isinstance(c,dict) and re.fullmatch(r'\d{6}',str(c.get('code',''))):
                    boards[str(c['code'])]=str(c.get('name') or c['code'])[:30]
        except Exception: pass
        posts=[];statuses=[]
        for i,(code,board) in enumerate(list(boards.items())[:16]):
            if i: time.sleep(delay)
            rows,status=collect(code,board,robots);posts.extend(rows);statuses.append(status)
    except Exception as e:
        posts=[];statuses=[{'code':'','board':'股吧','status':'unavailable','error':'robots/source unavailable: '+str(e)[:100]}]
    # Independent sources: a blocked Guba endpoint must not block other communities.
    with ThreadPoolExecutor(max_workers=2) as pool:
        for rows,status in pool.map(lambda key:collect_forum(key,NOW), ('hupu','tgb')):
            posts.extend(rows);statuses.append(status)
    for status in statuses:
        status.setdefault('source','东方财富股吧')
    fresh_count=len(posts)
    try:
        prior=json.loads(DEST.read_text(encoding='utf-8'))
        previous=[p for p in prior.get('posts',[]) if (t:=post_time(p.get('publishedAt'))) and t<=NOW and NOW-t<=timedelta(hours=24)]
    except Exception:
        prior={};previous=[]
    posts=sorted({(p['source'],p['id']):p for p in previous+posts}.values(),key=lambda p:datetime.fromisoformat(p['publishedAt']),reverse=True)[:700]
    collected_at=datetime.now(timezone.utc).isoformat()
    payload={'schema':1,'fetchedAt':collected_at if fresh_count else prior.get('fetchedAt') or collected_at,'checkedAt':collected_at,'source':'公开财经社区讨论样本（股吧、虎扑、淘股吧）',
             'state':'fresh' if fresh_count else 'stale' if posts else 'unavailable','boards':statuses,'posts':posts}
    DEST.parent.mkdir(parents=True,exist_ok=True)
    DEST.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print('community posts:',len(posts),'boards:',len(statuses))
    print(json.dumps(statuses,ensure_ascii=False))
if __name__=='__main__': build()
