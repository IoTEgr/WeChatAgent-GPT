import importlib.util,pathlib,queue,threading,unittest
from collections import OrderedDict
from unittest.mock import Mock
spec=importlib.util.spec_from_file_location('poll_fixture_api',pathlib.Path(__file__).with_name('reader-api.py'))
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)

class OneCycle:
    def __init__(self):self.stopped=False
    def is_set(self):return self.stopped
    def wait(self,_):self.stopped=True

class PollRecoveryTests(unittest.TestCase):
    def fixture(self,clients):
        reader=Mock();reader.root=pathlib.Path(__file__).parent.parent;reader.image_index={};reader.stop=OneCycle();reader.lock=threading.Lock();reader.clients=clients
        reader.push_backlog=OrderedDict();reader.pushed=0;reader.selected_talkers.return_value=['fixture'];reader.conversation_id.return_value='123'
        reader.message_sync.cursors={};reader.message_sync.scan.return_value=([{'type':1,'content':'fixture','rawid':'a'*64}],1000)
        return reader
    def run_poll(self,reader):
        original=api.read_json
        try:api.read_json=lambda _:{};api.Reader.poll(reader)
        finally:api.read_json=original
    def test_no_subscriber_does_not_scan_or_mark_messages_seen(self):
        reader=self.fixture(set());self.run_poll(reader);reader.message_sync.scan.assert_not_called();reader.message_sync.commit.assert_not_called();self.assertEqual(reader.pushed,0)
    def test_full_queue_retains_uncommitted_progress_instead_of_dropping_subscriber(self):
        client=queue.Queue(maxsize=1);client.put('occupied');reader=self.fixture({client});self.run_poll(reader)
        self.assertEqual(reader.clients,{client});self.assertEqual(reader.pushed,0);self.assertIsNone(reader.message_sync.commit.call_args.args[2])
    def test_successful_delivery_retains_reconnect_backlog_and_commits_only_after_queueing(self):
        client=queue.Queue(maxsize=2);reader=self.fixture({client});self.run_poll(reader)
        payload=client.get_nowait();self.assertEqual(list(reader.push_backlog),[payload['rawid']]);self.assertEqual(reader.pushed,1)
        self.assertEqual(reader.message_sync.commit.call_args.args[1],[payload]);self.assertEqual(reader.message_sync.commit.call_args.args[2],1000)

if __name__=='__main__':unittest.main()
