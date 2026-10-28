// Opt-in preload for an existing search MCP process behind fake-IP DNS.
// Connections remain pinned and checked by that tool's original safe-fetch.
import dns from 'node:dns';import https from 'node:https';import net from 'node:net';

export const fakeAddress=value=>{const parts=String(value).split('.').map(Number);return net.isIP(value)===4&&parts[0]===198&&(parts[1]===18||parts[1]===19);};
export function publicAddress(value){
  if(net.isIP(value)!==4)return false;const [a,b,c]=value.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a===192&&b===0&&(c===0||c===2)||a===198&&b===51&&c===100||a===203&&b===0&&c===113);
}
export function resolvePublicA(hostname){
  if(typeof hostname!=='string'||hostname.length>253||!/^([a-z0-9-]+\.)*[a-z0-9-]+\.?$/i.test(hostname)||net.isIP(hostname)||/(^|\.)localhost\.?$|\.local\.?$/i.test(hostname))return Promise.reject(Error('PUBLIC_DNS_HOST_INVALID'));
  return new Promise((resolve,reject)=>{
    let done=false;const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result);};
    const request=https.get({hostname:'1.1.1.1',servername:'cloudflare-dns.com',port:443,path:'/dns-query?'+new URLSearchParams({name:hostname,type:'A'}),headers:{host:'cloudflare-dns.com',accept:'application/dns-json'},rejectUnauthorized:true},response=>{
      let size=0;const parts=[];if(response.statusCode!==200){response.destroy();finish(Error('PUBLIC_DNS_HTTP_FAILED'));return;}
      response.on('data',chunk=>{size+=chunk.length;if(size>32768){response.destroy();finish(Error('PUBLIC_DNS_RESPONSE_TOO_LARGE'));}else parts.push(chunk);});
      response.on('error',()=>finish(Error('PUBLIC_DNS_RESPONSE_FAILED')));
      response.on('end',()=>{try{const data=JSON.parse(Buffer.concat(parts));if(data.Status!==0||!Array.isArray(data.Answer))throw Error();const addresses=[...new Set(data.Answer.filter(item=>item.type===1).map(item=>item.data))];if(!addresses.length||addresses.length>32||addresses.some(address=>!publicAddress(address)))throw Error();finish(null,addresses.map(address=>({address,family:4})));}catch{finish(Error('PUBLIC_DNS_ADDRESS_REJECTED'));}});
    });
    const timer=setTimeout(()=>{request.destroy();finish(Error('PUBLIC_DNS_TIMEOUT'));},5000);
    request.on('error',()=>finish(Error('PUBLIC_DNS_REQUEST_FAILED')));
  });
}
export function createPublicLookup(lookup,resolve=resolvePublicA){
  const cache=new Map();
  return async(hostname,options)=>{
    const original=await lookup(hostname,options),records=Array.isArray(original)?original:[original];
    if(!records.length||!records.every(item=>fakeAddress(item.address)))return original;
    if((typeof options==='number'?options:options?.family)===6)throw Error('PUBLIC_DNS_IPV6_UNAVAILABLE');
    let cached=cache.get(hostname);
    if(!cached||cached.expires<Date.now()){
      const addresses=await resolve(hostname);
      if(!Array.isArray(addresses)||!addresses.length||addresses.some(item=>!publicAddress(item.address)||item.family!==4))throw Error('PUBLIC_DNS_ADDRESS_REJECTED');
      cached={addresses,expires:Date.now()+60000};cache.set(hostname,cached);if(cache.size>128)cache.delete(cache.keys().next().value);
    }
    return Array.isArray(original)?cached.addresses.map(item=>({...item})):{...cached.addresses[0]};
  };
}
if(process.execArgv.includes('--import='+import.meta.url))dns.promises.lookup=createPublicLookup(dns.promises.lookup.bind(dns.promises));
