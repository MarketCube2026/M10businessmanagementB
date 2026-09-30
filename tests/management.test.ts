import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import request from "supertest";
const temp = mkdtempSync(path.join(tmpdir(), "bd-manager-"));
process.env.DATABASE_URL =
  "file:" + path.join(temp, "test.db").replaceAll("\\", "/");
process.env.APP_MODE = "demo";
process.env.STORAGE_DIR = path.join(temp, "files");
new DatabaseSync(path.join(temp, "test.db")).close();
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env: process.env, stdio: "pipe" },
);
const { db } = await import("../server/db");
const { seed } = await import("../server/seed");
await seed();
const { app } = await import("../server/app");
const { overview } = await import("../server/management");
after(() => db.$disconnect());
test("负责人指标、有效跟进、权限、风险持久提醒与周报", async () => {
  const manager = request.agent(app),
    bd = request.agent(app),
    technical = request.agent(app);
  for (const [a, u] of [
    [manager, "manager"],
    [bd, "bd"],
    [technical, "technical"],
  ] as const)
    await a
      .post("/api/v1/login")
      .send({ username: u, password: "Demo2026!" })
      .expect(200);
  const c = await bd
    .post("/api/v1/customers")
    .send({ name: "管理测试客户" })
    .expect(201);
  const lead = (
    await bd
      .post("/api/v1/records")
      .send({
        kind: "lead",
        title: "停滞商机",
        data: { company: "管理测试客户", target: "NGS" },
      })
      .expect(201)
  ).body;
  const l = (
    await bd
      .post("/api/v1/records/" + lead.id + "/actions")
      .send({ action: "convert", version: lead.version })
      .expect(200)
  ).body;
  let opp = (
    await bd
      .get("/api/v1/records?kind=opportunity&caseId=" + l.caseId)
      .expect(200)
  ).body.rows[0];
  const u = await db.user.findUniqueOrThrow({ where: { username: "manager" } });
  let d = await overview(u, {});
  assert.ok(d.risks.some((r) => r.recordId === opp.id));
  const old = new Date(Date.now() - 20 * 86400000);
  await db.record.update({
    where: { id: opp.id },
    data: { lastFollowUpAt: old },
  });
  opp = (
    await bd
      .patch("/api/v1/records/" + opp.id)
      .send({
        title: "改标题不算跟进",
        version: opp.version,
        data: { nextAction: "待拜访" },
      })
      .expect(200)
  ).body;
  d = await overview(u, {});
  assert.equal(d.risks.find((r) => r.recordId === opp.id).type, "停滞商机");
  const technicalUser = await db.user.findUniqueOrThrow({
    where: { username: "technical" },
  });
  await manager
    .post("/api/v1/management/risks")
    .send({
      key: "follow:" + opp.id,
      recordId: opp.id,
      assigneeId: technicalUser.id,
      dueDate: "2026-12-31",
      note: "未授权应拒绝",
    })
    .expect(403);
  const bdUser = await db.user.findUniqueOrThrow({ where: { username: "bd" } });
  await manager
    .post("/api/v1/management/risks")
    .send({
      key: "follow:" + opp.id,
      recordId: opp.id,
      assigneeId: bdUser.id,
      dueDate: "2026-12-31",
      note: "安排跟进",
    })
    .expect(200);
  d = await overview(u, {});
  assert.equal(d.risks.find((r) => r.recordId === opp.id).handling.length, 1);
  await bd
    .post("/api/v1/records/" + opp.id + "/actions")
    .send({
      action: "followup",
      version: opp.version,
      comment: "已与客户沟通，周五提供方案",
    })
    .expect(200);
  assert.ok(!(await overview(u, {})).risks.some((r) => r.recordId === opp.id));
  const proposal = (
    await bd
      .post("/api/v1/records")
      .send({
        kind: "proposal",
        title: "审批中心方案",
        caseId: l.caseId,
        data: { test: "NGS", samples: 10, centers: 1, notes: "完整方案" },
      })
      .expect(201)
  ).body;
  await bd
    .post("/api/v1/records/" + proposal.id + "/actions")
    .send({ action: "submit", version: proposal.version })
    .expect(200);
  assert.equal(
    (await bd.get("/api/v1/management").expect(200)).body.approvals.length,
    0,
  );
  await manager
    .post("/api/v1/customers/" + c.body.id + "/grants")
    .send({ userIds: [technicalUser.id] })
    .expect(200);
  assert.equal(
    (await technical.get("/api/v1/management").expect(200)).body.approvals
      .length,
    1,
  );
  const filtered = await overview(u, {
    customerId: c.body.id,
    businessLine: "PB",
  });
  assert.equal(filtered.rows.filter((r) => r.kind === "opportunity").length, 1);
  assert.equal(
    filtered.signedCents,
    filtered.rows
      .filter((r) => r.kind === "contract" && r.status === "signed")
      .reduce((s, r) => s + (r.data.amountCents || 0), 0),
  );
  await manager
    .get("/api/v1/management?from=2026-12-31&to=2026-01-01")
    .expect(400);
  const report = (
    await manager
      .post("/api/v1/management/reports")
      .send({ nature: "daily", customerId: c.body.id })
      .expect(200)
  ).body;
  await bd
    .get("/api/v1/management/reports/" + report.id + "/export")
    .expect(403);
  await manager
    .patch("/api/v1/management/reports/" + report.id)
    .send({ version: report.version, content: "负责人周报" })
    .expect(200);
  await manager
    .patch("/api/v1/management/reports/" + report.id)
    .send({ version: report.version, content: "旧版" })
    .expect(409);
  await manager
    .get("/api/v1/management/reports/" + report.id + "/export")
    .expect(200);
  const {executeRandom}=await import('../server/random-flow');
  const simulated=await executeRandom('manager-demo-reset-test',0,'early');
  await manager.post('/api/v1/random-runs/reset').send({batch:'history',confirmation:'RESET history'}).expect(400);
  await bd.post('/api/v1/random-runs/reset').send({batch:'manager-demo-reset-test',confirmation:'RESET manager-demo-reset-test'}).expect(403);
  await manager.post('/api/v1/random-runs/reset').send({batch:'manager-demo-reset-test',confirmation:'RESET manager-demo-reset-test'}).expect(200);
  assert.equal(await db.businessCase.count({where:{id:simulated.caseId!}}),0);
  assert.equal((await db.randomRun.findUniqueOrThrow({where:{id:simulated.id}})).status,'reset');
  assert.ok(await db.customer.findUnique({where:{id:c.body.id}}));
});
