// Weixin 4.1.10.27 full-native interactions, sender display accepted 2026-10-27.
// Op 1 probes, op 2 constructs only, op 3 submits a validated interaction.
// No UI automation, detours, hand-crafted message snapshots or SQL writes.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <string.h>
namespace {
HMODULE moduleHandle; uintptr_t base; char token[64]; INIT_ONCE once=INIT_ONCE_STATIC_INIT;
LONG ready=0,lookups=0; CRITICAL_SECTION guard;
#pragma pack(push,1)
struct Command {uint32_t magic,size,op,cgi;char token[64];uint32_t length,ready,managerReady,attempted,responseReady;int32_t error;uint32_t responseLength;unsigned char response[1024],data[16384];};
struct WxString {char bytes[16];uint64_t length,cap;};
#pragma pack(pop)
struct Shared {uintptr_t body,owner;};
struct Retained {Shared context,container,service,pat;WxString session;unsigned char row[0x2e0],snapshot[0x430],textSource[0x748],referenceCopy[0x4f8];};
Retained* retained[4096]={};
typedef uintptr_t (*Call)(...);
int CaptureFailure(Command* c,EXCEPTION_POINTERS* e){
 c->error=6;uint32_t* d=(uint32_t*)c->response;d[0]=e->ExceptionRecord->ExceptionCode;
 uintptr_t ip=(uintptr_t)e->ExceptionRecord->ExceptionAddress;d[1]=(ip>=base&&ip<base+0xb000000)?(uint32_t)(ip-base):0;
 return EXCEPTION_EXECUTE_HANDLER;
}
bool Executable(uintptr_t address){MEMORY_BASIC_INFORMATION m;return VirtualQuery((void*)address,&m,sizeof(m))&&m.State==MEM_COMMIT&&(m.Protect&(PAGE_EXECUTE|PAGE_EXECUTE_READ|PAGE_EXECUTE_READWRITE|PAGE_EXECUTE_WRITECOPY));}
BOOL CALLBACK Init(PINIT_ONCE,PVOID,PVOID*){
 base=(uintptr_t)GetModuleHandleW(L"Weixin.dll");if(!base||!Executable(base+0x425c0)||!Executable(base+0x32c900)||!Executable(base+0x64aa70)||!Executable(base+0x16f2e50)||!Executable(base+0xa21be0))return TRUE;
 wchar_t file[32768];DWORD n=GetModuleFileNameW(moduleHandle,file,32768);if(!n||n>=32768)return TRUE;
 wchar_t* slash=wcsrchr(file,L'\\');if(!slash)return TRUE;*slash=0;slash=wcsrchr(file,L'\\');if(!slash)return TRUE;
 wcscpy_s(slash,32768-(slash-file),L"\\native-token.txt");
 HANDLE input=CreateFileW(file,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);if(input==INVALID_HANDLE_VALUE)return TRUE;
 DWORD got=0;BOOL ok=ReadFile(input,token,64,&got,NULL);CloseHandle(input);if(!ok||got!=64)return TRUE;
 for(int i=0;i<64;i++)if(!((token[i]>='a'&&token[i]<='f')||(token[i]>='0'&&token[i]<='9')))return TRUE;
 InitializeCriticalSection(&guard);ready=1;return TRUE;
}
bool Set(WxString* dest,const unsigned char* bytes,uint32_t length){
 memset(dest,0,sizeof(*dest));dest->length=length;dest->cap=15;
 if(length<16){memcpy(dest->bytes,bytes,length);return true;}
 dest->cap=(length|15);char* ptr=(char*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,(size_t)dest->cap+1);
 if(!ptr)return false;memcpy(ptr,bytes,length);*(char**)dest->bytes=ptr;return true;
}
bool Equal(const WxString* value,const unsigned char* bytes,uint32_t length){
 if(value->length!=length||value->cap<length||value->cap>0x100000)return false;
 const char* p=value->cap<16?value->bytes:*(const char**)value->bytes;
 return p&&!memcmp(p,bytes,length);
}
bool PrepareQuote(Command* c,Retained* p,const unsigned char* session,uint32_t sessionSize,const unsigned char* text,uint32_t textSize){
 if(!textSize||textSize>13000)return false;
 if(!Set((WxString*)(p->textSource+0xb0),session,sessionSize)||!Set((WxString*)(p->textSource+0x708),text,textSize))return false;
 // Manual native sample confirms appmsg 49/subtype 57 and input scene 7.
 *(uint32_t*)(p->textSource+0xd8)=49;*(uint32_t*)(p->textSource+0xdc)=57;
 *(uint32_t*)(p->textSource+0xa4)=7;*(uint64_t*)(p->textSource+0x188)=textSize;
 // Retain the same shared-owner layout as the verified normal text sender.
 uint64_t* owner=(uint64_t*)((Call)(base+0x680d0fc))((size_t)0x758);
 if(!owner)return false;memset(owner,0,0x758);owner[0]=base+0x8279358;owner[1]=0x200000005ULL;
 ((Call)(base+0x6b4200))(owner+2,p->textSource);
 unsigned char* copied=(unsigned char*)(owner+2);
 c->response[9]=copied[0x200]&&copied[0x638]&&*(uint32_t*)(copied+0xd8)==49&&*(uint32_t*)(copied+0xdc)==57&&*(uint32_t*)(copied+0xa4)==7&&Equal((WxString*)(copied+0x1b0),session,sessionSize)&&Equal((WxString*)(copied+0x708),text,textSize)?1:0;
 if(!c->response[9])return false;
 if(c->op!=3)return true;
 uint64_t* data=(uint64_t*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,0x100);
 uint64_t* a1=(uint64_t*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,0x140);
 uint64_t* a2=(uint64_t*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,0x740);
 uint64_t* buf=(uint64_t*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,0x80);
 uint64_t* b2=(uint64_t*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,0x200);
 uint64_t* b3=(uint64_t*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,0x200);
 uint64_t* b4=(uint64_t*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,0x200);
 if(!data||!a1||!a2||!buf||!b2||!b3||!b4)return false;
 data[0]=(uintptr_t)(owner+2);data[1]=(uintptr_t)owner;
 a1[0]=base+0x84ec9c8;a1[1]=(uintptr_t)data;a1[2]=(uintptr_t)data+16;a1[3]=(uintptr_t)data+16;a1[4]=1;
 b2[0]=base+0x8595f58;b2[7]=(uintptr_t)b2;b3[0]=base+0x8595e98;b3[7]=(uintptr_t)b3;b4[0]=base+0x8595dd8;b4[7]=(uintptr_t)b4;
 ((Call)(base+0xdf40))(a2,b2,b3,b4,buf,*(uintptr_t*)(base+0xa0ce0b0));
 c->response[10]=1;((Call)(base+0x1677a30))(a1,a2);c->response[11]=1;return true;
}
void Lookup(Command* c){
 __try{
  if(c->length<28){c->error=7;return;}
  uint64_t svrId=*(uint64_t*)c->data;uint32_t* sizes=(uint32_t*)(c->data+8);
  uint32_t sessionSize=sizes[0],senderSize=sizes[1],localId=sizes[2];
  uint64_t messageType=*(uint64_t*)(c->data+20);
  if(!svrId||!sessionSize||sessionSize>200||!senderSize||senderSize>128||28+sessionSize+senderSize>c->length||!localId||!messageType){c->error=7;return;}
  uint32_t textSize=c->length-28-sessionSize-senderSize;
  if((c->cgi==1&&(!textSize||textSize>13000))||(c->cgi==2&&textSize)||c->cgi>2){c->error=7;return;}
  if(c->cgi==1&&messageType!=1){c->error=7;return;}
  const unsigned char* session=c->data+28;const unsigned char* sender=session+sessionSize;
  LONG index=InterlockedIncrement(&lookups)-1;if(index<0||index>=4096){c->error=3;return;}
  Retained* p=(Retained*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(Retained));if(!p){c->error=4;return;}retained[index]=p;
  if(!Set(&p->session,session,sessionSize)){c->error=4;return;}
  // The same initialized optional<MessageData> template as native caller 234F010.
  memcpy(p->row,(void*)(base+0x82f3278),sizeof(p->row));
  c->attempted=1;
  c->responseLength=1;((Call)(base+0x425c0))(&p->context);if(!p->context.body){c->error=8;return;}
  c->responseLength=2;((Call)(base+0x32c900))(p->context.body,&p->container);if(!p->container.body){c->error=8;return;}
  c->responseLength=3;((Call)(base+0x64aa70))(p->container.body,&p->service);if(!p->service.body){c->error=8;return;}
  c->managerReady=1;
  c->responseLength=4;((Call)(base+0x16f2e50))(p->service.body,p->row,&p->session,svrId);
  if(!p->row[0x2d8]){c->error=9;return;}
  // Genuine native record conversion, with the exact source/destination ABI.
  c->responseLength=5;((Call)(base+0xa21be0))(p->row,p->snapshot);
  c->response[0]=Equal((WxString*)(p->snapshot+0x70),session,sessionSize)?1:0;
  c->response[1]=Equal((WxString*)(p->snapshot+0x50),sender,senderSize)?1:0;
  c->response[2]=*(uint64_t*)(p->snapshot+0xb8)==svrId?1:0;
  c->response[3]=*(uint32_t*)(p->snapshot+0x94)==localId?1:0;
  c->response[4]=*(uint64_t*)(p->snapshot+8)==messageType?1:0;
  c->response[5]=*(uintptr_t*)p->snapshot==base+0x81d14a8?1:0;
  for(int check=0;check<6;check++)if(!c->response[check]){c->responseLength=6;c->responseReady=1;c->error=11;return;}
  c->responseLength=6;((Call)(base+0x1664a20))(p->container.body,&p->pat);
  c->response[6]=p->pat.body?1:0;
  // Construct and copy the genuine referenced_data through native ctors only.
  // Empty draft remains entirely in memory; it is NEVER submitted for sending.
  c->responseLength=7;((Call)(base+0x6b2c30))(p->textSource);
  ((Call)(base+0x22b5f60))(p->textSource+0x1b0,p->snapshot);p->textSource[0x200]=1;
  ((Call)(base+0x1b5920))(p->textSource+0x208,p->snapshot);p->textSource[0x638]=1;
  c->responseLength=8;((Call)(base+0x6b53c0))(p->referenceCopy,p->textSource+0x1b0);
  c->response[7]=p->referenceCopy[0x50]&&Equal((WxString*)p->referenceCopy,session,sessionSize)&&*(uint32_t*)(p->referenceCopy+0x24)==localId?1:0;
  c->response[8]=p->referenceCopy[0x488]&&Equal((WxString*)(p->referenceCopy+0x58+0x70),session,sessionSize)&&*(uint64_t*)(p->referenceCopy+0x58+0xb8)==svrId&&*(uint32_t*)(p->referenceCopy+0x58+0x94)==localId?1:0;
  c->error=0;
  for(int check=0;check<9;check++)if(!c->response[check]){c->error=11;return;}
  if(c->cgi==1){
   c->responseLength=30;if(!PrepareQuote(c,p,session,sessionSize,sender+senderSize,textSize)){if(!c->error)c->error=4;return;}
  }else if(c->cgi==2&&c->op==3){
   unsigned char* patResult=(unsigned char*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,0x50);if(!patResult){c->error=4;return;}
   c->responseLength=31;c->response[10]=1;((Call)(base+0x3560de0))(p->pat.body,patResult,&p->session,p->snapshot);c->response[11]=patResult[0]?1:0;
  }
  c->responseLength=12;c->responseReady=1;
 }__except(CaptureFailure(c,GetExceptionInformation())){}
}
// Same background coroutine scheduler used by native text sending. A retained
// std::function ABI bridge keeps
// all inputs alive even if the external caller times out.
struct Function {uintptr_t storage[7],target;};
struct Job {void** vtable;Command* command;HANDLE event;LONG started;Shared scheduler;Function function;uintptr_t location[4],future[8];};
void* callbackVtable[6];LONG queued=0;
uintptr_t Keep(Job* self,void*){return (uintptr_t)self;}
uintptr_t Ignore(Job*,uintptr_t){return 0;}
uintptr_t Invoke(Job* self){
 if(InterlockedCompareExchange(&self->started,1,0)==0){Lookup(self->command);SetEvent(self->event);}return 0;
}
void Dispatch(Command* c){
 __try{
  if(InterlockedIncrement(&queued)>4096){c->error=3;return;}
  Job* j=(Job*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(Job));
  if(!j){c->error=4;return;}
  j->command=(Command*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(Command));
  j->event=CreateEventW(NULL,TRUE,FALSE,NULL);if(!j->command||!j->event){c->error=4;return;}
  memcpy(j->command,c,sizeof(Command));
  callbackVtable[0]=(void*)Keep;callbackVtable[1]=(void*)Keep;callbackVtable[2]=(void*)Invoke;
  callbackVtable[3]=(void*)Ignore;callbackVtable[4]=(void*)Ignore;callbackVtable[5]=(void*)Ignore;
  j->vtable=callbackVtable;j->function.target=(uintptr_t)j;
  c->responseLength=20;
  uintptr_t app=((Call)(base+0x410c0))();if(!app){c->error=8;return;}
  ((Call)(base+0x426b0))(app,&j->scheduler);if(!j->scheduler.body){c->error=8;return;}
  ((Call)(base+0x18ce40))(j->location,"interaction_service.cpp","ValidatedInteraction",1);
  c->responseLength=21;
  ((Call)(base+0x2bbcb0))(j->scheduler.body,j->future,j->location,&j->function,1);
  if(WaitForSingleObject(j->event,18000)!=WAIT_OBJECT_0){c->error=10;return;}
  memcpy(c,j->command,sizeof(Command));
 }__except(CaptureFailure(c,GetExceptionInformation())){}
}
}
extern "C" __declspec(dllexport) DWORD WINAPI WcaInteractionService(void* pointer){
 Command* c=(Command*)pointer;
 __try{
  if(c->magic!=0x57434131||c->size!=sizeof(Command))return 1;InitOnceExecuteOnce(&once,Init,NULL,NULL);
  unsigned int difference=0;for(int i=0;i<64;i++)difference|=(unsigned char)c->token[i]^(unsigned char)token[i];
  if(difference||!ready){c->error=1;return 1;}c->ready=1;
  if(c->op==1){c->managerReady=1;return 0;}
  if((c->op!=2&&c->op!=3)||c->cgi>2||c->length>13400){c->error=7;return 1;}
  EnterCriticalSection(&guard);Dispatch(c);LeaveCriticalSection(&guard);return c->error;
 }__except(EXCEPTION_EXECUTE_HANDLER){return 2;}
}
BOOL WINAPI DllMain(HMODULE module,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH){moduleHandle=module;DisableThreadLibraryCalls(module);}return TRUE;}
