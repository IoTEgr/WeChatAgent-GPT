"""Read installed WeChat sticker catalogues without exporting images or pool writes.

The caller owns the selected account and supplies a read-only database opener.
Catalogue IDs become send resources only after local decoding and verification.
"""
import hashlib
import pathlib
import re
import threading
import time
from wechat_meme_library import MemeSendResources

BASE_ROUTE = '/api/v1/sticker-packs'
SOURCE = 'wechat-installed-packs'
MAX_PACKS = 512
MAX_ITEMS = 20000
MAX_PAGE = 100
MAX_CANDIDATES = 3
PACKAGE_ID = re.compile(r'[A-Za-z0-9_.-]{1,128}')
MD5 = re.compile(r'[a-fA-F0-9]{32}')
SCENES = (
    ('开心 高兴 好耶 庆祝 成功 通过', '开心 高兴 好耶 庆祝 鼓掌 棒 耶'),
    ('笑 哈哈 笑死 好笑 绷不住', '笑 哈哈 好笑 乐 开心'),
    ('委屈 可怜 撒娇 欺负', '委屈 可怜 哭 呜 撒娇 抱抱'),
    ('难过 伤心 失落 安慰', '难过 伤心 哭 抱抱 摸摸 安慰'),
    ('无语 尴尬 离谱 社死', '无语 尴尬 额 啊这 裂开 汗'),
    ('惊讶 震惊 真的假的 居然', '惊讶 震惊 哇 什么 真的假的 啊'),
    ('困 睡觉 晚安 早安 起床', '困 睡 晚安 早安 起床'),
    ('吃饭 干饭 外卖 饿', '吃饭 干饭 外卖 饿 饭'),
    ('收到 好的 明白 知道', '收到 好的 明白 OK ok 嗯'),
    ('感谢 谢谢 感激', '感谢 谢谢 感激 爱心 比心'),
)


class StickerPackError(Exception):
    def __init__(self, code, status=400):
        super().__init__(code)
        self.code, self.status = code, status


def _text(value, maximum=120):
    if not isinstance(value, str):
        return ''
    return re.sub(r'[\x00-\x1f\x7f]', ' ', value).strip()[:maximum]


def _page(offset, limit, maximum=MAX_PAGE):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= maximum:
        raise StickerPackError('STICKER_PACK_INVALID_PAGE')


