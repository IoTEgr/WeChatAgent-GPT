import test from 'node:test';import assert from 'node:assert/strict';
import {createPublicLookup,publicAddress,resolvePublicA} from './search-public-dns.mjs';
test('only fake-IP responses use public DNS and validated answers are cached',async()=>{
 let calls=0;const lookup=createPublicLookup(async()=>[{address:'198.18.0.76',family:4}],async()=>{calls++;return[{address:'1.1.1.1',family:4}];});
 assert.deepEqual(await lookup('www.bing.com',{all:true}),[{address:'1.1.1.1',family:4}]);await lookup('www.bing.com',{all:true});assert.equal(calls,1);
});
test('private, mixed, and ordinary DNS answers retain the original safety decision',async()=>{
 for(const records of [[{address:'127.0.0.1',family:4}],[{address:'192.168.1.1',family:4}],[{address:'198.18.0.7',family:4},{address:'10.0.0.1',family:4}],[{address:'8.8.8.8',family:4}]]){
 const lookup=createPublicLookup(async()=>records,async()=>{throw Error('should not resolve');});assert.equal(await lookup('host',{all:true}),records);
 }
});
test('private public-resolver answers and local hostnames are rejected',async()=>{
 const lookup=createPublicLookup(async()=>({address:'198.18.0.7',family:4}),async()=>[{address:'127.0.0.1',family:4}]);await assert.rejects(lookup('public.example'),/PUBLIC_DNS_ADDRESS_REJECTED/);
 for(const host of ['localhost','service.local','127.0.0.1','bad/path'])await assert.rejects(resolvePublicA(host),/PUBLIC_DNS_HOST_INVALID/);
 for(const address of ['10.0.0.1','127.0.0.1','198.18.0.7','169.254.169.254','203.0.113.1'])assert(!publicAddress(address));
});
