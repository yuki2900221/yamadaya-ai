import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const files=['package.json','package-lock.json','index.html','vite.config.js','.gitignore','README.md','AGENTS.md'];
const dirs=['src','server','shared','public','tests','docs','scripts'];
async function walk(dir){for(const e of await fs.readdir(path.join(root,dir),{withFileTypes:true})){const rel=`${dir}/${e.name}`;if(e.isSymbolicLink())throw Error(`Symlink cannot be public: ${rel}`);if(e.isDirectory())await walk(rel);else files.push(rel);}}
for(const d of dirs)await walk(d);
const patterns=[/sk-[A-Za-z0-9_-]{20,}/,/gh[pousr]_[A-Za-z0-9]{20,}/,/github_pat_[A-Za-z0-9_]{20,}/,/cfast_[A-Za-z0-9_-]{20,}/,/eyJhIjoi[A-Za-z0-9_+\/=-]{40,}/,/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/proj_[A-Za-z0-9]{20,}/,/key_[A-Za-z0-9]{12,}/];
const errors=[];for(const file of files){const data=await fs.readFile(path.join(root,file),'utf8');if(patterns.some(p=>p.test(data)))errors.push(file);}
const findings=errors;
if(findings.length)throw Error(`Publish check failed in ${findings.join(', ')}`);
console.log(JSON.stringify({files:files.length,secretFindings:0,excluded:['.env*','.runtime','results','node_modules','dist','phase0'],checkedAt:new Date().toISOString()},null,2));
if(process.argv.includes('--manifest')){await fs.mkdir(path.join(root,'.runtime'),{recursive:true,mode:0o700});await fs.writeFile(path.join(root,'.runtime/public-manifest.json'),JSON.stringify(files.sort(),null,2),{mode:0o600});}
