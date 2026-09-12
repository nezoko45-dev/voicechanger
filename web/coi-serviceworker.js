/*! coi-serviceworker v0.1.7 - MIT */
let coepCredentialless=false;
if(typeof window === "undefined"){
  self.addEventListener("install",()=>self.skipWaiting());
  self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
  self.addEventListener("fetch",e=>{
    const request=e.request;
    if(request.cache === "only-if-cached" && request.mode !== "same-origin") return;
    e.respondWith(fetch(request).then(response=>{
      if(response.status===0) return response;
      const headers=new Headers(response.headers);
      headers.set("Cross-Origin-Embedder-Policy",coepCredentialless?"credentialless":"require-corp");
      if(!coepCredentialless) headers.set("Cross-Origin-Resource-Policy","cross-origin");
      headers.set("Cross-Origin-Opener-Policy","same-origin");
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }));
  });
}else if(!window.crossOriginIsolated && window.isSecureContext && navigator.serviceWorker){
  navigator.serviceWorker.register(document.currentScript.src).then(reg=>{
    if(reg.active && !navigator.serviceWorker.controller) window.location.reload();
    reg.addEventListener("updatefound",()=>window.location.reload());
  }).catch(err=>console.warn("COI service worker unavailable",err));
}