class InstalledStickerPacks:
    def __init__(self, account, connect, *, active=lambda: True, allowed=lambda key: False,
                 now=time.monotonic, cache_seconds=3, decoder=None, resources=None, local_library=None):
        self.account = pathlib.Path(account).resolve()
        self.database = self.account / 'db_storage' / 'emoticon' / 'emoticon.db'
        self.connect, self.active, self.allowed = connect, active, allowed
        self.now, self.cache_seconds = now, cache_seconds
        self.lock = threading.RLock()
        self.cached = None
        self.locations = {}
        self.decoder, self.resources = decoder, resources
        self.local_library=local_library

    def _check(self):
        if not self.active():
            raise StickerPackError('STICKER_PACK_ACCOUNT_CHANGED', 409)

    def _signature(self):
        self._check()
        if not self.database.is_file():
            raise StickerPackError('STICKER_PACK_DATABASE_UNAVAILABLE', 503)
        for path in (self.database, *self.database.parents):
            if path == self.account:
                break
            if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
                raise StickerPackError('STICKER_PACK_PATH_INVALID', 503)
        if not self.database.resolve().is_relative_to(self.account):
            raise StickerPackError('STICKER_PACK_PATH_INVALID', 503)
        result = []
        for path in (self.database, self.database.with_name(self.database.name + '-wal')):
            try:
                stat = path.stat()
                result.append((stat.st_size, stat.st_mtime_ns))
            except FileNotFoundError:
                result.append(None)
        return tuple(result)+(self.local_library.signature() if self.local_library is not None else None,)

    def _read(self):
        with self.lock:
            signature = self._signature()
            if self.cached and self.cached[0] == signature and self.now() - self.cached[1] < self.cache_seconds:
                return self.cached[2], self.cached[3]
            connection = None
            try:
                connection = self.connect(self.database)
                connection.execute('PRAGMA query_only=ON')
                connection.execute('BEGIN')
                packages = connection.execute(
                    'SELECT package_id_,package_name_,download_status_,install_time_,remove_time_,sort_order_ '
                    'FROM kStoreEmoticonPackageTable ORDER BY sort_order_,package_id_ LIMIT ?', (MAX_PACKS + 1,)).fetchall()
                files = connection.execute(
                    'SELECT package_id_,md5_,sort_order_,emoticon_offset_,emoticon_size_ FROM kStoreEmoticonFilesTable '
                    'ORDER BY package_id_,sort_order_,md5_ LIMIT ?', (MAX_ITEMS + 1,)).fetchall()
                captions = connection.execute(
                    'SELECT package_id_,md5_,language_,caption_ FROM kStoreEmoticonCaptionsTable '
                    'ORDER BY package_id_,md5_,language_ LIMIT ?', (MAX_ITEMS * 8 + 1,)).fetchall()
                if len(packages) > MAX_PACKS or len(files) > MAX_ITEMS or len(captions) > MAX_ITEMS * 8:
                    raise StickerPackError('STICKER_PACK_CATALOGUE_TOO_LARGE', 503)
                pack_map = {}
                for package, name, downloaded, installed, removed, order in packages:
                    if not isinstance(package, str) or not PACKAGE_ID.fullmatch(package) or downloaded != 1:
                        continue
                    if removed and int(removed) > int(installed or 0):
                        continue
                    pack_map[package] = {'id': package, 'name': _text(name) or package, 'stickerCount': 0}
                labels = {}
                for package, md5, language, caption in captions:
                    caption = _text(caption)
                    if package not in pack_map or not isinstance(md5, str) or not MD5.fullmatch(md5) or not caption:
                        continue
                    language = str(language or '').lower().replace('_', '-')
                    preference = 3 if language in ('zh-cn', 'zh-hans') else 2 if language.startswith('zh') else 1
                    identity = (package, md5.lower())
                    if identity not in labels or preference > labels[identity][0]:
                        labels[identity] = (preference, caption)
                items, seen, locations = [], set(), {}
                for package, md5, order, offset, size in files:
                    if package not in pack_map or not isinstance(md5, str) or not MD5.fullmatch(md5):
                        continue
                    identity = (package, md5.lower())
                    if identity in seen:
                        continue
                    seen.add(identity)
                    reference = hashlib.sha256(('installed-pack\0' + str(self.account) + '\0' + package + '\0' + md5.lower()).encode()).hexdigest()
                    items.append({'id': reference, 'packId': package, 'packName': pack_map[package]['name'],
                                  'caption': labels.get(identity, (0, ''))[1], 'order': int(order or 0)})
                    locations[reference] = (package, md5.lower(), offset, size)
                    pack_map[package]['stickerCount'] += 1
                if self.local_library is not None:
                    local=self.local_library.catalogue()
                    if local:
                        pack_map['__local_library__']={'id':'__local_library__','name':'本地表情包库','stickerCount':len(local)}
                    for item in local:
                        locations[item['id']]=(None,item.pop('digest'),0,0)
                        items.append(item)
                self._check()
                self.locations = locations
                self.cached = (signature, self.now(), list(pack_map.values()), items)
                return self.cached[2], items
            except StickerPackError:
                raise
            except Exception:
                # Never return SQLite diagnostics, account paths or key material.
                raise StickerPackError('STICKER_PACK_READ_FAILED', 503) from None
            finally:
                if connection is not None:
                    connection.close()

    def _result(self, **fields):
        self._check()
        return {'source': SOURCE, 'sendSupported': self.decoder is not None and self.resources is not None, **fields}

    def packages(self, offset=0, limit=50):
        _page(offset, limit)
        packages, items = self._read()
        end = min(offset + limit, len(packages))
        return self._result(packages=[dict(item) for item in packages[offset:end]],
                            totalPackages=len(packages), totalStickers=len(items),
                            nextOffset=end if end < len(packages) else None)

    def items(self, package_id, query='', offset=0, limit=50):
        _page(offset, limit)
        if not isinstance(package_id, str) or not PACKAGE_ID.fullmatch(package_id):
            raise StickerPackError('STICKER_PACK_INVALID_ID')
        query = self._query(query, allow_empty=True)
        packages, items = self._read()
        if not any(package['id'] == package_id for package in packages):
            raise StickerPackError('STICKER_PACK_NOT_FOUND', 404)
        matches = [item for item in items if item['packId'] == package_id and
                   (not query or query in (item['caption'] + ' ' + item['packName']).casefold())]
        end = min(offset + limit, len(matches))
        return self._result(items=[dict(item) for item in matches[offset:end]], total=len(matches),
                            nextOffset=end if end < len(matches) else None)

    def check_chat(self, key):
        self._check()
        if not isinstance(key, str) or not self.allowed(key):
            raise StickerPackError('STICKER_PACK_CHAT_NOT_ALLOWED', 403)

    def prepare(self, conversation_key, reference):
        self.check_chat(conversation_key)
        if not isinstance(reference, str) or not re.fullmatch('[a-f0-9]{64}', reference):
            raise StickerPackError('STICKER_PACK_INVALID_ID')
        if self.decoder is None or self.resources is None:
            raise StickerPackError('STICKER_PACK_SEND_UNAVAILABLE', 503)
        with self.lock:
            self._read()
            location = self.locations.get(reference)
            item = next((item for item in self.cached[3] if item['id'] == reference), None)
        if not location or not item:
            raise StickerPackError('STICKER_PACK_NOT_FOUND', 404)
        from wechat_sticker_pack_codec import PackCodecError
        from wechat_sticker_send import native_gif_bytes
        try:
            raw = self.local_library.bytes(location[1]) if location[0] is None else native_gif_bytes(self.decoder(*location))
            self.check_chat(conversation_key)
            # Recheck membership after decoding in case the collection was removed.
            with self.lock:
                self._read()
                if self.locations.get(reference) != location:
                    raise StickerPackError('STICKER_PACK_NOT_FOUND', 404)
            resource_id = self.resources.prepare(conversation_key, raw)
            self.check_chat(conversation_key)
            return {'ready': True, 'id': resource_id, 'source': SOURCE,
                    'description': item['caption'] or item['packName'], 'tags': ['daily'],
                    'packName': item['packName'], 'collection': 'local-library' if location[0] is None else 'wechat-installed',
                    'notice': '临时发送资源已校验，不写入表情包池；实际发送由桥接层确认。'}
        except StickerPackError:
            raise
        except PackCodecError as error:
            raise StickerPackError(str(error), 503) from None
        except Exception:
            raise StickerPackError('STICKER_PACK_PREPARE_FAILED', 503) from None

    @staticmethod
    def _query(query, allow_empty=False):
        if not isinstance(query, str) or len(query) > 120 or re.search(r'[\x00-\x1f\x7f]', query):
            raise StickerPackError('STICKER_PACK_INVALID_QUERY')
        query = query.strip().casefold()
        if not query and not allow_empty:
            raise StickerPackError('STICKER_PACK_INVALID_QUERY')
        return query

    def search(self, conversation_key, query, limit=MAX_CANDIDATES):
        _page(0, limit, MAX_CANDIDATES)
        self._check()
        if not isinstance(conversation_key, str) or not self.allowed(conversation_key):
            raise StickerPackError('STICKER_PACK_CHAT_NOT_ALLOWED', 403)
        query = self._query(query)
        _, items = self._read()
        terms = set(re.findall(r'[a-z0-9]+|[\u3400-\u9fff]+', query))
        terms.update(query[index:index + 2] for index in range(len(query) - 1)
                     if all('\u3400' <= char <= '\u9fff' for char in query[index:index + 2]))
        scene_terms = set()
        for triggers, related in SCENES:
            if any(trigger.casefold() in query for trigger in triggers.split()):
                scene_terms.update(word.casefold() for word in related.split())
        def score(item):
            caption = (item['caption']+' '+item.get('keywords','')).strip().casefold()
            if not caption:
                return 0
            return (100 if query == caption else 50 if query in caption or caption in query else 0) + \
                   sum(10 for term in terms if term in caption) + sum(4 for term in scene_terms if term in caption)
        ranked = [(score(item), index, item) for index, item in enumerate(items)]
        ranked.sort(key=lambda row: (row[2].get('packId')!='__local_library__',-row[0],row[1]))
        if not self.allowed(conversation_key):
            raise StickerPackError('STICKER_PACK_CHAT_NOT_ALLOWED', 403)
        return self._result(candidates=[dict(item) for points, _, item in ranked if points > 0][:limit])


