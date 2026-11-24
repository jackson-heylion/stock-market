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
if __name__=='__main__': unittest.main()
