import { createServer } from 'vite';
import { start } from './index.mjs';
const running=await start({port:4175,origin:'http://127.0.0.1:4174',allowedOrigins:['http://127.0.0.1:4174','http://127.0.0.1:4175']});
const vite=await createServer();await vite.listen();vite.printUrls();
const close=async()=>{await vite.close();running.server.close();running.app.close();process.exit(0);};process.on('SIGTERM',close);process.on('SIGINT',close);
