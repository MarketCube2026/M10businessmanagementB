import {db} from '../server/db';
import {executeRandom,targetStage} from '../server/random-flow';
for(let i=0;i<30;i++){const r=await executeRandom('manager-demo-v1',i,targetStage(i));console.log((i+1)+'/30 '+r.type+' '+r.status);}
await db.$disconnect();
