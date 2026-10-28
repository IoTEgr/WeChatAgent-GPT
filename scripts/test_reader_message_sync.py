import json,pathlib,tempfile,unittest
from reader_message_sync import MessageSync,message_identity

class FakeReader:
    def __init__(self,root):self.root=root;self.own_wxid='self';self.rows={};self.calls=[]
    def conversation_id(self,talker):return '123' if talker=='group@chatroom' else '456'
    def messages(self,talker,limit,from_time):
        self.calls.append((talker,limit,from_time))
        rows=[row for row in self.rows.get(talker,[]) if row['createTime']>=from_time]
        return sorted(rows,key=lambda row:row['createTime'],reverse=True)[:limit or None]
    def make_payload(self,talker,row):
        if row.get('isSend'):return None
        return {'rawid':message_identity(talker,row),'content':row['text'],'timestamp':row['createTime'],
            'sessionId':talker,'sessionType':'group' if '@chatroom' in talker else 'private',**row.get('extra',{})}
def row(identity,at,text='普通聊天',own=False,**extra):return {'serverId':identity,'localId':identity,'createTime':at,'text':text,'isSend':own,'extra':extra}
PROJECT={'account':{'nicknames':['示例机器人']},'wechat':{'wake_words':['小鲸鱼']}}

class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name);self.reader=FakeReader(self.root);self.sync=MessageSync(self.reader,100000)
    def test_recovery_reads_background_but_only_reviews_unanswered_direct_or_important_messages(self):
        self.reader.rows['group@chatroom']=[row(1,99900,'小鲸鱼旧问题'),row(2,99901,own=True),row(3,99902,'小鲸鱼现在还有问题'),row(4,99903),row(5,99904,'紧急求助，这个怎么办？')]
        payloads,cursor=self.sync.scan('group@chatroom',100001,PROJECT)
        self.assertEqual([p['timestamp'] for p in payloads],[99900,99903,99902,99904])
        self.assertTrue(all(p['historyContext'] for p in payloads[:2]));self.assertTrue(all(p['recoveredUnread'] for p in payloads[2:]));self.assertEqual(cursor,100001)
    def test_persistent_buffer_deduplicates_processed_and_still_pending_rows_after_restart(self):
        rows=[row(1,99900,'小鲸鱼你好'),row(2,99901,'小鲸鱼在吗')];self.reader.rows['group@chatroom']=rows
        folder=self.root/'state';folder.mkdir();(folder/'social-messages.json').write_text(json.dumps({'version':1,'chats':{'wechat:group:123':[{'message_id':message_identity('group@chatroom',r),'processed':i==0} for i,r in enumerate(rows)]}}))
        self.assertEqual(self.sync.scan('group@chatroom',100001,PROJECT)[0],[])
    def test_per_chat_overlap_recovers_late_message_even_after_another_chat_has_newer_time(self):
        self.reader.rows['group@chatroom']=[row(1,100000)]
        payloads,cursor=self.sync.scan('group@chatroom',100010,PROJECT);self.sync.commit('group@chatroom',payloads,cursor,100010)
        self.reader.rows['private']=[row(3,100080)];p,c=self.sync.scan('private',100090,PROJECT);self.sync.commit('private',p,c,100090)
        self.reader.rows['group@chatroom'].append(row(2,100003))
        recovered,_=self.sync.scan('group@chatroom',100100,PROJECT)
        self.assertEqual([p['timestamp'] for p in recovered],[100003])
    def test_failed_or_uncommitted_scan_does_not_advance_progress(self):
        self.reader.rows['group@chatroom']=[row(1,99900,'小鲸鱼在吗')]
        first,c=self.sync.scan('group@chatroom',100001,PROJECT)
        self.assertNotIn('group@chatroom',self.sync.cursors)
        again,_=self.sync.scan('group@chatroom',100002,PROJECT);self.assertEqual(first,again)
    def test_private_followup_mentions_and_self_quote_are_recovered_but_old_window_is_bounded(self):
        self.reader.rows['private']=[row(1,99900,'你好'),row(2,1,'过期消息')]
        p,_=self.sync.scan('private',100001,PROJECT);self.assertEqual(len(p),1);self.assertTrue(p[0]['recoveredUnread'])
        self.reader.rows['group@chatroom']=[row(3,99902,'@示例机器人\u2005你觉得呢'),row(4,99903,'为什么',quoteReply={'reference':{'senderId':'self','conversationId':'group@chatroom'}})]
        self.assertTrue(all(p['recoveredUnread'] for p in self.sync.scan('group@chatroom',100001,PROJECT)[0]))
    def test_future_timestamp_does_not_move_cursor_past_now(self):
        self.reader.rows['group@chatroom']=[row(1,200000)]
        self.assertEqual(self.sync.scan('group@chatroom',100001,PROJECT)[1],100001)

class LedgerTests(unittest.TestCase):
    setUp=SyncTests.setUp
    def test_processed_marker_survives_buffer_eviction_and_restart_without_cross_account_reuse(self):
        entry=row(1,99900,'小鲸鱼旧问题');identity=message_identity('group@chatroom',entry)
        self.reader.rows['group@chatroom']=[entry]
        folder=self.root/'state';folder.mkdir();buffer=folder/'social-messages.json'
        buffer.write_text(json.dumps({'version':1,'chats':{'wechat:group:123':[{'message_id':identity,'processed':True,'timestamp':99900}]}}))
        self.sync.scan('group@chatroom',100001,PROJECT)
        buffer.write_text(json.dumps({'version':1,'chats':{}}))
        restarted=MessageSync(self.reader,100002)
        self.assertEqual(restarted.scan('group@chatroom',100003,PROJECT)[0],[])
        self.reader.own_wxid='another-account'
        another=MessageSync(self.reader,100002)
        self.assertEqual(len(another.scan('group@chatroom',100003,PROJECT)[0]),1)
    def test_large_backlog_is_one_recent_review_batch_and_older_rows_become_context(self):
        self.reader.rows['group@chatroom']=[row(i,99000+i,'小鲸鱼有问题') for i in range(50)]
        payloads,_=self.sync.scan('group@chatroom',100001,PROJECT)
        self.assertEqual(sum(p.get('recoveredUnread',False) for p in payloads),20)
        self.assertEqual(sum(p.get('historyContext',False) for p in payloads),30)

if __name__=='__main__':unittest.main()
