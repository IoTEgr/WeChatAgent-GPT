"""Authenticated, version-pinned bridge to the optional interaction companion.

The probe installs passive observers only. Sending is an explicit separate op.
Never dump native memory, authentication tokens or raw protocol responses.
"""
import argparse
import ctypes as C
from ctypes import wintypes as W
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import sys
import time
import urllib.request

MAGIC=0x57434131
PIN='f487e4f56930456a25fb0d7b058c77e2dcd364e268d49bdfff4dc0e3be26ba36'
class Command(C.LittleEndianStructure):
    _pack_=1
    _fields_=[('magic',C.c_uint32),('size',C.c_uint32),('op',C.c_uint32),('cgi',C.c_uint32),('token',C.c_char*64),('length',C.c_uint32),('ready',C.c_uint32),('managerReady',C.c_uint32),('attempted',C.c_uint32),('responseReady',C.c_uint32),('error',C.c_int32),('responseLength',C.c_uint32),('response',C.c_ubyte*1024),('data',C.c_ubyte*16384)]
def fault(code):
    raise ValueError(code)
def varint(value):
    if not isinstance(value,int) or not 0<=value<1<<64:fault('INTERACTION_PROTO_INVALID')
    out=bytearray()
    while value>127:out.append((value&127)|128);value>>=7
    out.append(value);return bytes(out)
def field(number,value):
    if isinstance(value,int):return varint(number<<3)+varint(value)
    if isinstance(value,str):value=value.encode('utf-8')
    return varint((number<<3)|2)+varint(len(value))+value
def decode_fields(data):
    result=[];at=0
    def read():
        nonlocal at
        value=0
        for shift in range(0,70,7):
            if at>=len(data):fault('INTERACTION_RESPONSE_INVALID')
            byte=data[at];at+=1;value|=(byte&127)<<shift
            if not byte&128:return value
        fault('INTERACTION_RESPONSE_INVALID')
    while at<len(data):
        tag=read();wire=tag&7
        if not tag>>3:fault('INTERACTION_RESPONSE_INVALID')
        if wire==0:value=read()
        elif wire==2:
            size=read()
            if at+size>len(data):fault('INTERACTION_RESPONSE_INVALID')
            value=data[at:at+size];at+=size
        elif wire in (1,5):
            size=8 if wire==1 else 4
            if at+size>len(data):fault('INTERACTION_RESPONSE_INVALID')
            value=data[at:at+size];at+=size
        else:fault('INTERACTION_RESPONSE_INVALID')
        result.append((tag>>3,wire,value))
    return result
def response_status(data):
    values=decode_fields(data);base=next((v for n,w,v in values if n==1 and w==2),None)
    if base is None:fault('INTERACTION_RESPONSE_INVALID')
    ret=next((v for n,w,v in decode_fields(base) if n==1 and w==0),None)
    if ret is None:fault('INTERACTION_RESPONSE_INVALID')
    ret=ret&0xffffffff
    if ret&0x80000000:ret-=1<<32
    # Keep identifiers as strings. Do not expose arbitrary response fields.
    result={'ret':ret,'serverIds':[str(v) for n,w,v in values if n in (2,3,4,9) and w==0 and v>0]}
    server=next((v for n,w,v in values if n==9 and w==0 and v>0),None)
    if server is not None:result['serverMessageId']=str(server)
    return result
def identifier(value,group=False):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_.@-]{1,200}',value) or ('@chatroom' in value and not group):fault('INTERACTION_TARGET_INVALID')
    return value
