import copy
import hashlib
import struct
import unittest
import wechat_interaction_service as n

class NativeInteractionTests(unittest.TestCase):
    def fixture(self):
        value={'action':'quote','self':'wxid_self','account':'account','chat':'room@chatroom','target':'wxid_peer','referenceId':'a'*64,'text':'接这句话','conversationKind':'group','conversationTarget':'123'}
        row={'wechatagentMessageId':'a'*64,'isSend':False,'senderUsername':'wxid_peer','createTime':1000,'serverId':'9223372036854775700','localId':34,'localType':1}
        return value,row
    def test_payload_binds_exact_64bit_id_and_native_message_type(self):
        value,row=self.fixture();data=n.interaction_payload(value,row,'wxid_self','account',now=1001)
        self.assertEqual(struct.unpack_from('<QIIIQ',data),(9223372036854775700,13,9,34,1))
        self.assertEqual(data[28:],b'room@chatroomwxid_peer'+value['text'].encode())
        value['action']='pat';value['text']='';row['localType']=(57<<32)|49
        self.assertEqual(struct.unpack_from('<Q',n.interaction_payload(value,row,'wxid_self','account',now=1001),20)[0],row['localType'])
    def test_rejects_other_accounts_self_outgoing_wrong_sender_and_stale_rows(self):
        for change in ({'account':'other'},{'self':'other'},{'target':'wxid_self'},{'referenceId':'b'*64}):
            value,row=self.fixture();value.update(change)
            with self.assertRaises(ValueError):n.interaction_payload(value,row,'wxid_self','account',now=1001)
        for change in ({'isSend':True},{'senderUsername':'other'},{'createTime':-3000},{'createTime':1100},{'serverId':'0'},{'serverId':str(2**64)},{'localId':str(2**32)},{'localType':49}):
            value,row=self.fixture();row.update(change)
            with self.assertRaises(ValueError):n.interaction_payload(value,row,'wxid_self','account',now=1001)
    def test_no_paths_group_wide_mentions_or_empty_quotes(self):
        for change in ({'chat':'../room'},{'conversationKind':'private'},{'target':'notify_all'},{'referenceId':'M1'},{'text':''},{'text':'bad\0text'},{'action':'pat','text':'text'}):
            value,row=self.fixture();value.update(change)
            with self.assertRaises(ValueError):n.interaction_payload(value,row,'wxid_self','account',now=1001)
    def test_receipt_rejects_plain_text_wrong_reference_pending_and_duplicates(self):
        value,row=self.fixture()
        receipt={'wechatagentMessageId':'new','isSend':True,'createTime':1001,'localType':n.QUOTE_TYPE,'serverId':'9223372036854775701','fullText':'<msg><appmsg><title>接这句话</title><refermsg><svrid>9223372036854775700</svrid></refermsg></appmsg></msg>'}
        self.assertEqual(n.quote_receipt([receipt],set(),value,row['serverId'],1000),'9223372036854775701')
        for change in ({'localType':1},{'serverId':'0'},{'isSend':False},{'createTime':900},{'fullText':receipt['fullText'].replace('9223372036854775700','999')}):
            bad={**receipt,**change};self.assertIsNone(n.quote_receipt([bad],set(),value,row['serverId'],1000))
        self.assertIsNone(n.quote_receipt([receipt],{'new'},value,row['serverId'],1000))
        self.assertIsNone(n.quote_receipt([receipt,{**receipt,'wechatagentMessageId':'new2'}],set(),value,row['serverId'],1000))
    def test_receipt_parses_entities_instead_of_matching_xml_substrings(self):
        value,row=self.fixture();value['text']='甲<&乙'
        receipt={'wechatagentMessageId':'new','isSend':True,'createTime':1001,'localType':n.QUOTE_TYPE,'serverId':'99','fullText':'<msg><appmsg><title>甲&lt;&amp;乙</title><refermsg><svrid>9223372036854775700</svrid></refermsg></appmsg></msg>'}
        self.assertEqual(n.quote_receipt([receipt],set(),value,row['serverId'],1000),'99')
    def test_conversation_mapping_matches_adapter_mapped_and_fallback_ids(self):
        self.assertEqual(n.conversation_id({'username':'room@chatroom','conversationId':123}),'123')
        key='测试群';expected=str(int.from_bytes(hashlib.sha256(key.encode()).digest()[:8],'big')%2147483647+1)
        self.assertEqual(n.conversation_id({'username':'room@chatroom','displayName':'测试群 (12)'}),expected)
if __name__=='__main__':unittest.main()
