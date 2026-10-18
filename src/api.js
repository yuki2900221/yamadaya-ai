export async function session(){const r=await fetch('/api/session',{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'接続できません。');return d;}
export async function job(id,feature,input,csrf,signal){const r=await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({id,feature,input}),signal});const d=await r.json();if(!r.ok){const e=Error(d.error||'作成できませんでした。');e.code=d.code;e.notDispatched=d.notDispatched===true;throw e;}return d;}
export async function end(csrf){const r=await fetch('/api/end',{method:'POST',headers:{'X-CSRF-Token':csrf}});if(!r.ok)throw Error('利用を終了できませんでした。');}
export async function recover(id){const r=await fetch(`/api/jobs/${id}`,{cache:'no-store'});const d=await r.json();if(!r.ok){const e=Error(d.error);e.status=r.status;throw e;}return d;}
export function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function rasterReference(source){const img=new Image();img.src=source;await img.decode();const ratio=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*ratio);canvas.height=Math.round(img.naturalHeight*ratio);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.9);}
export async function photoData(file){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('15MB以内のJPEG・PNG・WebPを選んでください。');const bitmap=await createImageBitmap(file);try{if(bitmap.width*bitmap.height>36_000_000)throw Error('画像が大きすぎます。小さくしてから選んでください。');const ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.88);}finally{bitmap.close();}}

export function imageFile(data){
 const match=data.match(/^data:(image\/(?:png|jpeg|svg\+xml));base64,([A-Za-z0-9+/]+=*)$/);
 if(!match)throw Error('Unsupported image');
 const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
 const ext=match[1]==='image/jpeg'?'jpg':match[1]==='image/png'?'png':'svg';
 return {blob:new Blob([bytes],{type:match[1]}),ext};
}
