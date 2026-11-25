"""Public forum list adapters. Do not follow individual user profiles or bypass access controls."""
import re, urllib.request, urllib.parse, urllib.robotparser
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
CN=timezone(timedelta(hours=8))
UA='StockMarketResearchSnapshot/1.0'
SOURCES={
 'hupu':{'host':'bbs.hupu.com','url':'https://bbs.hupu.com/stock','name':'虎扑','board':'虎扑股票区','kind':'activity','path':r'/(\d{5,20})\.html'},
 'tgb':{'host':'www.tgb.cn','url':'https://www.tgb.cn/bbs/1/1','name':'淘股吧','board':'淘股吧社区总版','kind':'published','path':r'/a/([A-Za-z0-9]{5,30})'}
}
class Node:
 def __init__(self,tag='',attrs=(),parent=None):
  self.tag=tag;self.attrs=dict(attrs);self.parent=parent;self.children=[]
 def text(self):
  return ' '.join(x.text() if isinstance(x,Node) else x for x in self.children).strip()
 def walk(self):
  yield self
  for x in self.children:
   if isinstance(x,Node): yield from x.walk()
class Tree(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=True);self.root=Node();self.cur=self.root
 def handle_starttag(self,tag,attrs):
  n=Node(tag,attrs,self.cur);self.cur.children.append(n)
  if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}: self.cur=n
 def handle_startendtag(self,tag,attrs):
  self.cur.children.append(Node(tag,attrs,self.cur))
 def handle_endtag(self,tag):
  n=self.cur
  while n.parent:
   if n.tag==tag: self.cur=n.parent;return
   n=n.parent
 def handle_data(self,data):
  if self.cur.tag not in {'script','style'} and data.strip(): self.cur.children.append(data.strip())
def safe_link(value,spec):
 url=urllib.parse.urljoin(spec['url'],value)
 u=urllib.parse.urlparse(url)
 if u.scheme!='https' or u.hostname!=spec['host'] or u.port is not None: return None
 m=re.fullmatch(spec['path'],u.path)
 return (m[1],'https://'+spec['host']+u.path) if m else None
def stamp(text,now):
 m=re.fullmatch(r'(?:(\d{4})-)?(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?',text)
 if not m:return None
 local=now.astimezone(CN)
 try:
  t=datetime(int(m[1] or local.year),int(m[2]),int(m[3]),int(m[4]),int(m[5]),int(m[6] or 0),tzinfo=CN)
  if not m[1] and t>now and local.month==1 and t.month==12:t=t.replace(year=local.year-1)
  return t if t<=now and now-t<=timedelta(hours=24) else None
 except ValueError:return None
def parse_list(raw,key,now):
 spec=SOURCES[key];parser=Tree();parser.feed(raw)
 out={}
 for a in parser.root.walk():
  if a.tag!='a':continue
  link=safe_link(a.attrs.get('href',''),spec)
  if not link:continue
  pid,url=link
  title=' '.join(a.text().split())[:160]
  if len(title)<2 or re.fullmatch(r'\d+|[\[\]0-9.]+',title):continue
  # Look for a single thread row with exactly one timestamp and its own counts.
  # Never use the time of a neighbouring thread or the crawl time as post time.
  n=a.parent
  for _ in range(7):
   if n is None:break
   text=' '.join(n.text().split())
   if len(text)>1200:break
   dates=re.findall(r'(?<!\d)(?:\d{4}-)?\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?(?!\d)',text)
   if key=='tgb' and len(dates)>1:
    post_texts=[' '.join(p.text().split()) for p in n.walk() if 'middle-list-post' in p.attrs.get('class','').split()]
    post_dates=[d for pt in post_texts for d in re.findall(r'(?<!\d)(?:\d{4}-)?\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?(?!\d)',pt)]
    if len(post_dates)==1: dates=post_dates
   counts=re.findall(r'(?<![\d.])(\d{1,10})\s*/\s*(\d{1,10})(?!\d)',text)
   ids={l[0] for p in n.walk() if p.tag=='a' and (l:=safe_link(p.attrs.get('href',''),spec))}
   if len(dates)==1 and len(counts)==1 and ids=={pid}:
    t=stamp(dates[0],now)
    if t:
     comments,reads=map(int,counts[0])
     if max(comments,reads)<=10**9:
      out[pid]={'id':pid,'title':title,'publishedAt':t.isoformat(),'timeKind':spec['kind'],'source':spec['name'],'code':key,'board':spec['board'],'url':url,'reads':reads,'comments':comments}
    break
   n=n.parent
 return sorted(out.values(),key=lambda p:p['publishedAt'],reverse=True)[:100]
def fetch(url,host):
 req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'text/html,text/plain,*/*'})
 with urllib.request.urlopen(req,timeout=12) as r:
  if urllib.parse.urlparse(r.geturl()).hostname!=host:raise ValueError('unexpected redirect')
  return r.read(3_000_000).decode(r.headers.get_content_charset() or 'utf-8','replace')
def collect_forum(key,now):
 spec=SOURCES[key];status={'code':key,'board':spec['board'],'source':spec['name']}
 try:
  rp=urllib.robotparser.RobotFileParser();rp.parse(fetch('https://'+spec['host']+'/robots.txt',spec['host']).splitlines())
  if not rp.can_fetch(UA,spec['url']):return [],{**status,'status':'blocked','error':'robots disallows list'}
  raw=fetch(spec['url'],spec['host']);rows=parse_list(raw,key,now)
  if not rows:raise ValueError('no recognized recent thread rows')
  return rows,{**status,'status':'ok','count':len(rows)}
 except Exception as e:
  return [],{**status,'status':'unavailable','error':str(e)[:100]}
