import {db} from './db';
import {fail,privileged} from './service';
import {promises as fs} from 'node:fs';
import path from 'node:path';
export async function resetRandomBatch(user:any,batch:string,confirmation:string){
 if(!privileged(user))fail('仅负责人可重置演练批次',403);
 if(!/^manager-demo-[a-z0-9-]+$/.test(batch)||confirmation!=='RESET '+batch)fail('必须明确指定演练批次并填写确认文字');
 const runs=await db.randomRun.findMany({where:{batch}});if(!runs.length)fail('批次不存在',404);if(runs.some(r=>r.status==='running'))fail('批次正在执行，不能重置',409);
 const cases=await db.businessCase.findMany({where:{id:{in:runs.flatMap(r=>r.caseId?[r.caseId]:[])}},include:{records:{include:{files:true,revisions:true,workflowItems:true}},customer:{include:{cases:true}}}});
 if(cases.some(c=>c.nature!=='scenario'||c.customer.cases.length!==1))fail('存在非演练数据或客户已被其他业务使用，禁止重置',409);
 const ids=cases.flatMap(c=>c.records.map(r=>r.id));
 if(await db.sourceRow.count({where:{recordId:{in:ids}}}))fail('有关联历史来源，禁止重置',409);
 const folder=path.resolve('backups/random-reset');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,batch+'-'+Date.now()+'.json'),JSON.stringify({runs,cases},null,2));
 await db.$transaction(async tx=>{
  await tx.riskHandling.deleteMany({where:{recordId:{in:ids}}});await tx.workflowItem.deleteMany({where:{recordId:{in:ids}}});await tx.aiTask.deleteMany({where:{recordId:{in:ids}}});await tx.attachment.deleteMany({where:{recordId:{in:ids}}});await tx.revision.deleteMany({where:{recordId:{in:ids}}});await tx.record.updateMany({where:{id:{in:ids}},data:{parentId:null}});await tx.record.deleteMany({where:{id:{in:ids}}});
  await tx.businessCase.deleteMany({where:{id:{in:cases.map(c=>c.id)}}});await tx.grant.deleteMany({where:{customerId:{in:cases.map(c=>c.customerId)}}});await tx.customer.deleteMany({where:{id:{in:cases.map(c=>c.customerId)}}});
  await tx.randomRun.updateMany({where:{batch},data:{status:'reset',caseId:null,batch:batch+'-archived-'+Date.now()}});await tx.auditLog.create({data:{actorId:user.id,entityId:batch,action:'random-reset',detail:'仅重置本批次演练，历史执行证据和备份保留'}});
 });return {ok:true,count:runs.length};
}
