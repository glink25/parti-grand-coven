import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const mode=process.argv.includes('--room-dev')?'room-dev':process.argv.includes('--room-build')?'room-build':'standalone';
const outDir=mode==='room-dev'?process.env.PARTI_ROOM_DEV_OUT_DIR:mode==='room-build'?process.env.PARTI_ROOM_BUILD_OUT_DIR:path.join(root,'dist');
if(!outDir) throw new Error(mode==='room-dev'?'missing PARTI_ROOM_DEV_OUT_DIR':'missing PARTI_ROOM_BUILD_OUT_DIR');
await rm(outDir,{recursive:true,force:true});await mkdir(outDir,{recursive:true});
for (const [src,dst] of [
  ['src/worker/room.worker.js','room.worker.js'],['src/ui/client.js','client.js'],['src/ui/style.css','style.css'],
  ['index.html','index.html'],['public/parti.room.json','parti.room.json'],['public/cover.svg','cover.svg']
]) await cp(src,path.join(outDir,dst));