def quoted_request(args,now=None):
    import xml.etree.ElementTree as ET
    sender=identifier(args.get('self'));target=identifier(args.get('target'),True)
    ref=args.get('reference')
    if not isinstance(ref,dict):fault('INTERACTION_REFERENCE_INVALID')
    original=identifier(ref.get('sender'));server=str(ref.get('serverId',''))
    if not re.fullmatch(r'[1-9]\d{0,19}',server) or int(server)>=1<<64:fault('INTERACTION_REFERENCE_INVALID')
    reply=args.get('text');content=ref.get('text');name=ref.get('name')
    if not all(isinstance(v,str) and '\0' not in v for v in (reply,content,name)) or not 1<=len(reply)<=4000 or not 1<=len(content)<=4000 or len(name)>80:fault('INTERACTION_TEXT_INVALID')
    app=ET.Element('appmsg',{'appid':'','sdkver':'0'})
    for tag,value in [('title',reply),('des',''),('action',''),('type','57'),('showtype','0'),('soundtype','0'),('content',''),('url',''),('lowurl',''),('commenturl','')]:ET.SubElement(app,tag).text=value
    refer=ET.SubElement(app,'refermsg')
    for tag,value in [('type','1'),('svrid',server),('fromusr',target if target.endswith('@chatroom') else original),('chatusr',original),('displayname',name),('content',content),('createtime',str(int(ref.get('time',0))))]:ET.SubElement(refer,tag).text=value
    xml=ET.tostring(app,encoding='unicode',short_empty_elements=False)
    timestamp=int(time.time() if now is None else now);client=args.get('clientId')
    if not isinstance(client,str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,64}',client):fault('INTERACTION_DELIVERY_ID_INVALID')
    appmsg=b''.join(field(n,v) for n,v in [(1,sender),(3,0),(4,target),(5,57),(6,xml),(7,timestamp),(8,client),(12,'<msgsource><bizflag>0</bizflag></msgsource>')])
    base=b''.join(field(n,v) for n,v in [(1,b''),(2,0),(3,'Windows'),(4,0),(5,'Windows'),(6,0)])
    return field(1,base)+field(2,appmsg)

def pat_request(args):
    sender=identifier(args.get('self'));target=identifier(args.get('target'));chat=identifier(args.get('chat'),True);client=args.get('clientId')
    if not isinstance(client,str) or not re.fullmatch(r'[A-Za-z0-9_@.-]{8,128}',client):fault('INTERACTION_DELIVERY_ID_INVALID')
    base=b''.join(field(n,v) for n,v in [(1,b''),(2,0),(3,'Windows'),(4,0),(5,'Windows'),(6,0)])
    return b''.join(field(n,v) for n,v in [(1,base),(2,sender),(3,chat),(4,target),(5,client),(6,0)])

def export_rva(file,name):
    data=file.read_bytes();pe=struct.unpack_from('<I',data,0x3c)[0]
    if data[pe:pe+4]!=b'PE\0\0' or struct.unpack_from('<H',data,pe+4)[0]!=0x8664:fault('INTERACTION_DLL_INVALID')
    count=struct.unpack_from('<H',data,pe+6)[0];optional_size=struct.unpack_from('<H',data,pe+20)[0];optional=pe+24
    def offset(rva):
        for n in range(count):
            at=optional+optional_size+n*40;size,address,raw_size,raw=struct.unpack_from('<IIII',data,at+8)
            if address<=rva<address+max(size,raw_size):return raw+rva-address
        fault('INTERACTION_DLL_INVALID')
    directory=struct.unpack_from('<I',data,optional+112)[0];at=offset(directory)
    _,_,_,_,_,_,_,names_count,functions,names,ordinals=struct.unpack_from('<IIHHIIIIIII',data,at)
    for i in range(names_count):
        ptr=offset(struct.unpack_from('<I',data,offset(names)+i*4)[0]);end=data.index(0,ptr)
        if data[ptr:end].decode('ascii')==name:
            ordinal=struct.unpack_from('<H',data,offset(ordinals)+i*2)[0]
            return struct.unpack_from('<I',data,offset(functions)+ordinal*4)[0]
    fault('INTERACTION_EXPORT_MISSING')

