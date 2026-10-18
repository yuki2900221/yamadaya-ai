import { download } from './api.js';
import { buildImagePdf } from '../shared/pdf.mjs';
export async function saveImagePdf(image,paperCode){
 const img=new Image();img.src=image;await img.decode();
 const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);
 const binary=atob((image.startsWith('data:image/jpeg;base64,')?image:canvas.toDataURL('image/jpeg',.96)).split(',')[1]);const jpeg=Uint8Array.from(binary,c=>c.charCodeAt(0));
 download(buildImagePdf(jpeg,canvas.width,canvas.height,paperCode),`yamadaya-pop-${paperCode}.pdf`,'application/pdf');
}
