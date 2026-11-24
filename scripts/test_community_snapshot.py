import sys, unittest
from pathlib import Path
from datetime import datetime, timezone, timedelta
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_community_snapshot import normalize,article_arrays
class TestCommunity(unittest.TestCase):
    def test_public_posts_only(self):
        now=datetime(2026,11,24,1,tzinfo=timezone.utc)
        row={'post_id':123456,'post_type':0,'post_title':'看多光模块','post_publish_time':(now-timedelta(minutes=1)).isoformat(),'post_stockbar_code':'300308','post_click_count':12,'post_comment_count':2}
        rows=normalize([row,{**row,'post_id':123457,'post_type':1},{**row,'post_id':123458,'post_publish_time':(now+timedelta(minutes=1)).isoformat()}],'300308','中际旭创',now)
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['comments'],2);self.assertNotIn('author',rows[0])
    def test_embedded_array(self):
        import json
        raw='var article_list='+json.dumps([{'post_id':12345,'post_title':'test'}])+';'
        self.assertEqual(list(article_arrays(raw))[0][0]['post_id'],12345)
from forum_sources import parse_list
class TestForum(unittest.TestCase):
    def test_independent_rows_and_time_kind(self):
        now=datetime(2026,11,24,1,tzinfo=timezone.utc)
        h='<div><div><a href="/644082277.html">看多科技</a><span>3 / 100</span><time>11-24 08:59</time></div><div><a href="/644082278.html">看空科技</a><span>1 / 12</span><time>11-24 08:58</time></div></div>'
        rows=parse_list(h,'hupu',now)
        self.assertEqual(len(rows),2);self.assertEqual(rows[0]['timeKind'],'activity')
        t='<div><a href="/a/2wXTmYDlbQe">观察龙头</a><span>0 / 2</span><span>11-23 21:48</span></div>'
        row=parse_list(t,'tgb',now)[0];self.assertEqual(row['source'],'淘股吧');self.assertEqual(row['timeKind'],'published')
    def test_untrusted_link_and_missing_time(self):
        now=datetime(2026,11,24,1,tzinfo=timezone.utc)
        self.assertEqual(parse_list('<div><a href="https://other.com/123456.html">看多</a> 1 / 2 11-24 08:59</div>','hupu',now),[])
        self.assertEqual(parse_list('<div><a href="/123456.html">看多</a> 1 / 2</div>','hupu',now),[])
if __name__=='__main__': unittest.main()
