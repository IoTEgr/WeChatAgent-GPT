// Weixin 4.1.10.27 only. Independent companion; never replaces the voice DLL.
// Pat only: owned wire bytes. No quote/input construction or message observers.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <string.h>
#include "MinHook.h"

namespace {
HMODULE moduleHandle; uintptr_t base; INIT_ONCE once=INIT_ONCE_STATIC_INIT;
volatile LONG initialized=0, allocated=0; volatile PVOID manager=NULL;
char expectedToken[64]; CRITICAL_SECTION guard;
typedef uintptr_t (*Submit)(uintptr_t,uintptr_t,uintptr_t,uintptr_t,uintptr_t);
Submit originalSync=NULL,originalApp=NULL,originalPat=NULL;
uint32_t baseLength=0;
#pragma pack(push,1)
struct Command {
 uint32_t magic,size,op,cgi; char token[64]; uint32_t length,ready,managerReady,attempted,responseReady; int32_t error; uint32_t responseLength; unsigned char response[1024]; unsigned char data[16384];
};
#pragma pack(pop)
struct Pending { uintptr_t task; unsigned char* bytes; uint32_t length; HANDLE event; volatile LONG done; uint32_t responseLength; unsigned char response[1024]; };
Pending pending[4096]={}; void* taskVtable[6];void* callbackVtable[6];
bool Executable(uintptr_t address){MEMORY_BASIC_INFORMATION m;return VirtualQuery((void*)address,&m,sizeof(m))&&m.State==MEM_COMMIT&&(m.Protect&(PAGE_EXECUTE|PAGE_EXECUTE_READ|PAGE_EXECUTE_READWRITE|PAGE_EXECUTE_WRITECOPY));}
bool Capture(uintptr_t value){
 __try{uintptr_t vt=*(uintptr_t*)value,fn=*(uintptr_t*)(vt+40);if(vt<base||vt>=base+0xc000000||!Executable(fn))return false;InterlockedExchangePointer(&manager,(void*)value);return true;}__except(EXCEPTION_EXECUTE_HANDLER){return false;}
}
uintptr_t OnSync(uintptr_t a,uintptr_t b,uintptr_t c,uintptr_t d,uintptr_t e){Capture(a);return originalSync(a,b,c,d,e);}
uintptr_t OnApp(uintptr_t a,uintptr_t b,uintptr_t c,uintptr_t d,uintptr_t e){Capture(a);return originalApp(a,b,c,d,e);}
uintptr_t OnPat(uintptr_t a,uintptr_t b,uintptr_t c,uintptr_t d,uintptr_t e){Capture(a);return originalPat(a,b,c,d,e);}
Pending* Find(uintptr_t task){for(LONG i=0;i<allocated&&i<4096;i++)if(pending[i].task==task)return &pending[i];return NULL;}
uintptr_t Dtor(uintptr_t self,uintptr_t,uintptr_t){return self;}
uintptr_t Inner(uintptr_t self){return self+240;}
uintptr_t Dummy(uintptr_t,uintptr_t,uintptr_t,uintptr_t){return 1;}
uint32_t FillNativeBase(uintptr_t task,unsigned char* output,uintptr_t flags){
 typedef char (*Fill)(uintptr_t,uintptr_t);typedef uint32_t (*Size)(uintptr_t);typedef uintptr_t (*ToArray)(uintptr_t,void*);
 if(!flags||!((Fill)(base+0x3aedc0))(task,flags))return 0;
 uintptr_t request=*(uintptr_t*)(task+0xf8);if(!request)return 0;
 uint32_t length=((Size)(base+0x5db2f0))(request);if(!length||length>1024)return 0;
 uintptr_t end=((ToArray)(base+0x5da0b0))(request,output);return end==(uintptr_t)output+length?length:0;
}
char Serialize(uintptr_t self,uintptr_t holder,uintptr_t,unsigned char* ok,uintptr_t flags){
 __try{
  if(ok)*ok=0;Pending* slot=Find(self);if(!slot||!holder)return 0;
  unsigned char nativeBase[1024];uint32_t length=FillNativeBase(self,nativeBase,flags);if(!length||slot->bytes[0]!=10)return 0;
  uint32_t oldLength=0,shift=0,skip=1;while(skip<slot->length&&shift<=28){unsigned char b=slot->bytes[skip++];oldLength|=(uint32_t)(b&127)<<shift;shift+=7;if(!(b&128))break;}if(skip+oldLength>slot->length)return 0;skip+=oldLength;
  unsigned char prefix[8];prefix[0]=10;uint32_t prefixLength=1,size=length;while(size>127){prefix[prefixLength++]=(unsigned char)((size&127)|128);size>>=7;}prefix[prefixLength++]=(unsigned char)size;
  typedef uintptr_t (*Write)(uintptr_t,uintptr_t,uint32_t);
  Write write=(Write)(base+0x5da760);write(holder,(uintptr_t)prefix,prefixLength);write(holder,(uintptr_t)nativeBase,length);write(holder,(uintptr_t)(slot->bytes+skip),slot->length-skip);
  InterlockedExchange((volatile LONG*)&baseLength,length);if(ok)*ok=1;return 1;
 }__except(EXCEPTION_EXECUTE_HANDLER){return 0;}
}
char Response(uintptr_t self,uintptr_t holder){
 __try{
  Pending* slot=Find(self);if(!slot)return 0;
  typedef uintptr_t (*Size)(uintptr_t);typedef uintptr_t (*Data)(uintptr_t,int);
  uint64_t count=((Size)(base+0x5da7d0))(holder);const void* data=(void*)((Data)(base+0x5da7a0))(holder,0);
  if(count&&count<=1024&&data){EnterCriticalSection(&guard);memcpy(slot->response,data,(size_t)count);slot->responseLength=(uint32_t)count;InterlockedExchange(&slot->done,1);SetEvent(slot->event);LeaveCriticalSection(&guard);}
  return 1;
 }__except(EXCEPTION_EXECUTE_HANDLER){return 0;}
}
bool ReadToken(){
 wchar_t file[32768];DWORD n=GetModuleFileNameW(moduleHandle,file,32768);if(!n||n>=32768)return false;
 wchar_t* slash=wcsrchr(file,L'\\');if(!slash)return false;*slash=0;slash=wcsrchr(file,L'\\');if(!slash)return false;wcscpy_s(slash,32768-(slash-file),L"\\native-token.txt");
 HANDLE input=CreateFileW(file,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);if(input==INVALID_HANDLE_VALUE)return false;
 DWORD got=0;BOOL success=ReadFile(input,expectedToken,64,&got,NULL);CloseHandle(input);if(!success||got!=64)return false;
 for(int i=0;i<64;i++)if(!((expectedToken[i]>='a'&&expectedToken[i]<='f')||(expectedToken[i]>='0'&&expectedToken[i]<='9')))return false;return true;
}
BOOL CALLBACK Initialize(PINIT_ONCE,PVOID,PVOID*){
 base=(uintptr_t)GetModuleHandleW(L"Weixin.dll");if(!base||!ReadToken())return TRUE;
 // Prologues and the exact image SHA are also checked by the host before load.
 const unsigned char submitPrefix[]={0x55,0x41,0x57,0x41,0x56,0x41,0x54,0x56,0x57,0x53};
 bool appPrefix=!memcmp((void*)(base+0x36af120),submitPrefix,sizeof(submitPrefix))||*(unsigned char*)(base+0x36af120)==0xe9;
 bool syncPrefix=!memcmp((void*)(base+0x2c1fd10),submitPrefix,sizeof(submitPrefix))||*(unsigned char*)(base+0x2c1fd10)==0xe9;
 if(!appPrefix||!syncPrefix||!Executable(base+0x36af460))return TRUE;
 InitializeCriticalSection(&guard);
 taskVtable[0]=(void*)&Dtor;taskVtable[1]=(void*)&Serialize;taskVtable[2]=(void*)&Response;taskVtable[3]=(void*)&Inner;taskVtable[4]=(void*)&Dummy;taskVtable[5]=(void*)1;
 for(int i=0;i<6;i++)callbackVtable[i]=(void*)&Dummy;
 MH_STATUS status=MH_Initialize();if(status!=MH_OK&&status!=MH_ERROR_ALREADY_INITIALIZED)return TRUE;
 if(MH_CreateHook((void*)(base+0x2c1fd10),(void*)&OnSync,(void**)&originalSync)!=MH_OK)return TRUE;
 if(MH_CreateHook((void*)(base+0x36af120),(void*)&OnApp,(void**)&originalApp)!=MH_OK){MH_RemoveHook((void*)(base+0x2c1fd10));return TRUE;}
 if(MH_CreateHook((void*)(base+0x3568e20),(void*)&OnPat,(void**)&originalPat)!=MH_OK){MH_RemoveHook((void*)(base+0x2c1fd10));MH_RemoveHook((void*)(base+0x36af120));return TRUE;}
 if(MH_EnableHook((void*)(base+0x2c1fd10))!=MH_OK||MH_EnableHook((void*)(base+0x36af120))!=MH_OK||MH_EnableHook((void*)(base+0x3568e20))!=MH_OK)return TRUE;
 InterlockedExchange(&initialized,1);return TRUE;
}
void Dispatch(Command* command){
 __try{
  if(!manager||!initialized){command->error=2;return;}
  LONG index=InterlockedIncrement(&allocated)-1;if(index>=4096){InterlockedDecrement(&allocated);command->error=3;return;}
  Pending* slot=&pending[index];slot->event=CreateEventW(NULL,TRUE,FALSE,NULL);slot->length=command->length;slot->bytes=(unsigned char*)HeapAlloc(GetProcessHeap(),0,slot->length);
  if(!slot->event||!slot->bytes){command->error=4;return;}memcpy(slot->bytes,command->data,slot->length);
  unsigned char* task=(unsigned char*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,0x200);
  unsigned char* info=(unsigned char*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,0x40);
  void** callback=(void**)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,8);
  if(!task||!info||!callback){command->error=4;return;}
  const char* endpoint="/cgi-bin/micromsg-bin/sendpat";size_t length=strlen(endpoint);
  *(uint32_t*)info=command->cgi;info[12]=1;*(uint32_t*)(info+16)=command->cgi;*(uintptr_t*)(info+24)=(uintptr_t)endpoint;*(uint64_t*)(info+40)=length;*(uint64_t*)(info+48)=length|15;info[56]=1;
  typedef void (*Ctor)(void*,void*);((Ctor)(base+0x36af460))(task,info);
  *(void**)task=taskVtable;*callback=callbackVtable;*(void**)(task+208)=callback;slot->task=(uintptr_t)task;
  uintptr_t owner=(uintptr_t)InterlockedCompareExchangePointer(&manager,NULL,NULL);uintptr_t vt=*(uintptr_t*)owner;
  typedef uintptr_t (*Send)(uintptr_t,uintptr_t);command->attempted=1;((Send)*(uintptr_t*)(vt+40))(owner,(uintptr_t)task);
  WaitForSingleObject(slot->event,18000);
  EnterCriticalSection(&guard);command->responseReady=slot->done?1:0;command->responseLength=slot->responseLength;if(slot->done)memcpy(command->response,slot->response,slot->responseLength);LeaveCriticalSection(&guard);
  // Keep tasks and callback-owned bytes alive for late native work. Allocation
  // is bounded to 4096 commands per WeChat process; never free a live task.
  command->error=slot->done?0:5;
 }__except(EXCEPTION_EXECUTE_HANDLER){command->error=6;}
}
}
extern "C" __declspec(dllexport) DWORD WINAPI WcaInteractionCommand(void* pointer){
 Command* c=(Command*)pointer;
 __try{
  if(c->magic!=0x57434131||c->size!=sizeof(Command))return 1;
  InitOnceExecuteOnce(&once,Initialize,NULL,NULL);unsigned int difference=0;for(int i=0;i<64;i++)difference|=(unsigned char)c->token[i]^(unsigned char)expectedToken[i];
  if(difference||!initialized){c->error=1;return 1;}c->ready=initialized;c->managerReady=manager?1:0;
  if(c->op==1){c->responseLength=baseLength;return 0;}
  if(c->op==5){MH_RemoveHook((void*)(base+0x3568e20));MH_RemoveHook((void*)(base+0x36af120));MH_RemoveHook((void*)(base+0x2c1fd10));InterlockedExchange(&initialized,0);return 0;}
  if(c->op==4){
   unsigned char* task=(unsigned char*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,0x200);unsigned char info[64]={};const char* endpoint="/cgi-bin/micromsg-bin/sendappmsg";*(uint32_t*)info=222;info[12]=1;*(uint32_t*)(info+16)=222;*(uintptr_t*)(info+24)=(uintptr_t)endpoint;*(uint64_t*)(info+40)=32;*(uint64_t*)(info+48)=47;info[56]=1;
   typedef void (*Ctor)(void*,void*);((Ctor)(base+0x36af460))(task,info);uint32_t flags=0;unsigned char bytes[1024];c->responseLength=FillNativeBase((uintptr_t)task,bytes,(uintptr_t)&flags);c->error=c->responseLength?0:8;return c->error;
  }
  if(c->op!=2||c->cgi!=849||!c->length||c->length>16384){c->error=7;return 1;}
  Dispatch(c);return c->error;
 }__except(EXCEPTION_EXECUTE_HANDLER){return 2;}
}
BOOL WINAPI DllMain(HMODULE module,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH){moduleHandle=module;DisableThreadLibraryCalls(module);}return TRUE;}
