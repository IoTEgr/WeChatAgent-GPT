"""Account-scoped local sticker catalogue, separate from automatic collection."""
import hashlib,json,pathlib,re,threading,uuid
from wechat_sticker_collection import StickerCollection,HEX,MAX_FILE
from wechat_sticker_manager import StickerManager,ManagerError
from wechat_sticker_labels import clean_label

LOCAL_LIMIT=10000

class LocalStickerLibrary(StickerCollection):
    def __init__(self,root,account,own_wxid,active=lambda:True):
        super().__init__(root,account,own_wxid,active)
        self.account_key=hashlib.sha256(('local-library\0'+self.account_key).encode()).hexdigest()
        self.folder=self.root/'state/stickers/local-library'/self.account_key[:32]
        self.index=self.folder/'index.json'
        self.manager=StickerManager(self,limit=LOCAL_LIMIT,max_frames=1200,max_pixels=160_000_000)

    def safe(self,file):
        file=pathlib.Path(file);base=self.root/'state/stickers/local-library'
        if not file.resolve().is_relative_to(base):raise RuntimeError('LOCAL_STICKER_PATH_INVALID')
        for part in [file,*file.parents]:
            if part==self.root:break
            if part.is_symlink() or getattr(part,'is_junction',lambda:False)():raise RuntimeError('LOCAL_STICKER_PATH_INVALID')
        return file

    def empty(self):
        return {'version':1,'account':self.account_key,'entries':{},'waiting':{},'archive':{},'aliases':{},'removed':{},'review':None}

    def read(self):
        self.safe(self.index)
        if not self.index.exists():return self.empty()
        if not self.index.is_file() or self.index.stat().st_size>16*1024*1024:raise RuntimeError('LOCAL_STICKER_INDEX_INVALID')
        state=json.loads(self.index.read_text(encoding='utf-8-sig'))
        if state.get('version')!=1 or state.get('account')!=self.account_key or not isinstance(state.get('entries'),dict) or len(state['entries'])>LOCAL_LIMIT:raise RuntimeError('LOCAL_STICKER_INDEX_INVALID')
        for digest,item in state['entries'].items():
            fields=item.get('fields',{}) if isinstance(item,dict) else {}
            if not HEX.fullmatch(digest) or not re.fullmatch('[a-f0-9]{32}',str(fields.get('md5',''))):raise RuntimeError('LOCAL_STICKER_INDEX_INVALID')
            if any(type(fields.get(n))is not int or not 0<fields[n]<=m for n,m in [('len',MAX_FILE),('width',4096),('height',4096)]):raise RuntimeError('LOCAL_STICKER_INDEX_INVALID')
            clean_label(item.get('manualLabel',{}))
        return {**self.empty(),**state}

    def write(self,state):
        if not self.active():raise ManagerError('STICKER_MANAGER_ACCOUNT_CHANGED',409)
        if len(state['entries'])>LOCAL_LIMIT:raise ManagerError('STICKER_MANAGER_FULL',409)
        text=json.dumps(state,ensure_ascii=False)
        if len(text.encode())>16*1024*1024:raise RuntimeError('LOCAL_STICKER_INDEX_FULL')
        self.safe(self.folder).mkdir(parents=True,exist_ok=True)
        temp=self.safe(self.folder/('index.'+uuid.uuid4().hex+'.tmp'));temp.write_text(text,encoding='utf-8');temp.replace(self.index)

    def signature(self):
        self.safe(self.index)
        try:s=self.index.stat();return(s.st_size,s.st_mtime_ns)
        except FileNotFoundError:return None

    def catalogue(self):
        if not self.active():raise ManagerError('STICKER_MANAGER_ACCOUNT_CHANGED',409)
        with self.lock:
            result=[]
            for digest,item in self.read()['entries'].items():
                label=clean_label(item['manualLabel'])
                reference=hashlib.sha256(('local-library\0'+self.account_key+'\0'+digest).encode()).hexdigest()
                result.append({'id':reference,'digest':digest,'packId':'__local_library__','packName':'本地表情包库','caption':label['description'],'keywords':' '.join(label['tags'])})
            return result

    def bytes(self,digest):
        if not self.active():raise ManagerError('STICKER_MANAGER_ACCOUNT_CHANGED',409)
        with self.lock:
            item=self.read()['entries'].get(digest)
            if not item:raise ManagerError('STICKER_MANAGER_NOT_FOUND',404)
            return self.verified_bytes(digest,item)
