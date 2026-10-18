import { PAPERS } from './contracts.mjs';
export function buildImagePdf(jpeg,width,height,paperCode){
 if(!(jpeg instanceof Uint8Array)||jpeg[0]!==255||jpeg[1]!==216||!Number.isSafeInteger(width)||width<1||!Number.isSafeInteger(height)||height<1||!Object.hasOwn(PAPERS,paperCode))throw Error('Invalid PDF image or paper');
 const p=PAPERS[paperCode],pt=72/25.4,w=p.width*pt,h=p.height*pt,margin=5*pt;
 const ratio=Math.min((w-2*margin)/width,(h-2*margin)/height),iw=width*ratio,ih=height*ratio;
 const enc=new TextEncoder();let size=0;const parts=[],offsets=[0];const append=x=>{const b=typeof x==='string'?enc.encode(x):x;parts.push(b);size+=b.length;};
 append('%PDF-1.4\n');
 const obj=(id,body)=>{offsets[id]=size;append(`${id} 0 obj\n${body}\nendobj\n`);};
 obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');obj(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.toFixed(5)} ${h.toFixed(5)}] /Resources << /XObject << /Im 4 0 R >> >> /Contents 5 0 R >>`);
 offsets[4]=size;append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);append(jpeg);append('\nendstream\nendobj\n');
 const content=`q\n${iw.toFixed(5)} 0 0 ${ih.toFixed(5)} ${((w-iw)/2).toFixed(5)} ${((h-ih)/2).toFixed(5)} cm\n/Im Do\nQ\n`;obj(5,`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`);
 const xref=size;append(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
 const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;
}