def kernel_api():
    if os.name!='nt' or C.sizeof(C.c_void_p)!=8:fault('INTERACTION_WINDOWS_X64_REQUIRED')
    k=C.WinDLL('kernel32',use_last_error=True)
    declarations={
      'OpenProcess':([W.DWORD,W.BOOL,W.DWORD],W.HANDLE),'CloseHandle':([W.HANDLE],W.BOOL),
      'CreateToolhelp32Snapshot':([W.DWORD,W.DWORD],W.HANDLE),
      'VirtualAllocEx':([W.HANDLE,C.c_void_p,C.c_size_t,W.DWORD,W.DWORD],C.c_void_p),'VirtualFreeEx':([W.HANDLE,C.c_void_p,C.c_size_t,W.DWORD],W.BOOL),
      'WriteProcessMemory':([W.HANDLE,C.c_void_p,C.c_void_p,C.c_size_t,C.POINTER(C.c_size_t)],W.BOOL),'ReadProcessMemory':([W.HANDLE,C.c_void_p,C.c_void_p,C.c_size_t,C.POINTER(C.c_size_t)],W.BOOL),
      'CreateRemoteThread':([W.HANDLE,C.c_void_p,C.c_size_t,C.c_void_p,C.c_void_p,W.DWORD,C.POINTER(W.DWORD)],W.HANDLE),'WaitForSingleObject':([W.HANDLE,W.DWORD],W.DWORD),
      'GetModuleHandleW':([W.LPCWSTR],W.HMODULE),'GetProcAddress':([W.HMODULE,C.c_char_p],C.c_void_p)}
    for name,(args,result) in declarations.items():getattr(k,name).argtypes=args;getattr(k,name).restype=result
    return k
class Module(C.Structure):
    _fields_=[('size',W.DWORD),('id',W.DWORD),('pid',W.DWORD),('globalUsage',W.DWORD),('usage',W.DWORD),('address',C.c_void_p),('moduleSize',W.DWORD),('module',W.HMODULE),('name',W.WCHAR*256),('path',W.WCHAR*260)]
def modules(k,pid):
    snapshot=k.CreateToolhelp32Snapshot(0x18,pid)
    if snapshot in (None,C.c_void_p(-1).value):fault('INTERACTION_PROCESS_UNAVAILABLE')
    result=[]
    try:
        for name in ['Module32FirstW','Module32NextW']:getattr(k,name).argtypes=[W.HANDLE,C.POINTER(Module)];getattr(k,name).restype=W.BOOL
        item=Module();item.size=C.sizeof(item);ok=k.Module32FirstW(snapshot,C.byref(item))
        while ok:result.append((item.name,Path(item.path),item.address));ok=k.Module32NextW(snapshot,C.byref(item))
    finally:k.CloseHandle(snapshot)
    return result
def remote_call(k,process,address,payload,timeout):
    remote=k.VirtualAllocEx(process,None,len(payload),0x3000,4)
    if not remote:fault('INTERACTION_ALLOC_FAILED')
    running=False;thread=None
    try:
        buffer=C.create_string_buffer(payload);count=C.c_size_t()
        if not k.WriteProcessMemory(process,remote,buffer,len(payload),C.byref(count)) or count.value!=len(payload):fault('INTERACTION_WRITE_FAILED')
        thread=k.CreateRemoteThread(process,None,0,address,remote,0,None)
        if not thread:fault('INTERACTION_THREAD_FAILED')
        running=True
        if k.WaitForSingleObject(thread,timeout)!=0:fault('INTERACTION_CALL_UNCONFIRMED')
        running=False;out=C.create_string_buffer(len(payload))
        if not k.ReadProcessMemory(process,remote,out,len(payload),C.byref(count)) or count.value!=len(payload):fault('INTERACTION_READ_FAILED')
        return out.raw
    finally:
        if thread:k.CloseHandle(thread)
        if not running:k.VirtualFreeEx(process,remote,0,0x8000)
