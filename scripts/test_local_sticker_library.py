import base64,hashlib,io,json,pathlib,sqlite3,tempfile,unittest
from unittest.mock import Mock
from PIL import Image
from local_sticker_library import LocalStickerLibrary
from wechat_sticker_collection import StickerCollection
from wechat_sticker_manager import ManagerError
from wechat_sticker_packs import InstalledStickerPacks,StickerPackError

class LocalLibraryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name);self.account=self.root/'account';self.active=True
  self.library=LocalStickerLibrary(self.root,self.account,'self',lambda:self.active);self.manager=self.library.manager
 def image(self,color='red'):
  out=io.BytesIO();Image.new('RGB',(24,24),color).save(out,format='GIF');return out.getvalue()
 def body(self,raw=None,**extra):
  current=self.manager.listing();return {'scope':current['scope'],'revision':current['revision'],'name':'小猫.gif','description':'开心的小猫','tags':['开心','哈哈'],'base64':base64.b64encode(raw or self.image()).decode(),**extra}
 def test_independent_library_exceeds_pool_capacity_and_is_persistent(self):
  old=StickerCollection(self.root,self.account,'self');before=old.read()
  for i in range(55):self.manager.import_image(self.body(self.image((i,20,30))))
  self.assertEqual(self.manager.listing()['count'],55);self.assertEqual(self.manager.listing()['limit'],10000)
  self.assertEqual(old.read(),before);self.assertNotEqual(old.account_key,self.library.account_key);self.assertFalse(old.index.exists())
  reopened=LocalStickerLibrary(self.root,self.account,'self');self.assertEqual(reopened.manager.listing()['count'],55)
 def test_duplicate_edit_preview_stale_revision_and_account_isolation(self):
  stale=self.body();result=self.manager.import_image(self.body());self.assertEqual(self.manager.import_image(self.body())['count'],1)
  with self.assertRaises(ManagerError):self.manager.import_image(stale)
  item=result['items'][0];edited=self.manager.change(self.body(id=item['id'],description='哭哭委屈',tags=['安慰']))
  self.assertEqual(edited['items'][0]['description'],'哭哭委屈');self.assertEqual(self.manager.image(item['id'],result['scope'],True)['mime'],'image/gif')
  other=LocalStickerLibrary(self.root,self.root/'other','other')
  with self.assertRaises(ManagerError):other.manager.image(item['id'],result['scope'])
  self.active=False
  with self.assertRaises(ManagerError):self.manager.listing()
 def catalogue(self):
  db=self.account/'db_storage/emoticon/emoticon.db';db.parent.mkdir(parents=True);con=sqlite3.connect(db)
  con.executescript('CREATE TABLE kStoreEmoticonPackageTable(package_id_,package_name_,download_status_,install_time_,remove_time_,sort_order_);CREATE TABLE kStoreEmoticonFilesTable(package_id_,md5_,sort_order_,emoticon_offset_,emoticon_size_);CREATE TABLE kStoreEmoticonCaptionsTable(package_id_,md5_,language_,caption_);')
  con.execute('INSERT INTO kStoreEmoticonPackageTable VALUES(?,?,?,?,?,?)',('box','小黑盒',1,1,0,0));con.execute('INSERT INTO kStoreEmoticonFilesTable VALUES(?,?,?,?,?)',('box','a'*32,0,0,43));con.execute('INSERT INTO kStoreEmoticonCaptionsTable VALUES(?,?,?,?)',('box','a'*32,'zh_CN','谢谢'));con.commit();con.close()
  return InstalledStickerPacks(self.account,lambda f:sqlite3.connect(f.as_uri()+'?mode=ro',uri=True),active=lambda:self.active,allowed=lambda key:key=='wechat:group:123',local_library=self.library,decoder=Mock(),resources=Mock())
 def test_unified_search_uses_labels_and_tags_without_exposing_paths(self):
  self.manager.import_image(self.body());catalogue=self.catalogue();data=catalogue.packages();self.assertEqual((data['totalPackages'],data['totalStickers']),(2,2))
  hit=catalogue.search('wechat:group:123','哈哈')['candidates'][0];self.assertEqual(hit['packName'],'本地表情包库');self.assertNotIn(str(self.root),json.dumps(hit));self.assertLessEqual(len(catalogue.search('wechat:group:123','开心')['candidates']),3)
  self.assertEqual(catalogue.search('wechat:group:123','谢谢')['candidates'][0]['packName'],'小黑盒')
  with self.assertRaises(StickerPackError):catalogue.search('wechat:group:999','开心')
 def test_selected_local_bytes_are_verified_and_removed_entries_cannot_be_prepared(self):
  result=self.manager.import_image(self.body());digest=result['items'][0]['id'];catalogue=self.catalogue();candidate=catalogue.search('wechat:group:123','开心')['candidates'][0]
  catalogue.resources.prepare.return_value='f'*64;ready=catalogue.prepare('wechat:group:123',candidate['id']);self.assertEqual(ready['collection'],'local-library');catalogue.resources.prepare.assert_called_once_with('wechat:group:123',self.image())
  self.manager.change(self.body(id=digest),remove=True)
  with self.assertRaises(StickerPackError):catalogue.prepare('wechat:group:123',candidate['id'])
 def test_corrupted_image_and_junction_like_paths_are_rejected(self):
  result=self.manager.import_image(self.body());digest=result['items'][0]['id'];(self.library.folder/(digest+'.gif')).write_bytes(b'GIF89abad')
  with self.assertRaises(RuntimeError):self.library.bytes(digest)
  with self.assertRaises(RuntimeError):self.library.safe(self.root/'outside.gif')

if __name__=='__main__':unittest.main()
