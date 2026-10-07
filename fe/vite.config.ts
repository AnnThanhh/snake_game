import {defineConfig,loadEnv} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,fileURLToPath(new URL('.',import.meta.url)),'');
 const backend=process.env.BACKEND_URL||env.BACKEND_URL||'http://127.0.0.1:3000';
 return {root:fileURLToPath(new URL('./public',import.meta.url)),publicDir:false,
 resolve:{alias:{'/v2/client.js':fileURLToPath(new URL('./src/client/index.ts',import.meta.url))}},
 server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':backend,'/admin/':backend,'/rt':{target:backend,ws:true}}},
 build:{outDir:fileURLToPath(new URL('./dist/v2',import.meta.url)),emptyOutDir:true,target:'es2022',lib:{entry:fileURLToPath(new URL('./src/client/index.ts',import.meta.url)),formats:['es'],fileName:()=> 'client.js'},minify:true,sourcemap:false,chunkSizeWarningLimit:2000}};
});