def native_command(root,cgi=None,payload=b'',base_probe=False):
    if cgi not in (None,849):fault('INTERACTION_ACTION_UNAVAILABLE')
    root=Path(root).resolve();config=json.loads((root/'config/wechatagent.json').read_text(encoding='utf-8-sig'));token=(root/'state/hook/native-token.txt').read_text().strip()
    if not re.fullmatch('[a-f0-9]{64}',token):fault('INTERACTION_TOKEN_INVALID')
    base=config['hook']['baseUrl'].rstrip('/')
    if not re.fullmatch(r'http://127\.0\.0\.1:\d{1,5}',base):fault('INTERACTION_ENDPOINT_INVALID')
    request=urllib.request.Request(base+'/WeChatAgent/health',headers={'Authorization':'Bearer '+token})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=4) as response:health=json.load(response)
    if health.get('version')!='4.1.10.27' or health.get('integration')!='WeChatAgent-1' or len(health.get('databaseAccounts',[]))!=1:fault('INTERACTION_ACCOUNT_UNAVAILABLE')
    pid=int(health['pid']);directory=root/'state/hook/interactions';directory.mkdir(parents=True,exist_ok=True)
    bundled=root/'assets/interactions';origin=bundled if (bundled/'build.json').is_file() else directory
    build=json.loads((origin/'build.json').read_text(encoding='utf-8-sig'));file=origin/'WeChatInteractions.dll'
    if build.get('backend')!='pat-cgi-wire-v1' or build.get('allowedCgi')!=[849]:fault('INTERACTION_BUILD_MISMATCH')
    if build.get('weixinSha256')!=PIN or hashlib.sha256(file.read_bytes()).hexdigest()!=build.get('sha256'):fault('INTERACTION_BUILD_MISMATCH')
    k=kernel_api();loaded=modules(k,pid);weixin=next((path for name,path,_ in loaded if name.lower()=='weixin.dll'),None)
    if not weixin or hashlib.sha256(weixin.read_bytes()).hexdigest()!=PIN:fault('INTERACTION_WEIXIN_MISMATCH')
    versioned=directory/('WeChatInteractions-'+build['sha256'][:16]+'.dll')
    if not versioned.exists():shutil.copy2(file,versioned)
    if hashlib.sha256(versioned.read_bytes()).hexdigest()!=build['sha256']:fault('INTERACTION_BUILD_MISMATCH')
    address=next((address for _,path,address in loaded if str(path).lower()==str(versioned).lower()),None)
    process=k.OpenProcess(0x43a,False,pid)
    if not process:fault('INTERACTION_PROCESS_UNAVAILABLE')
    try:
        if not address:
            load=k.GetProcAddress(k.GetModuleHandleW('kernel32.dll'),b'LoadLibraryW');remote_call(k,process,load,(str(versioned)+'\0').encode('utf-16-le'),10000)
            address=next((address for _,path,address in modules(k,pid) if str(path).lower()==str(versioned).lower()),None)
            if not address:fault('INTERACTION_LOAD_FAILED')
        command=Command();command.magic=MAGIC;command.size=C.sizeof(command);command.op=4 if base_probe else 2 if cgi else 1;command.cgi=cgi or 0;command.token=token.encode();command.length=len(payload)
        if len(payload)>16384 or cgi is not None and cgi!=849:fault('INTERACTION_PAYLOAD_INVALID')
        if payload:C.memmove(C.addressof(command)+Command.data.offset,payload,len(payload))
        result=Command.from_buffer_copy(remote_call(k,process,address+export_rva(versioned,'WcaInteractionCommand'),bytes(command),25000))
        output={'ready':bool(result.ready),'managerReady':bool(result.managerReady),'attempted':bool(result.attempted),'responseReady':bool(result.responseReady),'nativeError':result.error,'backend':'owned-cgi-wire-v1'}
        output['backend']='pat-cgi-wire-v1';output['capabilities']={'pat':True,'quote':False,'senderEcho':False}
        if command.op in (1,4):output['nativeBaseRequestBytes']=result.responseLength
        if result.responseReady:output.update(response_status(bytes(result.response[:result.responseLength])))
        return output
    finally:k.CloseHandle(process)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--probe',action='store_true');parser.add_argument('--base-probe',action='store_true');parser.add_argument('--native-input',action='store_true');args=parser.parse_args()
    if args.native_input:fault('INTERACTION_NATIVE_QUOTE_DISABLED')
    if args.probe or args.base_probe:result=native_command(args.root,base_probe=args.base_probe)
    else:
        value=json.loads(sys.stdin.buffer.read(24000).decode('utf-8'))
        if value.get('action')!='pat':fault('INTERACTION_ACTION_UNAVAILABLE')
        result=native_command(args.root,849,pat_request(value))
    print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error) if re.fullmatch('INTERACTION_[A-Z_]+',str(error)) else 'INTERACTION_UNAVAILABLE'
        print(json.dumps({'ok':False,'error':code}));sys.exit(1)
