"""Pinned native quote/pat service. Genuine native queries; no window control."""
import argparse
import ctypes as C
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import sys
import time
import urllib.request
from urllib.parse import quote
import xml.etree.ElementTree as ET
sys.path.insert(0,str(Path(__file__).resolve().parent))
from wechat_interaction_native import Command,kernel_api,modules,remote_call,export_rva,fault,PIN

BACKEND='native-interaction-service-v1'
QUOTE_TYPE=(57<<32)|49
def decimal(value,maximum):
    if isinstance(value,bool) or not re.fullmatch(r'[1-9]\d{0,19}',str(value)):fault('INTERACTION_REFERENCE_UNAVAILABLE')
    number=int(value)
    if number>maximum:fault('INTERACTION_REFERENCE_UNAVAILABLE')
    return number

def request_scope(value):
    if not isinstance(value,dict) or value.get('action') not in ('quote','pat'):fault('INTERACTION_REQUEST_INVALID')
    if value.get('conversationKind') not in ('group','private') or not re.fullmatch(r'[1-9]\d{0,15}',str(value.get('conversationTarget',''))):fault('INTERACTION_TARGET_INVALID')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,191}(?:@chatroom)?',str(value.get('chat',''))):fault('INTERACTION_TARGET_INVALID')
    if (value['conversationKind']=='group')!=value['chat'].endswith('@chatroom'):fault('INTERACTION_TARGET_INVALID')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',str(value.get('target',''))) or value['target']=='notify_all':fault('INTERACTION_TARGET_INVALID')
    if not re.fullmatch(r'[a-f0-9]{64}',str(value.get('referenceId',''))):fault('INTERACTION_REFERENCE_UNAVAILABLE')
    text=value.get('text')
    if not isinstance(text,str) or '\0' in text or len(text)>4000 or len(text.encode('utf-8'))>13000 or (value['action']=='quote' and not text.strip()) or (value['action']=='pat' and text):fault('INTERACTION_TEXT_INVALID')

def interaction_payload(value,row,own,account,now=None):
    request_scope(value);now=time.time() if now is None else now
    if value.get('account')!=account or value.get('self')!=own or value['target']==own:fault('INTERACTION_ACCOUNT_UNAVAILABLE')
    if not isinstance(row,dict) or row.get('wechatagentMessageId')!=value['referenceId'] or row.get('isSend') not in (False,0) or row.get('senderUsername')!=value['target']:fault('INTERACTION_REFERENCE_UNAVAILABLE')
    try:created=float(row['createTime'])
    except (KeyError,TypeError,ValueError):fault('INTERACTION_REFERENCE_UNAVAILABLE')
    if not now-3600<=created<=now+60:fault('INTERACTION_REFERENCE_UNAVAILABLE')
    server=decimal(row.get('serverId'),2**64-1);local=decimal(row.get('localId'),2**32-1);kind=decimal(row.get('localType'),2**64-1)
    if value['action']=='quote' and kind!=1:fault('INTERACTION_REFERENCE_UNAVAILABLE')
    session=value['chat'].encode('utf-8');sender=value['target'].encode('utf-8');text=value['text'].encode('utf-8')
    return struct.pack('<QIIIQ',server,len(session),len(sender),local,kind)+session+sender+text

def conversation_id(session):
    if session.get('conversationId') is not None:return str(session['conversationId'])
    key=session['username']
    if key.endswith('@chatroom'):key=re.sub(r'\s*\(\d+\)\s*$','',session.get('displayName') or key).strip()
    return str(int.from_bytes(hashlib.sha256(key.encode('utf-8')).digest()[:8],'big')%2147483647+1)