def sticker_pack_response(catalogue, route, query):
    def value(name, default=''):
        values = query.get(name, [default])
        if len(values) != 1:
            raise StickerPackError('STICKER_PACK_INVALID_QUERY')
        return values[0]
    def integer(name, default):
        raw = value(name, str(default))
        if not isinstance(raw, str) or not re.fullmatch(r'[0-9]{1,7}', raw):
            raise StickerPackError('STICKER_PACK_INVALID_PAGE')
        return int(raw)
    if route == BASE_ROUTE:
        return catalogue.packages(integer('offset', 0), integer('limit', 50))
    if route == BASE_ROUTE + '/items':
        return catalogue.items(value('packId'), value('query'), integer('offset', 0), integer('limit', 50))
    if route == BASE_ROUTE + '/search':
        return catalogue.search(value('conversationKey'), value('query'), integer('limit', MAX_CANDIDATES))
    raise StickerPackError('STICKER_PACK_ROUTE_NOT_FOUND', 404)


class PackSendResources(MemeSendResources):
    """Reuse the bounded send cache without requiring meme-library permission."""
    def __init__(self, pool, catalogue):
        super().__init__(pool)
        self.catalogue = catalogue

    def allowed(self, key):
        self.catalogue.check_chat(key)

    def prepare(self, key, raw):
        image_id = super().prepare(key, raw)
        with self.lock:
            self.items[image_id]['resource']['origin'] = SOURCE
        return image_id
