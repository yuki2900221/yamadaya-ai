import test from 'node:test';
import assert from 'node:assert/strict';
import {buildImagePdf} from '../shared/pdf.mjs';
import {PAPERS} from '../shared/contracts.mjs';
for(const [code,p] of Object.entries(PAPERS))test(`image PDF ${code}: physical size, safe margins, original JPEG bytes and valid xref`,()=>{
 const jpeg=Uint8Array.from([255,216,255,0,127,13,10,255,217]);
 const bytes=buildImagePdf(jpeg,1440,2032,code),str=Buffer.from(bytes).toString('latin1');
 const box=str.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/).slice(1).map(Number);
 assert.ok(Math.abs(box[0]*25.4/72-p.width)<.00001);assert.ok(Math.abs(box[1]*25.4/72-p.height)<.00001);
 const [w,h,x,y]=str.match(/q\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/).slice(1).map(n=>Number(n)*25.4/72);
 assert.ok(x>=4.99999&&y>=4.99999&&x+w<=p.width-4.99999&&y+h<=p.height-4.99999);
 assert.ok(Math.abs(w/h-1440/2032)<.000001);assert.ok(Buffer.from(bytes).includes(Buffer.from(jpeg)));
 const xref=Number(str.match(/startxref\n(\d+)/)[1]);assert.equal(str.slice(xref,xref+4),'xref');
 const offsets=[...str.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map(m=>Number(m[1]));
 offsets.forEach((offset,i)=>assert.ok(str.slice(offset).startsWith(`${i+1} 0 obj`)));
});
test('invalid image dimensions or paper cannot emit a PDF',()=>{for(const args of [[new Uint8Array(),1,1,'a4p'],[new Uint8Array([255,216]),0,1,'a4p'],[new Uint8Array([255,216]),1,1,'wrong']])assert.throws(()=>buildImagePdf(...args));});
