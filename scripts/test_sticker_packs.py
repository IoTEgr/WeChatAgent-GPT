import hashlib
import importlib.util
import json
import pathlib
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from types import SimpleNamespace
from unittest.mock import patch

from wechat_sticker_packs import InstalledStickerPacks, StickerPackError, sticker_pack_response, BASE_ROUTE


class CatalogueTests(unittest.TestCase):
    def test_relevant_local_stickers_precede_installed_matches_without_promoting_unrelated_local_images(self):
        catalogue=object.__new__(InstalledStickerPacks);catalogue._check=lambda:None;catalogue.allowed=lambda key:True;catalogue.decoder=None;catalogue.resources=None
        local={'id':'a'*64,'packId':'__local_library__','caption':'开心笑','keywords':''};installed={'id':'b'*64,'packId':'installed','caption':'哈哈大笑','keywords':''}
        catalogue._read=lambda:([],[installed,local])
        self.assertEqual(catalogue.search('wechat:group:123','哈哈大笑')['candidates'][0]['id'],local['id'])
        local['caption']='哭泣悲伤'
        self.assertEqual(catalogue.search('wechat:group:123','哈哈大笑')['candidates'][0]['id'],installed['id'])
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.account = pathlib.Path(self.temp.name) / 'selected-account'
        self.db = self.account / 'db_storage/emoticon/emoticon.db'
        self.db.parent.mkdir(parents=True)
        conn = sqlite3.connect(self.db)
        conn.executescript('''
            CREATE TABLE kStoreEmoticonPackageTable(package_id_,package_name_,download_status_,install_time_,remove_time_,sort_order_);
            CREATE TABLE kStoreEmoticonFilesTable(package_id_,md5_,sort_order_,emoticon_offset_,emoticon_size_);
            CREATE TABLE kStoreEmoticonCaptionsTable(package_id_,md5_,language_,caption_);
        ''')
        conn.executemany('INSERT INTO kStoreEmoticonPackageTable VALUES(?,?,?,?,?,?)', [
            ('cat', '月薪喵1', 1, 10, 0, 2), ('box', '小黑盒cube1', 1, 10, 0, 1),
            ('missing', '尚未下载', 0, 10, 0, 3), ('removed', '已删除', 1, 10, 20, 4)])
        entries = [('cat', 'a', '哈哈哈'), ('cat', 'b', '委屈'), ('cat', 'c', '收到'),
                   ('cat', 'd', '睡觉'), ('box', 'e', '好耶'), ('box', 'f', '尴尬'), ('box', '1', '开心'),
                   ('removed', '2', '已删除')]
        for order, (package, char, caption) in enumerate(entries):
            conn.execute('INSERT INTO kStoreEmoticonFilesTable VALUES(?,?,?,?,?)', (package, char * 32, order, 0, 43))
            conn.execute('INSERT INTO kStoreEmoticonCaptionsTable VALUES(?,?,?,?)', (package, char * 32, 'zh_CN', caption))
        conn.execute('INSERT INTO kStoreEmoticonCaptionsTable VALUES(?,?,?,?)', ('cat', 'a' * 32, 'en', 'Ha ha'))
        conn.commit()
        conn.close()
        self.opens = 0
        self.connections = []
        self.is_active = True
        self.is_allowed = True
        self.clock = 0
        self.catalogue = InstalledStickerPacks(self.account, self.connect,
            active=lambda: self.is_active, allowed=lambda key: key == 'wechat:group:123' and self.is_allowed,
            now=lambda: self.clock)

    def tearDown(self):
        self.temp.cleanup()

    def connect(self, path):
        self.opens += 1
        connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
        self.connections.append(connection)
        return connection

    def assert_error(self, code, function, *args, status=None):
        with self.assertRaises(StickerPackError) as result:
            function(*args)
        self.assertEqual(result.exception.code, code)
        if status is not None:
            self.assertEqual(result.exception.status, status)

    def test_installed_only_and_paginated(self):
        first = self.catalogue.packages(limit=1)
        self.assertEqual((first['totalPackages'], first['totalStickers']), (2, 7))
        self.assertEqual(first['packages'][0]['name'], '小黑盒cube1')
        self.assertEqual(first['nextOffset'], 1)
        self.assertEqual(self.catalogue.packages(offset=1)['packages'][0]['stickerCount'], 4)
        self.assertIsNone(self.catalogue.packages(offset=100)['nextOffset'])

    def test_caption_language_and_independent_pagination(self):
        result = self.catalogue.items('cat', limit=1)
        self.assertEqual(result['items'][0]['caption'], '哈哈哈')
        self.assertEqual(result['total'], 4)
        self.assertEqual(self.catalogue.items('cat', '委屈')['total'], 1)
        self.assert_error('STICKER_PACK_NOT_FOUND', self.catalogue.items, 'unknown', status=404)

    def test_local_scene_search_is_bounded_and_can_miss(self):
        happy = self.catalogue.search('wechat:group:123', '成功通过，真高兴')
        self.assertLessEqual(len(happy['candidates']), 3)
        self.assertIn('开心', [item['caption'] for item in happy['candidates']])
        self.assertEqual(self.catalogue.search('wechat:group:123', '被欺负了')['candidates'][0]['caption'], '委屈')
        self.assertEqual(self.catalogue.search('wechat:group:123', '量子纠缠')['candidates'], [])
        self.assert_error('STICKER_PACK_INVALID_PAGE', self.catalogue.search, 'wechat:group:123', '开心', 4)

    def test_permissions_and_account_are_checked_on_cache_hits(self):
        self.catalogue.search('wechat:group:123', '开心')
        self.is_allowed = False
        self.assert_error('STICKER_PACK_CHAT_NOT_ALLOWED', self.catalogue.search, 'wechat:group:123', '开心', status=403)
        self.is_active = False
        self.assert_error('STICKER_PACK_ACCOUNT_CHANGED', self.catalogue.packages, status=409)

    def test_never_claims_a_sendable_resource(self):
        for result in (self.catalogue.packages(), self.catalogue.items('cat'), self.catalogue.search('wechat:group:123', '开心')):
            self.assertFalse(result['sendSupported'])
            self.assertNotIn('id', result)
            encoded = json.dumps(result)
            self.assertNotIn(str(self.account), encoded)
            self.assertNotIn('aes_key', encoded)

    def test_preparation_is_chat_bound_and_never_imports_to_pool(self):
        from unittest.mock import Mock
        candidate = self.catalogue.search('wechat:group:123', '委屈')['candidates'][0]
        raw = b'GIF89a' + b'fixture'
        self.catalogue.decoder = Mock(return_value=raw)
        self.catalogue.resources = Mock()
        self.catalogue.resources.prepare.return_value = 'f' * 64
        result = self.catalogue.prepare('wechat:group:123', candidate['id'])
        self.assertTrue(result['ready'])
        self.assertEqual(result['source'], 'wechat-installed-packs')
        self.assertEqual(result['description'], '委屈')
        self.catalogue.resources.prepare.assert_called_once_with('wechat:group:123', raw)
        self.assertFalse((self.account / 'state').exists())
        self.is_allowed = False
        self.assert_error('STICKER_PACK_CHAT_NOT_ALLOWED', self.catalogue.prepare, 'wechat:group:123', candidate['id'])

    def test_changed_permission_and_catalogue_during_decode(self):
        from unittest.mock import Mock
        candidate = self.catalogue.search('wechat:group:123', '委屈')['candidates'][0]
        self.catalogue.resources = Mock()
        def revoke(*args):
            self.is_allowed = False
            return b'GIF89afixture'
        self.catalogue.decoder = revoke
        self.assert_error('STICKER_PACK_CHAT_NOT_ALLOWED', self.catalogue.prepare, 'wechat:group:123', candidate['id'])
        self.catalogue.resources.prepare.assert_not_called()
        self.is_allowed = True
        def remove(*args):
            connection = sqlite3.connect(self.db)
            connection.execute("DELETE FROM kStoreEmoticonFilesTable WHERE md5_=?", ('b' * 32,))
            connection.commit(); connection.close()
            self.clock += 4
            return b'GIF89afixture'
        self.catalogue.decoder = remove
        self.assert_error('STICKER_PACK_NOT_FOUND', self.catalogue.prepare, 'wechat:group:123', candidate['id'])
        self.catalogue.resources.prepare.assert_not_called()

    def test_cache_expiry_and_database_change(self):
        self.catalogue.packages()
        self.catalogue.packages()
        self.assertEqual(self.opens, 1)
        self.clock = 4
        self.catalogue.packages()
        self.assertEqual(self.opens, 2)
        connection = sqlite3.connect(self.db)
        try:
            connection.execute('UPDATE kStoreEmoticonPackageTable SET package_name_=? WHERE package_id_=?', ('新名称', 'cat'))
            connection.commit()
        finally:
            connection.close()
        self.assertEqual(self.catalogue.items('cat')['items'][0]['packName'], '新名称')
        self.assertEqual(self.opens, 3)

    def test_query_only_read_leaves_database_unchanged(self):
        before = hashlib.sha256(self.db.read_bytes()).digest()
        self.catalogue.packages()
        self.catalogue.items('cat')
        self.catalogue.search('wechat:group:123', '委屈')
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).digest(), before)
        self.assertFalse((self.account / 'state').exists())
        for connection in self.connections:
            with self.assertRaises(sqlite3.ProgrammingError):
                connection.execute('SELECT 1')

    def test_input_validation(self):
        for query in ('x' * 121, 'bad\nquery', None):
            self.assert_error('STICKER_PACK_INVALID_QUERY', self.catalogue.search, 'wechat:group:123', query)
        self.assert_error('STICKER_PACK_INVALID_ID', self.catalogue.items, '../private')
        self.assert_error('STICKER_PACK_INVALID_PAGE', self.catalogue.packages, -1)
        self.assert_error('STICKER_PACK_INVALID_QUERY', sticker_pack_response, self.catalogue, BASE_ROUTE, {'limit': ['1', '2']})
        self.assert_error('STICKER_PACK_ROUTE_NOT_FOUND', sticker_pack_response, self.catalogue, BASE_ROUTE + '/unknown', {}, status=404)

    def test_missing_database_and_sanitized_database_error(self):
        self.db.unlink()
        self.assert_error('STICKER_PACK_DATABASE_UNAVAILABLE', self.catalogue.packages, status=503)
        self.db.write_bytes(b'not a database with private path or credential')
        self.assert_error('STICKER_PACK_READ_FAILED', self.catalogue.packages, status=503)


    def test_authenticated_http_routes_and_bounded_errors(self):
        # Import the real reader without constructing it or polling real chats.
        source = pathlib.Path(__file__).with_name('reader-api.py')
        spec = importlib.util.spec_from_file_location('reader_pack_http_test', source)
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
        ready = threading.Event()
        holder = {}
        def factory(port, handler):
            server = api.ThreadingHTTPServer(('127.0.0.1', 0), handler)
            holder['server'] = server
            ready.set()
            return server
        class Executor:
            def shutdown(self, **options):
                pass
        fake = SimpleNamespace(installed_sticker_packs=self.catalogue, stop=threading.Event(),
                               poll=lambda: None, sticker_executor=Executor(), sticker_review_executor=Executor())
        with patch.object(api, 'create_reader_server', factory):
            thread = threading.Thread(target=api.serve, args=(fake, 0, 'synthetic-reader-token'), daemon=True)
            thread.start()
            self.assertTrue(ready.wait(5))
            server = holder['server']
            def request(route, authorized=True, body=None):
                req = urllib.request.Request('http://127.0.0.1:' + str(server.server_port) + route,
                    data=json.dumps(body).encode() if body is not None else None,
                    headers={'Authorization': 'Bearer synthetic-reader-token'} if authorized else {})
                try:
                    response = urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=5)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    return response.status, json.load(response)
            try:
                self.assertEqual(request(BASE_ROUTE, False)[0], 401)
                status, body = request(BASE_ROUTE)
                self.assertEqual((status, body['totalStickers']), (200, 7))
                self.assertFalse(body['sendSupported'])
                self.assertEqual(request(BASE_ROUTE + '?limit=bad')[0], 400)
                self.assertEqual(request(BASE_ROUTE + '/items?packId=unknown')[0], 404)
                self.assertEqual(request(BASE_ROUTE + '/search?conversationKey=wechat:group:999&query=OK')[0], 403)
                self.catalogue.decoder = lambda *args: b'GIF89afixture'
                self.catalogue.resources = SimpleNamespace(prepare=lambda key, raw: 'f' * 64)
                candidate = self.catalogue.search('wechat:group:123', '委屈')['candidates'][0]['id']
                body = {'conversationKey': 'wechat:group:123', 'id': candidate}
                self.assertEqual(request(BASE_ROUTE + '/prepare', False, body)[0], 401)
                status, result = request(BASE_ROUTE + '/prepare', body=body)
                self.assertEqual(status, 200)
                self.assertTrue(result['ready'])
                self.assertEqual(request(BASE_ROUTE + '/prepare', body={**body, 'extra': True})[0], 400)
                self.assertEqual(request(BASE_ROUTE + '/prepare', body={**body, 'conversationKey': 'wechat:group:999'})[0], 403)

            finally:
                server.shutdown()
                thread.join(5)
                self.assertFalse(thread.is_alive())


if __name__ == '__main__':
    unittest.main()