def quote_receipt(rows,baseline,value,server_id,started):
    matches=[]
    for row in rows:
        if row.get('wechatagentMessageId') in baseline or not row.get('isSend') or str(row.get('localType'))!=str(QUOTE_TYPE):continue
        try:
            if float(row['createTime'])<started-30:continue
            body=str(row.get('fullText') or row.get('rawContent') or row.get('content') or '')
            if len(body)>100000:continue
            begin=body.find('<msg')
            if begin<0:begin=body.find('<appmsg')
            if begin<0:continue
            tree=ET.fromstring(body[begin:]);app=tree if tree.tag=='appmsg' else tree.find('appmsg')
            if app is None or app.findtext('title')!=value['text'] or app.findtext('refermsg/svrid')!=str(server_id):continue
            receipt=decimal(row.get('serverId'),2**64-1);matches.append(str(receipt))
        except (ValueError,TypeError,KeyError,ET.ParseError):continue
    return matches[0] if len(matches)==1 else None

def native_command(root,value=None,dry=False):
    if value is not None:request_scope(value)
    root=Path(root).resolve();config=json.loads((root/'config/wechatagent.json').read_text(encoding='utf-8-sig'));api=json.loads((root/'state/wechat-io-config.json').read_text(encoding='utf-8-sig'))
    settings=config.get('wechat',{}).get('interactions',{})
    if settings.get('enabled') is not True or value is not None and settings.get(value['action']) is not True:fault('INTERACTION_DISABLED')
    token=(root/'state/hook/native-token.txt').read_text().strip()
    if not re.fullmatch('[a-f0-9]{64}',token):fault('INTERACTION_TOKEN_INVALID')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def get(base,route,secret):
        if not re.fullmatch(r'http://127\.0\.0\.1:\d{1,5}',base.rstrip('/')):fault('INTERACTION_ENDPOINT_INVALID')
        request=urllib.request.Request(base.rstrip('/')+route,headers={'Authorization':'Bearer '+secret})
        with opener.open(request,timeout=4) as response:return json.load(response)
    health=get(config['hook']['baseUrl'],'/WeChatAgent/health',token)
    if health.get('version')!='4.1.10.27' or health.get('integration')!='WeChatAgent-1' or len(health.get('databaseAccounts',[]))!=1:fault('INTERACTION_ACCOUNT_UNAVAILABLE')
    status=get(api['reader_base_url'],'/api/v1/reader/status',api['reader_token']);account=str(status.get('accountDirectory','')).lower();own=status.get('ownWxid')
    if not own or health['databaseAccounts'][0].lower()!=account:fault('INTERACTION_ACCOUNT_UNAVAILABLE')
    payload=b'';baseline=set();started=time.time();row=None
    if value is not None:
        allowed=config['wechat']['whitelist']['groups' if value['conversationKind']=='group' else 'private']
        if str(value['conversationTarget']) not in list(map(str,allowed)):fault('INTERACTION_DISABLED')
        sessions=get(api['reader_base_url'],'/api/v1/sessions?limit=500',api['reader_token']).get('sessions',[])
        mapped=[s for s in sessions if s.get('username') and conversation_id(s)==str(value['conversationTarget']) and s['username'].endswith('@chatroom')==(value['conversationKind']=='group')]
        if len(mapped)!=1 or mapped[0]['username']!=value['chat']:fault('INTERACTION_TARGET_INVALID')
        rows=get(api['reader_base_url'],'/api/v1/messages?talker='+quote(value['chat'])+'&limit=300',api['reader_token']).get('messages',[])
        matches=[r for r in rows if r.get('wechatagentMessageId')==value['referenceId']]
        if len(matches)!=1:fault('INTERACTION_REFERENCE_UNAVAILABLE')
        row=matches[0];payload=interaction_payload(value,row,own,account);baseline={r.get('wechatagentMessageId') for r in rows}
    origin=root/'assets/native-interactions';build=json.loads((origin/'build.json').read_text(encoding='utf-8-sig'));source=origin/'WeChatInteractionService.dll';validation=json.loads((origin/'validated.json').read_text(encoding='utf-8-sig'))
    if build.get('backend')!=BACKEND or build.get('weixinSha256')!=PIN or hashlib.sha256(source.read_bytes()).hexdigest()!=build.get('sha256') or validation.get('sha256')!=build.get('sha256') or validation.get('features')!=['quote','pat','senderEcho']:fault('INTERACTION_BUILD_MISMATCH')
    k=kernel_api();pid=int(health['pid']);loaded=modules(k,pid);weixin=next((path for name,path,_ in loaded if name.lower()=='weixin.dll'),None)
    if not weixin or hashlib.sha256(weixin.read_bytes()).hexdigest()!=PIN:fault('INTERACTION_WEIXIN_MISMATCH')
    directory=root/'state/hook/interaction-service';directory.mkdir(parents=True,exist_ok=True);versioned=directory/('WeChatInteractionService-'+build['sha256'][:16]+'.dll')
    if not versioned.exists():shutil.copy2(source,versioned)
    if hashlib.sha256(versioned.read_bytes()).hexdigest()!=build['sha256']:fault('INTERACTION_BUILD_MISMATCH')
    address=next((address for _,path,address in loaded if str(path).lower()==str(versioned).lower()),None);process=k.OpenProcess(0x43a,False,pid)
    if not process:fault('INTERACTION_PROCESS_UNAVAILABLE')
    try:
        if not address:
            remote_call(k,process,k.GetProcAddress(k.GetModuleHandleW('kernel32.dll'),b'LoadLibraryW'),(str(versioned)+'\0').encode('utf-16-le'),10000)
            address=next((address for _,path,address in modules(k,pid) if str(path).lower()==str(versioned).lower()),None)
            if not address:fault('INTERACTION_LOAD_FAILED')
        command=Command();command.magic=0x57434131;command.size=C.sizeof(command);command.op=1 if value is None else 2 if dry else 3;command.cgi=0 if value is None else 1 if value['action']=='quote' else 2;command.token=token.encode();command.length=len(payload)
        if payload:C.memmove(C.addressof(command)+Command.data.offset,payload,len(payload))
        result=Command.from_buffer_copy(remote_call(k,process,address+export_rva(versioned,'WcaInteractionService'),bytes(command),25000))
        out={'ready':bool(result.ready),'managerReady':bool(result.managerReady),'attempted':value is not None and not dry and (bool(result.response[10]) or result.error==10),'responseReady':False,'backend':BACKEND,'capabilities':{'quote':True,'pat':True,'senderEcho':True},'ret':0,'nativeError':result.error}
        if result.error or not result.ready:
            if value is None or dry or not out['attempted']:fault('INTERACTION_NATIVE_REJECTED')
            return out
        if value is None:return out
        applicable=10 if value['action']=='quote' else 9
        if not result.responseReady or result.responseLength!=12 or not all(result.response[:applicable]):return out
        if dry:return {**out,'attempted':False,'dry':True,'checksPassed':applicable}
        if value['action']=='pat':return {**out,'responseReady':True,'ret':0 if result.response[11] else 1,'senderEcho':bool(result.response[11])}
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            try:
                rows=get(api['reader_base_url'],'/api/v1/messages?talker='+quote(value['chat'])+'&limit=100',api['reader_token']).get('messages',[])
                receipt=quote_receipt(rows,baseline,value,row['serverId'],started)
                if receipt:return {**out,'responseReady':True,'serverMessageId':receipt,'senderEcho':True}
            except Exception:pass
            time.sleep(.4)
        return out
    finally:k.CloseHandle(process)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--probe',action='store_true');parser.add_argument('--dry',action='store_true');args=parser.parse_args()
    try:
        value=None if args.probe else json.loads(sys.stdin.buffer.read(18000).decode('utf-8'))
        if not args.probe and value is None:fault('INTERACTION_REQUEST_INVALID')
        print(json.dumps(native_command(args.root,value,args.dry)))
    except Exception as error:
        code=str(error) if re.fullmatch('INTERACTION_[A-Z_]+',str(error)) else 'INTERACTION_UNAVAILABLE'
        print(json.dumps({'ok':False,'error':code}));sys.exit(1)
