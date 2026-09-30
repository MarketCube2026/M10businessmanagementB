import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import request from "supertest";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { quoteTotals, validateData } from "../shared/domain";
import {priceItems,addDays} from '../shared/extensions';
const temporary = mkdtempSync(path.join(tmpdir(), "bd-flow-test-"));
process.env.DATABASE_URL =
  "file:" + path.join(temporary, "test.db").replaceAll("\\", "/");
process.env.APP_MODE = "demo";
process.env.STORAGE_DIR = path.join(temporary, "files");
new DatabaseSync(path.join(temporary, "test.db")).close();
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env: process.env, stdio: "pipe" },
);
const { app } = await import("../server/app");
const { db } = await import("../server/db");
const { seed } = await import("../server/seed");
const { provider, runTask } = await import("../server/provider");
await seed();
after(async () => {
  await db.$disconnect();
  rmSync(temporary, { recursive: true, force: true });
});
const clients: Record<string, ReturnType<typeof request.agent>> = {};
async function login(role: string) {
  const a = request.agent(app);
  await a
    .post("/api/v1/login")
    .send({ username: role, password: "Demo2026!" })
    .expect(200);
  clients[role] = a;
  return a;
}
const post = async (role: string, url: string, data: any) => {
  const res = await clients[role].post("/api/v1" + url).send(data);
  assert.ok(res.status < 300, JSON.stringify(res.body));
  return res.body;
};
const get = async (role: string, url: string) => {
  const res = await clients[role].get("/api/v1" + url);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
async function act(role: string, r: any, a: string, extra: any = {}) {
  const fresh = await get(role, "/records/" + r.id);
  return post(role, "/records/" + r.id + "/actions", {
    action: a,
    version: fresh.version,
    ...extra,
  });
}
test("金额计算与参数校验", () => {
  assert.deepEqual(
    quoteTotals({
      samples: 3,
      unitPrice: 10.01,
      unitCost: 4,
      centerCost: 2,
      riskCost: 1,
    }),
    { amountCents: 3003, costCents: 1500, margin: 1503 / 3003 },
  );
  assert.equal(quoteTotals({ samples: 1, unitPrice: 100 }).margin, null);
  assert.throws(() =>
    validateData("proposal", { samples: 0, centers: 1, test: "NGS" }),
  );
  assert.throws(() =>
    validateData("receivable", { amount: -1, dueDate: "2026-01-01" }),
  );
  assert.throws(() => validateData("task", { dueDate: "2026-02-30" }));
  assert.throws(() => quoteTotals({ samples: 1e9, unitPrice: 1e9 }));
});
test("完整业务链、跨角色权限、文件导出和持久化", async (t) => {
  for (const role of [
    "admin",
    "bd",
    "manager",
    "technical",
    "delivery",
    "finance",
    "legal",
  ])
    await login(role);
  await request(app).get("/api/v1/records").expect(401);
  let lead: any,
    opp: any,
    proposal: any,
    quote: any,
    contract: any,
    project: any,
    ar: any,
    visit: any;
  await t.test("客户去重、线索转换与商机授权", async () => {
    lead = await post("bd", "/records", {
      kind: "lead",
      title: "集成验收 MRD",
      data: { company: "集成验收客户", source: "人工录入", target: "MRD" },
    });
    const converted = await act("bd", lead, "convert");
    await clients.bd
      .post("/api/v1/records/" + lead.id + "/actions")
      .send({ action: "convert", version: converted.version })
      .expect(409);
    opp = (
      await get("bd", "/records?kind=opportunity&caseId=" + converted.caseId)
    ).rows[0];
    const cases = await get("bd", "/cases");
    const c = cases.find((c: any) => c.id === opp.caseId);
    await clients.technical.get("/api/v1/records/" + opp.id).expect(404);
    const users = await get("admin", "/users");
    await post("admin", "/customers/" + c.customerId + "/grants", {
      userIds: users
        .filter((u: any) => u.role !== "manager")
        .map((u: any) => u.id),
    });
    await clients.bd
      .post("/api/v1/customers")
      .send({ name: "集成验收客户" })
      .expect(409);
    opp = await act("bd", opp, "follow", { comment: "技术匹配，推进拜访" });
    await clients.bd
      .patch("/api/v1/records/" + opp.id)
      .send({
        title: opp.title,
        version: opp.version,
        data: opp.data,
        status: "approved",
      })
      .expect(400);
  });
  await t.test("纪要、确认幂等与并发冲突", async () => {
    visit = await post("bd", "/records", {
      kind: "visit",
      title: "首次拜访",
      caseId: opp.caseId,
      parentId: opp.id,
      data: {
        contact: "李老师",
        dueDate: "2026-01-01",
        notes: "客户需要MRD检测",
        nextAction: "确认样本需求",
      },
    });
    const edited = await clients.bd
      .patch("/api/v1/records/" + visit.id)
      .send({
        title: "首次拜访更新",
        version: visit.version,
        data: { notes: "SPIN：明确需求" },
      })
      .expect(200);
    await clients.bd
      .patch("/api/v1/records/" + visit.id)
      .send({
        title: "冲突更新",
        version: visit.version,
        data: { notes: "旧版" },
      })
      .expect(409);
    visit = await act("bd", edited.body, "confirm");
    await clients.bd
      .post("/api/v1/records/" + visit.id + "/actions")
      .send({ action: "confirm", version: visit.version })
      .expect(409);
    const detail = await get("bd", "/records/" + visit.id);
    assert.equal(
      detail.children.filter((r: any) => r.kind === "task").length,
      1,
    );
  });
  await t.test("提案审批、退回意见与报价成本隔离", async () => {
    proposal = await post("bd", "/records", {
      kind: "proposal",
      title: "MRD 商业提案",
      caseId: opp.caseId,
      parentId: opp.id,
      data: {
        test: "MRD",
        samples: 10,
        centers: 1,
        notes:
          "背景：科研合作\\n目标：检测交付\\n设计：血液样本\\n时间线：30天\\n交付物：报告",
      },
    });
    await clients.bd
      .post("/api/v1/records")
      .send({
        kind: "quote",
        title: "非法越级报价",
        caseId: opp.caseId,
        parentId: proposal.id,
        data: { samples: 10, unitPrice: 100 },
      })
      .expect(400);
    proposal = await act("bd", proposal, "submit");
    await clients.bd
      .post("/api/v1/records/" + proposal.id + "/actions")
      .send({ action: "approve", version: proposal.version })
      .expect(403);
    await clients.technical
      .post("/api/v1/records/" + proposal.id + "/actions")
      .send({ action: "reject", version: proposal.version })
      .expect(400);
    proposal = await act("technical", proposal, "reject", {
      comment: "补充技术描述",
    });
    proposal = await act("bd", proposal, "submit");
    proposal = await act("technical", proposal, "approve");
    quote = await post("bd", "/records", {
      kind: "quote",
      title: "MRD 报价",
      caseId: opp.caseId,
      parentId: proposal.id,
      data: { samples: 10, unitPrice: 1000 },
    });
    assert.equal(
      (await get("bd", "/records/" + quote.id)).data.costCents,
      undefined,
    );
    quote = (
      await clients.finance
        .patch("/api/v1/records/" + quote.id)
        .send({
          title: quote.title,
          version: quote.version,
          data: { unitCost: 400, centerCost: 500, riskCost: 0 },
        })
        .expect(200)
    ).body;
    assert.equal(quote.data.amountCents, 1000000);
    assert.equal(quote.data.costCents, 450000);
    assert.equal(
      (await get("bd", "/records/" + quote.id)).data.unitCost,
      undefined,
    );
    const costFile = await clients.finance
      .post("/api/v1/records/" + quote.id + "/files")
      .attach("file", Buffer.from("internal cost details"), "cost.txt")
      .expect(201);
    await clients.bd.get("/api/v1/files/" + costFile.body.id).expect(403);
    assert.deepEqual((await get("bd", "/records/" + quote.id)).files, []);
    await clients.bd
      .patch("/api/v1/records/" + quote.id)
      .send({
        title: quote.title,
        version: quote.version,
        data: { unitCost: 1 },
      })
      .expect(403);
    quote = await act("bd", quote, "submit");
    quote = await act("finance", quote, "approve");
  });
  await t.test("合同审查、签署及唯一项目", async () => {
    contract = await post("bd", "/records", {
      kind: "contract",
      title: "科研服务合同",
      caseId: opp.caseId,
      parentId: quote.id,
      data: {
        notes:
          "付款条件：40/40/20；IP归属、数据使用范围、责任上限及争议解决需法务确认",
      },
    });
    await clients.bd
      .post("/api/v1/records/" + contract.id + "/actions")
      .send({ action: "sign", version: contract.version })
      .expect(409);
    contract = await act("bd", contract, "submit");
    contract = await act("legal", contract, "approve");
    contract = await act("bd", contract, "sign", {
      comment: JSON.stringify({ signer: "授权代表", signedDate: "2026-09-30" }),
    });
    project = await post("delivery", "/records", {
      kind: "project",
      title: "MRD 交付",
      caseId: opp.caseId,
      parentId: contract.id,
      data: { dueDate: "2026-12-01", notes: "交付检测报告" },
    });
    await clients.delivery
      .post("/api/v1/records")
      .send({
        kind: "project",
        title: "重复项目",
        caseId: opp.caseId,
        parentId: contract.id,
        data: { dueDate: "2026-12-01" },
      })
      .expect(409);
  });
  await t.test("样本异常、里程碑与验收限制", async () => {
    const sample = await post("delivery", "/records", {
      kind: "sample",
      title: "样本001",
      caseId: opp.caseId,
      parentId: project.id,
      data: { code: "S001", sampleType: "血液" },
    });
    const milestone = await post("delivery", "/records", {
      kind: "milestone",
      title: "报告验收",
      caseId: opp.caseId,
      parentId: project.id,
      data: { dueDate: "2026-01-01" },
    });
    await act("delivery", sample, "abnormal", { comment: "运输温度异常" });
    await clients.delivery
      .post("/api/v1/records/" + project.id + "/actions")
      .send({ action: "done", version: project.version })
      .expect(400);
    await act("delivery", sample, "done", { comment: "重新采样，质控通过" });
    await act("delivery", milestone, "done");
    project = await act("delivery", project, "done");
  });
  await t.test("分期应收、部分到账、重复流水与超额核销", async () => {
    ar = await post("finance", "/records", {
      kind: "receivable",
      title: "一期应收",
      caseId: opp.caseId,
      parentId: project.id,
      data: { amount: 6000, dueDate: "2026-01-01" },
    });
    await post("finance", "/records", {
      kind: "receivable",
      title: "二期应收",
      caseId: opp.caseId,
      parentId: project.id,
      data: { amount: 4000, dueDate: "2027-01-01" },
    });
    await clients.finance
      .post("/api/v1/records")
      .send({
        kind: "receivable",
        title: "超额计划",
        caseId: opp.caseId,
        parentId: project.id,
        data: { amount: 1, dueDate: "2027-01-01" },
      })
      .expect(400);
    await clients.bd
      .post("/api/v1/records/" + ar.id + "/actions")
      .send({
        action: "receive",
        version: ar.version,
        amount: 2000,
        reference: "bank-1",
      })
      .expect(403);
    ar = await act("finance", ar, "receive", {
      amount: 2000,
      reference: "bank-1",
    });
    assert.equal(ar.status, "partial");
    await clients.finance
      .post("/api/v1/records/" + ar.id + "/actions")
      .send({
        action: "receive",
        version: ar.version,
        amount: 2000,
        reference: "bank-1",
      })
      .expect(409);
    await clients.finance
      .post("/api/v1/records/" + ar.id + "/actions")
      .send({
        action: "receive",
        version: ar.version,
        amount: 5000,
        reference: "bank-2",
      })
      .expect(400);
    ar = await act("finance", ar, "receive", {
      amount: 4000,
      reference: "bank-2",
    });
    assert.equal(ar.status, "paid");
    await clients.finance
      .post("/api/v1/records/" + ar.id + "/actions")
      .send({ action: "archive", version: ar.version })
      .expect(400);
    const d = await get("bd", "/dashboard");
    assert.equal(d.pendingCents, 400000);
    assert.equal(d.signedCents, 1000000);
  });
  await t.test("十二工具输出、确认幂等、失败重试及真实引用", async () => {
    let review = await post("bd", "/records", {
      kind: "review",
      title: "交付复盘",
      caseId: opp.caseId,
      parentId: project.id,
      data: {
        notes:
          "成功点：样本质控；失败点：运输延迟；改进：记录温度；模板：验收清单",
      },
    });
    const task = await post("bd", "/ai", {
      recordId: review.id,
      tool: "review",
      input: "生成项目复盘",
    });
    await runTask(
      task.id,
      await db.user.findUniqueOrThrow({ where: { username: "bd" } }),
    );
    let generated = await db.aiTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(generated.status, "succeeded");
    await post("bd", "/ai/" + task.id + "/confirm", {
      output: "MRD项目复盘：成功点是质控通过，改进运输记录。",
      version: review.version,
    });
    await clients.bd
      .post("/api/v1/ai/" + task.id + "/confirm")
      .send({ output: "重复", version: review.version + 1 })
      .expect(409);
    review = await act("bd", review, "submit");
    review = await act("manager", review, "approve");
    await act("bd", review, "publish");
    const knowledge = await post("bd", "/records", {
      kind: "knowledge",
      title: "检索草稿",
      caseId: opp.caseId,
      data: { category: "案例", notes: "查询" },
    });
    const user = await db.user.findUniqueOrThrow({ where: { username: "bd" } });
    const answer = await provider.generate(
      "knowledge",
      "MRD",
      knowledge.id,
      user,
    );
    assert.match(answer, /交付复盘/);
    assert.match(answer, /来源/);
    assert.match(
      await provider.generate(
        "knowledge",
        "不存在的关键词zzzz",
        knowledge.id,
        user,
      ),
      /未找到相关资料/,
    );
    for (const [tool, r] of [
      ["radar", lead],
      ["triage", opp],
      ["brief", visit],
      ["minutes", visit],
      ["proposal", proposal],
      ["study", proposal],
      ["pricing", quote],
      ["contract", contract],
      ["report", project],
      ["health", project],
      ["review", review],
    ] as const)
      assert.ok(
        (await provider.generate(tool, "测试需求", r.id, user)).length > 30,
      );
    const failed = await db.aiTask.create({
      data: { recordId: knowledge.id, tool: "knowledge", input: "MRD" },
    });
    const original = provider.generate;
    provider.generate = async () => {
      throw new Error("provider unavailable");
    };
    try {
      await runTask(failed.id, user);
    } finally {
      provider.generate = original;
    }
    assert.equal(
      (await db.aiTask.findUniqueOrThrow({ where: { id: failed.id } })).status,
      "failed",
    );
    await post("bd", "/ai/" + failed.id + "/retry", {});
    await runTask(failed.id, user);
    assert.equal(
      (await db.aiTask.findUniqueOrThrow({ where: { id: failed.id } })).status,
      "succeeded",
    );
  });
  await t.test("文件解析、真实 DOCX/PDF、越权导出与持久化", async () => {
    const f = await clients.bd
      .post("/api/v1/records/" + proposal.id + "/files")
      .attach("file", Buffer.from("附件文本：方案背景"), "notes.txt")
      .expect(201);
    assert.equal(f.body.parseStatus, "parsed");
    await clients.bd
      .post("/api/v1/records/" + proposal.id + "/files")
      .attach("file", Buffer.from("bad pdf"), "invalid.pdf")
      .expect(201)
      .then((res) => assert.equal(res.body.parseStatus, "parse_failed"));
    await clients.bd
      .post("/api/v1/records/" + proposal.id + "/files")
      .attach("file", Buffer.from("audio"), "visit.wav")
      .expect(201)
      .then((res) =>
        assert.equal(res.body.parseStatus, "transcription_unconfigured"),
      );
    const word = await clients.bd
      .get("/api/v1/records/" + proposal.id + "/export/docx")
      .buffer(true)
      .parse((res, cb) => {
        const b: Buffer[] = [];
        res.on("data", (c) => b.push(c));
        res.on("end", () => cb(null, Buffer.concat(b)));
      })
      .expect(200);
    assert.match(
      (await mammoth.extractRawText({ buffer: word.body })).value,
      /MRD 商业提案/,
    );
    const pdf = await clients.bd
      .get("/api/v1/records/" + proposal.id + "/export/pdf")
      .buffer(true)
      .parse((res, cb) => {
        const b: Buffer[] = [];
        res.on("data", (c) => b.push(c));
        res.on("end", () => cb(null, Buffer.concat(b)));
      })
      .expect(200);
    assert.match((await pdfParse(pdf.body)).text, /MRD/);
    const outsider = await db.user.create({
      data: {
        username: "outsider",
        name: "另一BD",
        role: "bd",
        passwordHash: (
          await db.user.findUniqueOrThrow({ where: { username: "bd" } })
        ).passwordHash,
      },
    });
    await login("outsider");
    await clients.outsider.get("/api/v1/records/" + proposal.id).expect(404);
    await clients.outsider.get("/api/v1/files/" + f.body.id).expect(404);
    await clients.outsider
      .get("/api/v1/records/" + proposal.id + "/export/docx")
      .expect(404);
    await db.$disconnect();
    assert.equal((await get("finance", "/records/" + ar.id)).status, "paid");
    assert.ok(
      (await get("admin", "/audit")).some((a: any) => a.action === "receive"),
    );
    await clients.admin
      .post("/api/v1/demo/reset")
      .send({ confirm: "RESET DEMO" })
      .expect(403);
  });
  await t.test("CSV整批校验与跨站写入拒绝", async () => {
    await clients.bd
      .post("/api/v1/import/leads")
      .send({ csv: "title,company\n坏记录,\n" })
      .expect(400);
    const imported = await post("bd", "/import/leads", {
      csv: "title,company,target,source\n管线线索,CSV客户,EGFR,人工\n",
    });
    assert.equal(imported.count, 1);
    await clients.bd
      .post("/api/v1/customers")
      .set("Origin", "https://attacker.example")
      .send({ name: "恶意" })
      .expect(403);
  });
  await t.test('历史资料重复导入、来源权限、撤销及指标隔离',async()=>{
    const {previewSources,applyBatch}=await import('../server/history');
    const user=await db.user.findUniqueOrThrow({where:{username:'admin'}});
    const fixture:any={name:'SR历史测试.pptx',hash:'fixture-hash',businessLine:'SR',sourceDate:'2025-10',slides:[{page:1,title:'订单金额',category:'订单与财务',text:'历史订单，不等于回款',tables:[{index:1,rows:[['客户名称','项目号','金额'],['历史测试客户','H001','TBD']]}],charts:[],imageCount:0}]};
    const batch=await previewSources([fixture],new Map(),user);const result=await applyBatch(batch.id,user);
    assert.equal(result.recordIds.length,1);const r=await get('admin','/records/'+result.recordIds[0]);assert.equal(r.nature,'history');
    await clients.bd.get('/api/v1/sources').expect(403);await clients.bd.get('/api/v1/imports/export').expect(403);
    await clients.admin.post('/api/v1/records/'+r.id+'/actions').send({action:'submit',version:r.version}).expect(409);
    const duplicate=await previewSources([fixture],new Map(),user);assert.equal(duplicate.count,0);
    assert.equal((await get('admin','/dashboard')).pendingCents,400000);
    await post('admin','/imports/'+batch.id+'/undo',{});
    await clients.admin.get('/api/v1/records/'+r.id).expect(404);
  });
  await t.test('多单位价格、工作日与日历例外',()=>{
    assert.equal(priceItems([{name:'测序',unit:'Lane',quantity:2,price:100.01},{name:'试剂',unit:'套',quantity:3,price:50}]).amountCents,35002);
    assert.throws(()=>priceItems([{name:'测序',unit:'Lane',quantity:1,price:10,adjustmentCents:-10}]));
    assert.equal(addDays('2026-10-02',1,'working'),'2026-10-05');
    assert.equal(addDays('2026-10-02',1,'working',[{date:'2026-10-03',working:true}]),'2026-10-03');
    assert.equal(addDays('2026-10-02',1,'calendar'),'2026-10-03');
  });
  await t.test('五套演练通过实际API且不污染日常指标',async()=>{
    const {initializeScenarios,runScenario}=await import('../server/scenarios');await initializeScenarios();
    const before=await get('admin','/dashboard');const user=await db.user.findUniqueOrThrow({where:{username:'admin'}});
    for(const s of await db.scenario.findMany())await runScenario(s.id,user);
    const cases=await get('admin','/scenarios');assert.equal(cases.filter((s:any)=>s.status==='passed').length,5);
    const after=await get('admin','/dashboard');assert.equal(after.pendingCents,before.pendingCents);assert.equal(after.signedCents,before.signedCents);
    await clients.bd.post('/api/v1/scenarios/'+cases[0].id+'/run').send({}).expect(403);
    const orders=await get('admin','/orders');const bdOrders=await get('bd','/orders');assert.equal(bdOrders.length,0);assert.ok(orders.length>=2);
    const ars=await db.record.findMany({where:{nature:'scenario',kind:'receivable'}});assert.equal(ars.length,5);assert.ok(ars.every(a=>a.status==='paid'));
    const srContract=await db.record.findFirstOrThrow({where:{nature:'scenario',businessLine:'SR',kind:'contract'}});assert.equal(JSON.parse(srContract.data).contractType,'framework');assert.equal(JSON.parse(srContract.data).amountCents,null);
  });
});
