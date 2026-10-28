// Weixin 4.1.10.27, reviewed aixed/WeChat-Hook e905d07 text path.
// Independent sender: no detours, observers, quote CGI, or input simulation.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
namespace {
HMODULE moduleHandle; uintptr_t base; char token[64]; INIT_ONCE once=INIT_ONCE_STATIC_INIT; LONG ready=0,sends=0;
CRITICAL_SECTION guard;
#pragma pack(push,1)
struct Command {uint32_t magic,size,op,cgi;char token[64];uint32_t length,ready,managerReady,attempted,responseReady;int32_t error;uint32_t responseLength;unsigned char response[1024],data[16384];};
struct WxString {char bytes[16];uint64_t length,cap;};
struct Text {uint64_t p0[22];WxString receiver;uint64_t p1[1],type,p2[21],length,p3[163];WxString uuid;uint64_t p4[8];WxString content,atList;};
struct Block {uint64_t vtable,temp[6],self;};
#pragma pack(pop)
static_assert(sizeof(WxString)==32,"string layout");
static_assert(offsetof(Text,receiver)==0xb0,"receiver layout");
static_assert(offsetof(Text,content)==0x708,"text layout");
static_assert(offsetof(Text,atList)==0x728&&sizeof(Text)==0x748,"at_user_list layout");
typedef uintptr_t (*Call)(...);
void* Alloc(size_t bytes){return HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,bytes);}
bool Executable(uintptr_t address){MEMORY_BASIC_INFORMATION m;return VirtualQuery((void*)address,&m,sizeof(m))&&m.State==MEM_COMMIT&&(m.Protect&(PAGE_EXECUTE|PAGE_EXECUTE_READ|PAGE_EXECUTE_READWRITE|PAGE_EXECUTE_WRITECOPY));}
BOOL CALLBACK Init(PINIT_ONCE,PVOID,PVOID*){
 base=(uintptr_t)GetModuleHandleW(L"Weixin.dll");if(!base||!Executable(base+0x6b2c30)||!Executable(base+0xdf40)||!Executable(base+0x1677a30))return TRUE;
 wchar_t file[32768];DWORD n=GetModuleFileNameW(moduleHandle,file,32768);if(!n||n>=32768)return TRUE;
 wchar_t* slash=wcsrchr(file,L'\\');if(!slash)return TRUE;*slash=0;slash=wcsrchr(file,L'\\');if(!slash)return TRUE;
 wcscpy_s(slash,32768-(slash-file),L"\\native-token.txt");
 HANDLE input=CreateFileW(file,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);if(input==INVALID_HANDLE_VALUE)return TRUE;
 DWORD got=0;BOOL ok=ReadFile(input,token,64,&got,NULL);CloseHandle(input);if(!ok||got!=64)return TRUE;
 for(int i=0;i<64;i++)if(!((token[i]>='a'&&token[i]<='f')||(token[i]>='0'&&token[i]<='9')))return TRUE;
 InitializeCriticalSection(&guard);ready=1;return TRUE;
}
bool Set(WxString* dest,const unsigned char* bytes,uint32_t length){
 memset(dest,0,sizeof(*dest));dest->length=length;
 if(length<16){memcpy(dest->bytes,bytes,length);dest->cap=15;return true;}
 char* ptr=(char*)Alloc(length+1);if(!ptr)return false;memcpy(ptr,bytes,length);*(char**)dest->bytes=ptr;dest->cap=((length+1+15)&~15ULL)-1;return true;
}
void Send(Command* c){
 __try{
  uint32_t* sizes=(uint32_t*)c->data;uint32_t target=sizes[0],text=sizes[1],member=sizes[2];
  if(target<10||target>200||!text||text>13000||!member||member>128||12+target+text+member!=c->length){c->error=7;return;}
  const unsigned char* p=c->data+12;
  if(memcmp(p+target-9,"@chatroom",9)||p[target]!='@'){c->error=7;return;}
  const unsigned char* at=p+target+text;
  for(uint32_t i=0;i<member;i++){unsigned char ch=at[i];if(!((ch>='A'&&ch<='Z')||(ch>='a'&&ch<='z')||(ch>='0'&&ch<='9')||ch=='_'||ch=='-')){c->error=7;return;}}
  if(member==10&&!memcmp(at,"notify_all",10)){c->error=7;return;}
  if(InterlockedIncrement(&sends)>4096){c->error=3;return;}
  uint64_t* msg=(uint64_t*)Alloc(0x768*8);uint64_t* data=(uint64_t*)Alloc(0x20*8);uint64_t* a1=(uint64_t*)Alloc(0x28*8);uint64_t* a2=(uint64_t*)Alloc(0xe8*8);
  uint64_t* buf=(uint64_t*)Alloc(16*8);Block* b2=(Block*)Alloc(64*8);Block* b3=(Block*)Alloc(64*8);Block* b4=(Block*)Alloc(64*8);
  if(!msg||!data||!a1||!a2||!buf||!b2||!b3||!b4){c->error=4;return;}
  msg[0]=base+0x8279358;msg[1]=0x200000005ULL;Text* body=(Text*)(msg+2);((Call)(base+0x6b2c30))((uintptr_t)body);
  if(!Set(&body->receiver,p,target)||!Set(&body->content,p+target,text)||!Set(&body->atList,at,member)){c->error=4;return;}
  body->length=text;body->type=1;data[0]=(uintptr_t)(msg+2);data[1]=(uintptr_t)msg;
  a1[0]=base+0x84ec9c8;a1[1]=(uintptr_t)data;a1[2]=(uintptr_t)data+16;a1[3]=(uintptr_t)data+16;a1[4]=1;
  b2->vtable=base+0x8595f58;b2->self=(uintptr_t)b2;b3->vtable=base+0x8595e98;b3->self=(uintptr_t)b3;b4->vtable=base+0x8595dd8;b4->self=(uintptr_t)b4;
  ((Call)(base+0xdf40))((uintptr_t)a2,(uintptr_t)b2,(uintptr_t)b3,(uintptr_t)b4,(uintptr_t)buf,*(uintptr_t*)(base+0xa0ce0b0));
  c->attempted=1;((Call)(base+0x1677a30))((uintptr_t)a1,(uintptr_t)a2);c->error=0;
  // Native owns deferred work. Keep allocations alive, as in reviewed sender.
 }__except(EXCEPTION_EXECUTE_HANDLER){c->error=6;}
}
}
extern "C" __declspec(dllexport) DWORD WINAPI WcaMentionCommand(void* pointer){
 Command* c=(Command*)pointer;
 __try{
  if(c->magic!=0x57434131||c->size!=sizeof(Command))return 1;InitOnceExecuteOnce(&once,Init,NULL,NULL);
  unsigned int difference=0;for(int i=0;i<64;i++)difference|=(unsigned char)c->token[i]^(unsigned char)token[i];
  if(difference||!ready){c->error=1;return 1;}c->ready=1;
  if(c->op==1)return 0;
  if(c->op!=2||c->cgi!=1||c->length>16384||c->length<12){c->error=7;return 1;}
  EnterCriticalSection(&guard);Send(c);LeaveCriticalSection(&guard);return c->error;
 }__except(EXCEPTION_EXECUTE_HANDLER){return 2;}
}
BOOL WINAPI DllMain(HMODULE module,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH){moduleHandle=module;DisableThreadLibraryCalls(module);}return TRUE;}
