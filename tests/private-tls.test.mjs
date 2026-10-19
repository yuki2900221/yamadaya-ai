import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {loadTransportConfiguration,start} from '../server/index.mjs';

const origin='https://private-trial.example.test';let directory,cert,key;
before(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'yamadaya-private-tls-'));cert=path.join(directory,'cert.pem');key=path.join(directory,'key.pem');
 const config=path.join(directory,'openssl.cnf');
 await fs.writeFile(config,'[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=extensions\n[dn]\nCN=private-trial.example.test\n[extensions]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:private-trial.example.test\n');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-keyout',key,'-out',cert,'-config',config],{stdio:'pipe'});await fs.chmod(key,0o600);
});
after(async()=>{await fs.rm(directory,{recursive:true,force:true});});

test('HTTP default has no TLS material and accepts no implicit HTTPS fallback',async()=>{
 assert.deepEqual(await loadTransportConfiguration({origin:'http://127.0.0.1:4176'}),{protocol:'http:',tlsOptions:null});
 await assert.rejects(loadTransportConfiguration({origin}),/requires both/);
});
test('valid self-signed non-CA leaf and owned 0600 key prepare native TLS without OS trust changes',async()=>{
 const c=await loadTransportConfiguration({origin,tlsCertFile:cert,tlsKeyFile:key});assert.equal(c.protocol,'https:');assert.equal(c.tlsOptions.minVersion,'TLSv1.2');assert.ok(Buffer.isBuffer(c.tlsOptions.key));
});
for(const name of ['certificate only','key only','HTTP origin','other hostname','credentials','path','invalid protocol','missing files'])test(`TLS configuration refuses ${name}`,async()=>{
 const input={origin,tlsCertFile:cert,tlsKeyFile:key};
 if(name==='certificate only')delete input.tlsKeyFile;
 if(name==='key only')delete input.tlsCertFile;
 if(name==='HTTP origin')input.origin='http://private-trial.example.test';
 if(name==='other hostname')input.origin='https://untrusted.example.test';
 if(name==='credentials')input.origin='https://user:password@private-trial.example.test';
 if(name==='path')input.origin=origin+'/path';
 if(name==='invalid protocol')input.origin='ftp://private-trial.example.test';
 if(name==='missing files')input.tlsCertFile=path.join(directory,'missing.pem');
 await assert.rejects(loadTransportConfiguration(input));
});
test('unsafe key permissions, symbolic links and malformed certificate/key fail closed',async()=>{
 const unsafe=path.join(directory,'unsafe.pem');await fs.copyFile(key,unsafe);await fs.chmod(unsafe,0o644);
 await assert.rejects(loadTransportConfiguration({origin,tlsCertFile:cert,tlsKeyFile:unsafe}),/0600/);
 const symlink=path.join(directory,'key-link.pem');await fs.symlink(key,symlink);await assert.rejects(loadTransportConfiguration({origin,tlsCertFile:cert,tlsKeyFile:symlink}));
 const bad=path.join(directory,'invalid.pem');await fs.writeFile(bad,'invalid TLS material',{mode:0o600});
 await assert.rejects(loadTransportConfiguration({origin,tlsCertFile:bad,tlsKeyFile:key}));
 await assert.rejects(loadTransportConfiguration({origin,tlsCertFile:cert,tlsKeyFile:bad}));
 const different=path.join(directory,'different-key.pem');execFileSync('openssl',['genrsa','-out',different,'2048'],{stdio:'pipe'});await fs.chmod(different,0o600);
 await assert.rejects(loadTransportConfiguration({origin,tlsCertFile:cert,tlsKeyFile:different}));
});
test('invalid TLS is rejected before grant reads, directory creation or ledger mutation',async()=>{
 const target=path.join(directory,'must-not-exist');
 await assert.rejects(start({port:0,origin,directory:target,mode:'live',budgetUsd:10,tlsCertFile:cert,tlsKeyFile:''}),/both/);
 await assert.rejects(fs.stat(target),e=>e.code==='ENOENT');
});

const sockets=process.env.RUN_LOCAL_TLS_SOCKET_TESTS==='1';
function get(client,options){return new Promise((resolve,reject)=>{const req=client.request(options,res=>{let body='';res.setEncoding('utf8');res.on('data',s=>{body+=s;});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();});}
for(const secure of [false,true])test(`real ${secure?'HTTPS with explicit certificate CA':'HTTP'} loopback listener uses a separate dummy ledger`,{skip:!sockets},async t=>{
 let calls=0;const target=path.join(directory,secure?'tls-ledger':'http-ledger');
 const configured=secure?origin:'http://127.0.0.1:4176';
 const running=await start({port:0,origin:configured,directory:target,mode:'live',budgetUsd:10,textKey:'dummy-no-api',tlsCertFile:secure?cert:'',tlsKeyFile:secure?key:'',provider:{async run(){calls++;return {result:{text:'dummy'},cost:.001};}}});
 t.after(async()=>{await new Promise(resolve=>running.server.close(resolve));running.app.close();});
 assert.equal(running.server.address().address,'127.0.0.1');
 const options={hostname:'127.0.0.1',port:running.server.address().port,path:'/api/session',headers:{host:new URL(configured).host},...(secure?{servername:'private-trial.example.test',ca:await fs.readFile(cert)}:{})};
 const response=await get(secure?https:http,options);assert.equal(response.status,200);assert.equal(response.headers['set-cookie'][0].includes('; Secure'),secure);
 const refused=await get(secure?https:http,{...options,headers:{host:'evil.example.test','x-forwarded-host':new URL(configured).host,'x-forwarded-proto':secure?'https':'http'}});assert.equal(refused.status,403);
 if(secure)await assert.rejects(get(https,{...options,servername:'untrusted.example.test'}),/Hostname\/IP does not match/);
 assert.equal(calls,0);assert.equal(running.app.ledger.usage().count,0);
});
