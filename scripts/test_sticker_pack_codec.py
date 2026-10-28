import hashlib
import io
import pathlib
import tempfile
import unittest
from types import SimpleNamespace

from Crypto.Cipher import AES
from PIL import Image
from wechat_sticker_pack_codec import PackCodecError, PackImageDecoder, decode_slice
from wechat_sticker_packs import PackSendResources, StickerPackError


def gif(color):
    out=io.BytesIO();Image.new('RGB',(8,8),color).save(out,format='GIF');return out.getvalue()


class CodecTests(unittest.TestCase):
    def setUp(self):
        self.key=bytes(range(16))
        self.images=[gif('red'),gif('blue')]
        raw=b''.join(self.images);padding=16-len(raw)%16
        self.encrypted=AES.new(self.key,AES.MODE_CBC,self.key).encrypt(raw+bytes([padding])*padding)

    def test_unaligned_second_image_uses_previous_cipher_block(self):
        offset=0
        for raw in self.images:
            self.assertEqual(decode_slice(io.BytesIO(self.encrypted),self.key,offset,len(raw),hashlib.md5(raw).hexdigest()),raw)
            offset+=len(raw)

    def test_wrong_key_corruption_and_truncation_are_rejected(self):
        raw=self.images[0];digest=hashlib.md5(raw).hexdigest()
        for data,key in ((self.encrypted,bytes(16)),(bytes(16)+self.encrypted[16:],self.key),(self.encrypted[:-1],self.key)):
            with self.assertRaises(PackCodecError):decode_slice(io.BytesIO(data),key,0,len(raw),digest)
        for offset,size in ((-1,1),(0,0),(0,9*1024*1024),(10000,1)):
            with self.assertRaises(PackCodecError):decode_slice(io.BytesIO(self.encrypted),self.key,offset,size,digest)

    def test_only_selected_file_is_decoded_without_export(self):
        with tempfile.TemporaryDirectory() as temp:
            account=pathlib.Path(temp)/'account';package='pack.example'
            digest=hashlib.md5(package.encode()).hexdigest()
            source=account/'business/emoticon/PersistStore'/digest[:2]/digest
            source.parent.mkdir(parents=True);source.write_bytes(self.encrypted)
            decoder=PackImageDecoder(account,'configured-client',key_provider=lambda exe:self.key)
            before=sorted(str(p) for p in account.rglob('*'))
            raw=self.images[1]
            self.assertEqual(decoder(package,hashlib.md5(raw).hexdigest(),len(self.images[0]),len(raw)),raw)
            self.assertEqual(sorted(str(p) for p in account.rglob('*')),before)

    def test_resources_expire_and_recheck_chat_permission_without_pool_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            allowed={'value':True}
            def check(key):
                if not allowed['value'] or key!='wechat:group:123':raise StickerPackError('STICKER_PACK_CHAT_NOT_ALLOWED',403)
            pool=SimpleNamespace(root=pathlib.Path(temp),account_key='synthetic-account')
            resources=PackSendResources(pool,SimpleNamespace(check_chat=check))
            image_id=resources.prepare('wechat:group:123',self.images[0])
            self.assertFalse((pool.root/'state').exists())
            with self.assertRaises(PermissionError):resources.resource(image_id,'wechat:group:456')
            result=resources.resource(image_id,'wechat:group:123')
            self.assertEqual(result['origin'],'wechat-installed-packs')
            self.assertEqual(pathlib.Path(result['path']).read_bytes(),self.images[0])
            self.assertFalse((pool.root/'state/stickers/collected').exists())
            allowed['value']=False
            with self.assertRaises(StickerPackError):resources.resource(image_id,'wechat:group:123')
            resources.items[image_id]['expires']=0
            self.assertIsNone(resources.resource(image_id,'wechat:group:123'))


if __name__=='__main__':unittest.main()
