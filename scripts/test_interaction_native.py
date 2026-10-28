import unittest
import subprocess
import sys
from pathlib import Path
import xml.etree.ElementTree as ET
import wechat_interaction_native as n

class InteractionWireTests(unittest.TestCase):
    def test_crashing_native_quote_path_is_blocked_without_loading_wechat(self):
        result=subprocess.run([sys.executable,str(Path(n.__file__)),'--root','nonexistent-diagnostic-root','--native-input'],input=b'{}',capture_output=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn(b'INTERACTION_NATIVE_QUOTE_DISABLED',result.stdout)
    def test_quote_cgi_and_cli_are_blocked_before_accessing_runtime_files(self):
        with self.assertRaisesRegex(ValueError,'INTERACTION_ACTION_UNAVAILABLE'):n.native_command('nonexistent-diagnostic-root',222,b'anything')
        result=subprocess.run([sys.executable,str(Path(n.__file__)),'--root','nonexistent-diagnostic-root'],input=b'{"action":"quote"}',capture_output=True)
        self.assertNotEqual(result.returncode,0);self.assertIn(b'INTERACTION_ACTION_UNAVAILABLE',result.stdout)
    def test_quote_escapes_xml_and_preserves_server_id(self):
        payload=n.quoted_request({'self':'wxid_self','target':'room@chatroom','text':'你说的 <&>','clientId':'wca_delivery_123','reference':{'sender':'wxid_peer','serverId':'9223372036854775700','name':'甲<&>','text':'<原句>&\"','time':123}},now=456)
        top=dict((k,v) for k,w,v in n.decode_fields(payload));app=dict((k,v) for k,w,v in n.decode_fields(top[2]));self.assertEqual(app[5],57);root=ET.fromstring(app[6]);self.assertEqual(root.findtext('title'),'你说的 <&>');self.assertEqual(root.findtext('refermsg/svrid'),'9223372036854775700');self.assertEqual(root.findtext('refermsg/fromusr'),'room@chatroom');self.assertEqual(root.findtext('refermsg/chatusr'),'wxid_peer');self.assertEqual(root.findtext('refermsg/content'),'<原句>&\"')
    def test_pat_matches_observed_native_field_order(self):
        payload=n.pat_request({'self':'wxid_self','target':'wxid_peer','chat':'room@chatroom','clientId':'wca_delivery_123'});fields=dict((k,v) for k,w,v in n.decode_fields(payload));self.assertEqual(fields[2],b'wxid_self');self.assertEqual(fields[3],b'room@chatroom');self.assertEqual(fields[4],b'wxid_peer');self.assertEqual(fields[5],b'wca_delivery_123');self.assertEqual(fields[6],0)
    def test_responses_require_a_real_return_code_and_keep_large_ids(self):
        data=n.field(1,n.field(1,0))+n.field(9,9223372036854775701);self.assertEqual(n.response_status(data)['serverIds'],['9223372036854775701']);self.assertEqual(n.response_status(n.field(1,n.field(1,(1<<64)-2)))['ret'],-2)
        for bad in [b'',n.field(1,b''),b'\x0a\xff']:
            with self.assertRaises(ValueError):n.response_status(bad)
    def test_rejects_paths_and_forged_identifiers(self):
        with self.assertRaises(ValueError):n.pat_request({'self':'wxid_self','target':'../elsewhere','chat':'room@chatroom','clientId':'wca_delivery_123'})
        with self.assertRaises(ValueError):n.varint(-1)
if __name__=='__main__':unittest.main()
