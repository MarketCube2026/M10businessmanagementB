import request from "supertest";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { hashPassword, tokenHash } from "./auth";
import { addDays } from "../shared/extensions";
export const seedBase = 20260930;
export function random(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
export function family(i: number) {
  return i < 8
    ? "CTA"
    : i < 12
      ? "CDx"
      : i < 16
        ? "分析文章"
        : i < 20
          ? "稽查整改"
          : i < 26
            ? "SR测序"
            : "SR试剂";
}
export function targetStage(i: number) {
  return i < 12
    ? "early"
    : i < 18
      ? "approval"
      : i < 24
        ? "delivery"
        : i < 27
          ? "partial"
          : "complete";
}
export async function randomActors() {
  for (let i = 2; i <= 4; i++)
    await db.user.upsert({
      where: { username: "bd" + i },
      update: {},
      create: {
        username: "bd" + i,
        name: "演练BD" + i,
        role: "bd",
        passwordHash: hashPassword(randomBytes(24).toString("hex")),
      },
    });
  const users = await db.user.findMany();
  return Object.fromEntries(
    users
      .filter((u) =>
        [
          "bd",
          "bd2",
          "bd3",
          "bd4",
          "manager",
          "technical",
          "legal",
          "finance",
          "delivery",
        ].includes(u.username),
      )
      .map((u) => [u.username, u]),
  );
}
export async function executeRandom(
  batch: string,
  index: number,
  target = "complete",
) {
  const seed = seedBase + index,
    rnd = random(seed),
    type = family(index),
    line = index < 20 ? "PB" : "SR";
  const existing = await db.randomRun.findUnique({
    where: { batch_index: { batch, index } },
  });
  if (existing) return existing;
  const run = await db.randomRun.create({
    data: { batch, index, seed, type, target, status: "running" },
  });
  const actors = await randomActors();
  const bdKey = ["bd", "bd2", "bd3", "bd4"][index % 4];
  const { app } = await import("./app");
  const tokens: Record<string, string> = {};
  for (const [key, u] of Object.entries(actors)) {
    const token = randomBytes(32).toString("hex");
    tokens[key] = token;
    await db.session.create({
      data: {
        id: tokenHash(token),
        userId: u.id,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
  }
  const started = Date.now(),
    steps: any[] = [];
  let caseId: string | undefined;
  async function req(
    role: string,
    method: "get" | "post" | "patch",
    url: string,
    body?: any,
    expected?: number,
  ) {
    const start = Date.now();
    const response = await request(app)
      [method]("/api/v1" + url)
      .set("Cookie", "bd_session=" + tokens[role])
      .send(body);
    if (
      expected !== undefined
        ? response.status !== expected
        : response.status >= 300
    )
      throw Error(
        role +
          " " +
          url +
          "：" +
          response.status +
          " " +
          JSON.stringify(response.body),
      );
    steps.push({
      role,
      method,
      url,
      status: response.status,
      expected: expected || "2xx",
      durationMs: Date.now() - start,
      recordId: response.body?.id,
      label: (body?.action || method) + " " + url,
    });
    await db.randomRun.update({
      where: { id: run.id },
      data: { steps: JSON.stringify(steps), durationMs: Date.now() - started },
    });
    return response.body;
  }
  const title = (s: string) =>
    "随机演练 " + String(index + 1).padStart(2, "0") + " · " + type + " · " + s;
  const today = new Date().toISOString().slice(0, 10);
  const date = (days: number) => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const act = async (role: string, r: any, action: string, extra: any = {}) => {
    const fresh = await req(role, "get", "/records/" + r.id);
    return req(role, "post", "/records/" + r.id + "/actions", {
      action,
      version: fresh.version,
      comment: "演练证据 " + action,
      ...extra,
    });
  };
  const create = (
    role: string,
    kind: string,
    name: string,
    parentId: string | undefined,
    data: any,
  ) =>
    req(role, "post", "/records", {
      kind,
      title: title(name),
      caseId,
      ...(parentId ? { parentId } : {}),
      data,
    });
  const approve = async (author: string, reviewer: string, r: any) => {
    await act(author, r, "submit");
    return act(reviewer, r, "approve");
  };
  const stop = async () =>
    db.randomRun.update({
      where: { id: run.id },
      data: {
        caseId,
        status: target === "complete" ? "passed" : "retained",
        durationMs: Date.now() - started,
        steps: JSON.stringify(steps),
      },
    });
  try {
    const customer = await req(bdKey, "post", "/customers", {
      name: title("模拟客户") + " " + batch,
      contact: "模拟联系人" + (index + 1),
    });
    const c = await req(bdKey, "post", "/cases", {
      customerId: customer.id,
      title: title("业务档案"),
    });
    caseId = c.id;
    await db.businessCase.update({
      where: { id: caseId },
      data: { nature: "scenario", businessLine: line },
    });
    await db.randomRun.update({ where: { id: run.id }, data: { caseId } });
    await req("manager", "post", "/customers/" + customer.id + "/grants", {
      userIds: Object.values(actors).map((u) => u.id),
    });
    const lead = await create(bdKey, "lead", "合作线索", undefined, {
      company: customer.name,
      target: type === "SR试剂" ? "试剂" : "NGS",
      source: "固定种子随机模拟，非真实商务资料",
    });
    const converted = await act(bdKey, lead, "convert");
    if (target === "complete")
      await req(
        bdKey,
        "post",
        "/records/" + lead.id + "/actions",
        { action: "convert", version: converted.version },
        409,
      );
    let opp = (
      await req(bdKey, "get", "/records?kind=opportunity&caseId=" + caseId)
    ).rows[0];
    const samples = 10 + Math.floor(rnd() * 90),
      price = 300 + Math.floor(rnd() * 1700),
      expected = samples * price;
    opp = await req(bdKey, "patch", "/records/" + opp.id, {
      version: opp.version,
      title: opp.title,
      data: {
        test: "NGS",
        expectedAmount: expected,
        expectedCloseDate: date(7 + index),
        priority: ["高", "中", "低"][index % 3],
        nextAction: "与模拟客户确认方案范围",
      },
    });
    await act(bdKey, opp, "follow");
    if (target === "early" && index % 3 === 0) return await stop();
    const visit = await create(bdKey, "visit", "需求拜访", opp.id, {
      contact: "模拟联系人" + index,
      dueDate: date(index % 2 ? -3 : 3),
      notes: "确认样本、中心、检测与交付周期；不含个人数据",
      nextAction: "提交检测技术方案",
    });
    await act(bdKey, visit, "confirm");
    const task = (
      await req(bdKey, "get", "/records?kind=task&caseId=" + caseId)
    ).rows[0];
    await req("manager", "post", "/management/tasks/" + task.id, {
      action: "assign",
      version: task.version,
      assigneeId: actors.technical.id,
      note: "技术同事确认方案",
    });
    if (target === "complete") {
      const taskFresh = await req("technical", "get", "/records/" + task.id);
      await req("technical", "post", "/management/tasks/" + task.id, {
        action: "postpone",
        version: taskFresh.version,
        dueDate: date(10),
        note: "补充检测条件",
      });
      await act("technical", task, "done");
    }
    if (target === "early" && index % 3 === 1) return await stop();
    let proposal = await create(bdKey, "proposal", "商业方案", opp.id, {
      test: "NGS模拟检测",
      samples,
      centers: 1 + Math.floor(rnd() * 5),
      notes: "背景、目标、入组条件、样本、报告和交付标准均为演练参数。",
    });
    if (target === "early") return await stop();
    await act(bdKey, proposal, "submit");
    if (target === "approval" && index % 3 === 0) return await stop();
    if (target === "complete")
      await req(
        bdKey,
        "post",
        "/records/" + proposal.id + "/actions",
        {
          action: "approve",
          version: (await req(bdKey, "get", "/records/" + proposal.id)).version,
        },
        403,
      );
    if (index % 4 === 0) {
      await act("technical", proposal, "reject", {
        comment: "退回：补充交付清单",
      });
      const p = await req(bdKey, "get", "/records/" + proposal.id);
      await req(bdKey, "patch", "/records/" + p.id, {
        version: p.version,
        title: p.title,
        data: { notes: "已补充报告交付与验收清单" },
      });
      await act(bdKey, proposal, "submit");
    }
    proposal = await act("technical", proposal, "approve");
    let quote = await create(bdKey, "quote", "商务报价", proposal.id, {
      samples,
      unitPrice: price,
    });
    quote = await req("finance", "patch", "/records/" + quote.id, {
      title: quote.title,
      version: quote.version,
      data: {
        unitCost: Math.floor(price * 0.4),
        centerCost: 1000,
        riskCost: 200,
      },
    });
    if (target === "complete") {
      const sale = await req(bdKey, "get", "/records/" + quote.id);
      if (sale.data.unitCost !== undefined) throw Error("成本泄露");
      await req(
        bdKey,
        "patch",
        "/records/" + quote.id,
        { title: quote.title, version: quote.version, data: { unitCost: 1 } },
        403,
      );
    }
    await act(bdKey, quote, "submit");
    if (target === "approval" && index % 3 === 1) return await stop();
    quote = await act("finance", quote, "approve");
    let contract = await create(bdKey, "contract", "合作合同", quote.id, {
      contractType: line === "SR" ? "framework" : "fixed",
      notes: "模拟条款：IP归属、付款条件、责任上限及数据使用范围已明确",
    });
    await act(bdKey, contract, "submit");
    if (target === "approval") return await stop();
    await act("legal", contract, "approve");
    contract = await act(bdKey, contract, "sign", {
      comment: JSON.stringify({ signer: "模拟授权人", signedDate: today }),
    });
    const project = await create(
      "delivery",
      "project",
      "项目执行",
      contract.id,
      {
        dueDate: date(index % 2 ? -2 : 30),
        notes: "演练交付，不代表实际实验或注册进度",
      },
    );
    async function wf(author: string, kind: string, name: string, data: any) {
      let w = await req(author, "post", "/workflow", {
        recordId: project.id,
        kind,
        title: title(name),
        data,
      });
      w = await req(author, "post", "/workflow/" + w.id + "/actions", {
        action: "submit",
        version: w.version,
        comment: "提交交付依据",
      });
      if (kind === "deliverable" && index % 4 === 1) {
        w = await req("technical", "post", "/workflow/" + w.id + "/actions", {
          action: "reject",
          version: w.version,
          comment: "交付清单待补",
        });
        w = await req(author, "patch", "/workflow/" + w.id, {
          version: w.version,
          title: w.title,
          data: { requirements: "已补齐图表和版本清单" },
        });
        w = await req(author, "post", "/workflow/" + w.id + "/actions", {
          action: "submit",
          version: w.version,
          comment: "完成返修",
        });
      }
      return req(
        ["order", "settlement", "invoice"].includes(kind)
          ? "finance"
          : "technical",
        "post",
        "/workflow/" + w.id + "/actions",
        { action: "approve", version: w.version, comment: "角色审核通过" },
      );
    }
    const branches =
      type === "CDx"
        ? ["CTA检测", "CDx开发", "手册版本"]
        : type === "分析文章"
          ? ["分析图表", "文章框架"]
          : ["检测报告"];
    const deliveries = [];
    for (const branch of branches)
      deliveries.push(
        await wf("delivery", "deliverable", branch, {
          type: branch,
          requirements: "版本v1；图表和报告可追溯",
          responsible: "模拟交付",
          dueDate: date(15),
        }),
      );
    let quality: any;
    if (type === "稽查整改")
      quality = await wf("delivery", "quality", "稽查整改", {
        type: "模拟稽查缺陷：温控证据不完整",
        responsible: "模拟QA",
        requirements: "补充原始记录并独立复核",
        dueDate: date(-1),
      });
    const sample = await create("delivery", "sample", "样本登记", project.id, {
      code: "SIM-" + seed,
      sampleType: "模拟血液",
    });
    if (index % 2 === 0)
      await act("delivery", sample, "abnormal", {
        comment: "演练：运输异常待复核",
      });
    const milestone = await create(
      "delivery",
      "milestone",
      "验收节点",
      project.id,
      { dueDate: date(index % 2 ? -1 : 15), notes: "核对交付件完整性" },
    );
    if (target === "delivery") return await stop();
    for (const w of deliveries)
      await req("delivery", "post", "/workflow/" + w.id + "/actions", {
        action: "complete",
        version: w.version,
        comment: "交付版本与清单一致，验收通过",
      });
    if (quality)
      await req("technical", "post", "/workflow/" + quality.id + "/actions", {
        action: "close",
        version: quality.version,
        comment: "证据已核对，整改关闭",
      });
    await act("delivery", sample, "done", {
      comment: "异常解决，重新采样并质控通过",
    });
    await act("delivery", milestone, "done");
    await act("delivery", project, "done");
    let ar: any;
    if (line === "SR") {
      const order = await wf("finance", "order", "测序服务订单", {
        items: [
          {
            name: "测序",
            unit: "Lane",
            quantity: 1 + Math.floor(rnd() * 4),
            price: 2000 + Math.floor(rnd() * 1000),
            cost: 1000,
            supplier: "模拟供应商",
            adjustmentCents: -10000,
            adjustmentReason: "模拟补测折算",
          },
        ],
      });
      const reagent = await wf("finance", "order", "试剂订单", {
        items: [
          {
            name: "试剂",
            unit: "套",
            quantity: 1 + Math.floor(rnd() * 5),
            price: 500,
            cost: 200,
          },
        ],
      });
      let settlement = await wf("finance", "settlement", "月度结算", {
        orderIds: [order.id, reagent.id],
      });
      await wf("finance", "invoice", "开票登记", {
        settlementId: settlement.id,
        number: "SIM-INV-" + run.id,
        amount: settlement.data.amountCents / 100,
        date: today,
      });
      settlement = await req(
        "finance",
        "post",
        "/workflow/" + settlement.id + "/actions",
        {
          action: "receivable",
          version: settlement.version,
          dueDate: date(-5),
          comment: "模拟结算应收",
        },
      );
      ar = await req(
        "finance",
        "get",
        "/records/" + settlement.data.receivableId,
      );
    } else
      ar = await create("finance", "receivable", "合同应收", project.id, {
        amount: expected,
        dueDate: date(-5),
      });
    const cents = ar.data.amountCents;
    ar = await act("finance", ar, "receive", {
      amount: Math.floor(cents * 0.4) / 100,
      reference: "SIM-" + run.id + "-A",
    });
    if (target === "complete") {
      await req(
        "finance",
        "post",
        "/records/" + ar.id + "/actions",
        {
          action: "receive",
          version: ar.version,
          amount: 1,
          reference: "SIM-" + run.id + "-A",
        },
        409,
      );
      await req(
        "finance",
        "post",
        "/records/" + ar.id + "/actions",
        {
          action: "receive",
          version: ar.version,
          amount: cents / 100 + 1,
          reference: "SIM-" + run.id + "-OVER",
        },
        400,
      );
    }
    if (target === "partial") return await stop();
    ar = await act("finance", ar, "receive", {
      amount: (cents - Math.floor(cents * 0.4)) / 100,
      reference: "SIM-" + run.id + "-B",
    });
    if (ar.status !== "paid" || ar.data.receivedCents !== cents)
      throw Error("应收最终余额不一致");
    const review = await create(bdKey, "review", "复盘归档", project.id, {
      notes: "模拟复盘：流程完整；改进点为提前识别风险；不含真实历史研究数据。",
    });
    await approve(bdKey, "manager", review);
    await act(bdKey, review, "publish");
    const records = (
      await req("manager", "get", "/records?caseId=" + caseId + "&limit=200")
    ).rows;
    if (records.some((r: any) => r.nature !== "scenario"))
      throw Error("演练数据性质污染");
    if (
      !records.some((r: any) => r.kind === "review" && r.status === "published")
    )
      throw Error("复盘未发布");
    return await stop();
  } catch (e: any) {
    await db.randomRun.update({
      where: { id: run.id },
      data: {
        caseId,
        status: "failed",
        error: e.message,
        durationMs: Date.now() - started,
        steps: JSON.stringify(steps),
      },
    });
    throw e;
  } finally {
    await db.session.deleteMany({
      where: { id: { in: Object.values(tokens).map(tokenHash) } },
    });
  }
}
