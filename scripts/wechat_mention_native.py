"""Version-pinned text-mention companion. Probe never sends or installs hooks."""
import argparse
import ctypes as C
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import sys
import urllib.request
sys.path.insert(0,str(Path(__file__).resolve().parent))
from wechat_interaction_native import Command, kernel_api, modules, remote_call, export_rva, fault, PIN

def mention_payload(value):
    if not isinstance(value,dict):fault('INTERACTION_REQUEST_INVALID')
    target=value.get('target');member=value.get('member');text=value.get('text')
    if not isinstance(target,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,191}@chatroom',target):fault('INTERACTION_TARGET_INVALID')
    if not isinstance(member,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',member) or member=='notify_all':fault('INTERACTION_TARGET_INVALID')
    if not isinstance(text,str) or not text.startswith('@') or '\0' in text or not 1<=len(text)<=4100:fault('INTERACTION_TEXT_INVALID')
    # TextMessageSendSource.at_user_list is the raw member list. Weixin wraps
    # it in <msgsource><atuserlist> itself; passing XML makes a nested literal.
    fields=[part.encode('utf-8') for part in (target,text,member)]
    if len(fields[1])>13000:fault('INTERACTION_TEXT_INVALID')
    return struct.pack('<III',*(len(part) for part in fields))+b''.join(fields)

def native_command(root,value=None):
    payload=mention_payload(value) if value is not None else b''
    root=Path(root).resolve();config=json.loads((root/'config/wechatagent.json').read_text(encoding='utf-8-sig'))
    token=(root/'state/hook/native-token.txt').read_text().strip()
    if not re.fullmatch('[a-f0-9]{64}',token):fault('INTERACTION_TOKEN_INVALID')
    base=config['hook']['baseUrl'].rstrip('/')
    if not re.fullmatch(r'http://127\.0\.0\.1:\d{1,5}',base):fault('INTERACTION_ENDPOINT_INVALID')
    request=urllib.request.Request(base+'/WeChatAgent/health',headers={'Authorization':'Bearer '+token})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=4) as response:health=json.load(response)
    accounts=health.get('databaseAccounts',[])
    if health.get('version')!='4.1.10.27' or health.get('integration')!='WeChatAgent-1' or len(accounts)!=1:fault('INTERACTION_ACCOUNT_UNAVAILABLE')
    if value is not None and (value.get('account')!=accounts[0].lower() or config.get('wechat',{}).get('interactions',{}).get('enabled') is not True):fault('INTERACTION_ACCOUNT_UNAVAILABLE')
    directory=root/'state/hook/mentions';directory.mkdir(parents=True,exist_ok=True)
    bundled=root/'assets/mentions';origin=bundled if (bundled/'build.json').is_file() else directory
    build=json.loads((origin/'build.json').read_text(encoding='utf-8-sig'));file=origin/'WeChatMentions.dll'
    if build.get('backend')!='text-atlist-v2' or build.get('weixinSha256')!=PIN or hashlib.sha256(file.read_bytes()).hexdigest()!=build.get('sha256'):fault('INTERACTION_BUILD_MISMATCH')
    pid=int(health['pid']);k=kernel_api();loaded=modules(k,pid)
    weixin=next((path for name,path,_ in loaded if name.lower()=='weixin.dll'),None)
    if not weixin or hashlib.sha256(weixin.read_bytes()).hexdigest()!=PIN:fault('INTERACTION_WEIXIN_MISMATCH')
    versioned=directory/('WeChatMentions-'+build['sha256'][:16]+'.dll')
    if not versioned.exists():shutil.copy2(file,versioned)
    if hashlib.sha256(versioned.read_bytes()).hexdigest()!=build['sha256']:fault('INTERACTION_BUILD_MISMATCH')
    address=next((address for _,path,address in loaded if str(path).lower()==str(versioned).lower()),None)
    process=k.OpenProcess(0x43a,False,pid)
    if not process:fault('INTERACTION_PROCESS_UNAVAILABLE')
    try:
        if not address:
            load=k.GetProcAddress(k.GetModuleHandleW('kernel32.dll'),b'LoadLibraryW')
            remote_call(k,process,load,(str(versioned)+'\0').encode('utf-16-le'),10000)
            address=next((address for _,path,address in modules(k,pid) if str(path).lower()==str(versioned).lower()),None)
            if not address:fault('INTERACTION_LOAD_FAILED')
        command=Command();command.magic=0x57434131;command.size=C.sizeof(command);command.op=2 if value is not None else 1;command.cgi=1 if payload else 0;command.token=token.encode();command.length=len(payload)
        if payload:C.memmove(C.addressof(command)+Command.data.offset,payload,len(payload))
        result=Command.from_buffer_copy(remote_call(k,process,address+export_rva(versioned,'WcaMentionCommand'),bytes(command),10000))
        if result.error or not result.ready:fault('INTERACTION_NATIVE_REJECTED' if not result.attempted else 'INTERACTION_CALL_UNCONFIRMED')
        validation=directory/'validated.json'
        verified=validation.is_file() and json.loads(validation.read_text(encoding='utf-8')).get('sha256')==build['sha256']
        return {'ready':True,'verified':verified,'attempted':bool(result.attempted),'ret':0,'backend':'text-atlist-v2'}
    finally:k.CloseHandle(process)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--probe',action='store_true');args=parser.parse_args()
    try:
        value=None if args.probe else json.loads(sys.stdin.buffer.read(18000).decode('utf-8'))
        if not args.probe and value is None:fault('INTERACTION_REQUEST_INVALID')
        print(json.dumps(native_command(args.root,value)))
    except Exception as error:
        code=str(error) if re.fullmatch('INTERACTION_[A-Z_]+',str(error)) else 'INTERACTION_UNAVAILABLE'
        print(json.dumps({'ok':False,'error':code}));sys.exit(1)
