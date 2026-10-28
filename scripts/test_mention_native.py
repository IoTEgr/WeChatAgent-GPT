import unittest
import struct
import subprocess
import sys
import os
import json
import wechat_mention_native as n

class MentionTests(unittest.TestCase):
    def test_utf8_json_input_does_not_depend_on_windows_gbk_locale(self):
        payload=json.dumps({'target':'private_friend','member':'wxid_peer','text':'@忘川\u2005这是一条回复'},ensure_ascii=False).encode('utf-8')
        result=subprocess.run([sys.executable,n.__file__,'--root','missing'],input=payload,capture_output=True,env=dict(os.environ,PYTHONIOENCODING='gbk'))
        self.assertNotEqual(result.returncode,0)
        self.assertIn(b'INTERACTION_TARGET_INVALID',result.stdout)
    def test_utf8_payload_binds_one_member_without_xml_injection(self):
        value={'target':'room@chatroom','member':'wxid_peer','text':'@甲\u2005好的[微笑]'}
        payload=n.mention_payload(value);sizes=struct.unpack_from('<III',payload);self.assertEqual(sum(sizes)+12,len(payload))
        start=12+sizes[0]+sizes[1];self.assertEqual(payload[start:],b'wxid_peer');self.assertNotIn(b'msgsource',payload[start:]);self.assertIn(value['text'].encode(),payload)
    def test_invalid_requests_are_rejected_before_any_runtime_access(self):
        valid={'target':'room@chatroom','member':'wxid_peer','text':'@甲 好的'}
        for patch in [{'target':'wxid_friend'},{'member':'notify_all'},{'member':'x]]><x>'},{'text':'没有艾特'},{'text':'@甲\0坏'},{'text':'@'+'长'*5000}]:
            with self.assertRaises(ValueError):n.native_command('missing',dict(valid,**patch))

if __name__=='__main__':unittest.main()
