import {spawn} from 'node:child_process';
import {cp,mkdir,rm} from 'node:fs/promises';
const run=(file,args)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file,...args],{stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code?reject(new Error('Build failed ('+code+')')):resolve());});
await run('node_modules/prisma/build/index.js',['generate','--config','prisma.config.ts']);
await rm(new URL('../dist',import.meta.url),{recursive:true,force:true});
await run('node_modules/typescript/bin/tsc',['-p','tsconfig.json']);
for(const dir of ['migrations','seeds']){await mkdir('dist/backend/'+dir,{recursive:true});await cp('backend/'+dir,'dist/backend/'+dir,{recursive:true});}
