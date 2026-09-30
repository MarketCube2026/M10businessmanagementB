import { Router } from "express";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { tokenHash } from "./auth";
import { db } from "./db";
import { fail } from "./service";
export const scenarioDefinitions = [
  [
    "JMT101-017",
    "CDx共同开发与CTA检测",
    "PB",
    ["CTA检测", "CDx开发", "实验室手册1.2.0"],
  ],
  [
    "QLS5316-101",
    "临床检测与质控报告",
    "PB",
    ["NGS检测方案", "样本质控与报告"],
  ],
  [
    "BGB-A317-2001-IIT",
    "数据分析与文章框架",
    "PB",
    ["生物标志物分析报告", "文章图表与框架"],
  ],
  ["FCN-159-002", "研究稽查与CAPA整改", "PB", ["稽查证据包", "结题归档"]],
  [
    "SR-SEQUENCING",
    "测序试剂订单与月度结算",
    "SR",
    ["测序数据交付", "试剂交付"],
  ],
] as const;
export async function initializeScenarios() {
  for (const [code, title] of scenarioDefinitions)
    await db.scenario.upsert({
      where: { code },
      update: {},
      create: { code, title: "演练 · " + title },
    });
}
export const scenarioRouter = Router();
scenarioRouter.get("/scenarios", async (req, res, next) => {
  try {
    if (req.user.role !== "admin") fail("案例初始化与执行仅管理员可用", 403);
    res.json(await db.scenario.findMany({ orderBy: { code: "asc" } }));
  } catch (e) {
    next(e);
  }
});
export async function runScenario(id: string, user: any) {
  if (user.role !== "admin") fail("仅管理员可运行案例", 403);
  const scenario = await db.scenario.findUniqueOrThrow({ where: { id } });
  if (scenario.status === "running" || scenario.status === "passed")
    fail("案例正在执行或已经通过，请查看验收记录", 409);
  if (scenario.status === "failed")
    fail("案例上次失败，保留现场，请修复后由维护人员重建演练", 409);
  const claim = await db.scenario.updateMany({
    where: { id, status: "ready" },
    data: { status: "running" },
  });
  if (!claim.count) fail("案例已被其他会话执行", 409);
  const def = scenarioDefinitions.find((d) => d[0] === scenario.code)!;
  const { app } = await import("./app");
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      id: tokenHash(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const client = request(app);
  const steps: any[] = [];
  async function call(
    method: "get" | "post" | "patch",
    url: string,
    body?: any,
  ) {
    const res = await client[method]("/api/v1" + url)
      .set("Cookie", "bd_session=" + token)
      .send(body);
    if (res.status >= 300) throw Error(url + ": " + res.body.error);
    return res.body;
  }
  async function step(label: string, fn: () => Promise<any>) {
    const result = await fn();
    steps.push({
      label,
      status: "passed",
      recordId: result?.kind && result?.id ? result.id : undefined,
      at: new Date().toISOString(),
    });
    await db.scenario.update({
      where: { id },
      data: { steps: JSON.stringify(steps) },
    });
    return result;
  }
  const act = async (r: any, a: string, extra: any = {}) => {
    const fresh = await call("get", "/records/" + r.id);
    return call("post", "/records/" + r.id + "/actions", {
      action: a,
      version: fresh.version,
      comment: "演练模拟：" + a,
      ...extra,
    });
  };
  const create = (
    kind: string,
    title: string,
    caseId: string,
    parentId: string | undefined,
    data: any,
  ) =>
    call("post", "/records", {
      kind,
      title: "演练 · " + title,
      caseId,
      ...(parentId ? { parentId } : {}),
      data,
    });
  const approve = async (r: any) => {
    await act(r, "submit");
    return act(r, "approve");
  };
  try {
    const customer = await step("建立独立演练客户", () =>
      call("post", "/customers", {
        name: "演练客户 · " + scenario.code,
        contact: "模拟业务联系人",
      }),
    );
    // Nature assigned at initialization only; every subsequent transition uses the public API.
    const c = await db.businessCase.create({
      data: {
        customerId: customer.id,
        title: scenario.title,
        nature: "scenario",
        businessLine: def[2],
        protocol: scenario.code,
      },
    });
    await db.scenario.update({ where: { id }, data: { caseId: c.id } });
    let lead = await step("初始化待处理线索", () =>
      create("lead", scenario.code + "合作线索", c.id, undefined, {
        company: customer.name,
        target: scenario.code === "SR-SEQUENCING" ? "测序服务" : "NGS",
        source: "演练模拟，不是原项目实际商务记录",
      }),
    );
    await step("线索转换为商机", () => act(lead, "convert"));
    const opp = (await call("get", "/records?kind=opportunity&caseId=" + c.id))
      .rows[0];
    await step("评估并决定跟进", () =>
      act(opp, "follow", { comment: "演练：需求与可用平台匹配，进入拜访" }),
    );
    const visit = await step("创建拜访纪要", () =>
      create("visit", "需求拜访", c.id, opp.id, {
        contact: "模拟联系人",
        dueDate: "2026-10-15",
        notes: "演练：确认交付范围、样本条件及预算",
        nextAction: "提交技术方案",
      }),
    );
    await step("确认纪要并生成行动项", () => act(visit, "confirm"));
    let proposal = await step("创建商业提案", () =>
      create("proposal", "业务方案", c.id, opp.id, {
        test: "NGS（演练）",
        samples: 10,
        centers: 1,
        notes:
          "演练方案：背景、目标、设计、交付包、里程碑和验收标准。样本10份为模拟，不替代真实历史数量。",
      }),
    );
    await step("提案提交与退回", async () => {
      await act(proposal, "submit");
      return act(proposal, "reject", { comment: "演练：补充版本与交付清单" });
    });
    proposal = await step("提案重新提交并审核通过", () => approve(proposal));
    let quote = await step("报价测算", () =>
      create("quote", "模拟报价", c.id, proposal.id, {
        samples: 10,
        unitPrice: 1000,
        unitCost: 400,
        centerCost: 1000,
        riskCost: 500,
        notes: "所有价格为演练假设；不代表历史项目报价",
      }),
    );
    quote = await step("财务审核报价", () => approve(quote));
    let contract = await step("合同草稿", () =>
      create(
        "contract",
        def[2] === "SR" ? "框架合同" : "检测合作合同",
        c.id,
        quote.id,
        {
          notes:
            "演练模拟合同：付款40%/60%，责任及IP按双方书面约定。" +
            (def[2] === "SR"
              ? "框架合作以实际订单结算，不以模拟报价作为合同上限。"
              : ""),
          contractType: def[2] === "SR" ? "framework" : "fixed",
        },
      ),
    );
    contract = await step("法务审核", () => approve(contract));
    contract = await step("登记模拟签署", () =>
      act(contract, "sign", {
        comment: JSON.stringify({
          signer: "演练授权代表",
          signedDate: "2026-10-01",
        }),
      }),
    );
    const project = await step("创建交付项目", () =>
      create("project", scenario.code + "交付", c.id, contract.id, {
        dueDate: "2026-12-31",
        notes: "演练项目，仅用于流程验收",
      }),
    );
    async function workflow(kind: string, title: string, data: any) {
      let w = await call("post", "/workflow", {
        recordId: project.id,
        kind,
        title: "演练 · " + title,
        data,
      });
      w = await call("post", "/workflow/" + w.id + "/actions", {
        action: "submit",
        version: w.version,
        comment: "演练提交",
      });
      w = await call("post", "/workflow/" + w.id + "/actions", {
        action: "approve",
        version: w.version,
        comment: "演练审核",
      });
      return w;
    }
    for (const title of def[3])
      await step("交付包：" + title, async () => {
        let w = await workflow("deliverable", title, {
          type: title,
          responsible: "模拟PM",
          dueDate: "2026-11-30",
          requirements: "独立版本、交付清单、人工验收",
          versionLabel: "v1.0",
        });
        return call("post", "/workflow/" + w.id + "/actions", {
          action: "complete",
          version: w.version,
          comment: "演练验收证据：内容完整，版本与交付清单一致",
        });
      });
    const sample = await step("样本登记", () =>
      create("sample", "模拟样本001", c.id, project.id, {
        code: "DEMO-" + scenario.code + "-001",
        sampleType: "模拟血液样本",
      }),
    );
    await step("样本异常登记", () =>
      act(sample, "abnormal", { comment: "演练：运输记录缺失" }),
    );
    await step("样本异常解决并完成", () =>
      act(sample, "done", { comment: "演练：补充记录并通过质控" }),
    );
    if (scenario.code === "FCN-159-002")
      await step("CAPA整改复核关闭", async () => {
        const w = await workflow("quality", "模拟稽查整改", {
          type: "演练缺陷：运输记录归档不完整",
          responsible: "模拟QA",
          dueDate: "2026-11-10",
          requirements: "补齐记录并复核，不代表历史真实缺陷",
        });
        return call("post", "/workflow/" + w.id + "/actions", {
          action: "close",
          version: w.version,
          comment: "模拟QA复核证据：记录完整且版本可追溯",
        });
      });
    const milestone = await step("建立交付验收节点", () =>
      create("milestone", "交付验收", c.id, project.id, {
        dueDate: "2026-12-01",
        notes: "核对交付包与样本",
      }),
    );
    await step("里程碑完成", () => act(milestone, "done"));
    await step("项目验收完成", () => act(project, "done"));
    let ar: any;
    if (def[2] === "SR") {
      const order = await step("多单位测序订单", () =>
        workflow("order", "测序订单", {
          items: [
            {
              name: "测序",
              unit: "Lane",
              quantity: 2,
              price: 1800,
              cost: 1000,
              supplier: "模拟供应商",
              delivered: 2,
              adjustmentCents: -10000,
              adjustmentReason: "模拟产出折算",
            },
          ],
        }),
      );
      const reagent = await step("试剂订单", () =>
        workflow("order", "试剂订单", {
          items: [
            {
              name: "试剂",
              unit: "套",
              quantity: 2,
              price: 500,
              cost: 300,
              delivered: 2,
            },
          ],
        }),
      );
      let settlement = await step("月度结算单", () =>
        workflow("settlement", "10月结算", {
          orderIds: [order.id, reagent.id],
        }),
      );
      await step("开票记录独立登记", () =>
        workflow("invoice", "模拟发票", {
          settlementId: settlement.id,
          number: "DEMO-INVOICE-" + id,
          amount: settlement.data.amountCents / 100,
          date: "2026-10-31",
        }),
      );
      settlement = await step("结算生成应收", () =>
        call("post", "/workflow/" + settlement.id + "/actions", {
          action: "receivable",
          version: settlement.version,
          dueDate: "2026-12-31",
          comment: "模拟应收，不代表实际回款",
        }),
      );
      ar = await call("get", "/records/" + settlement.data.receivableId);
    } else
      ar = await step("创建应收计划", () =>
        create("receivable", "模拟合同款", c.id, project.id, {
          amount: 10000,
          dueDate: "2026-12-31",
        }),
      );
    const cents = ar.data.amountCents;
    await step("40%部分到账", () =>
      act(ar, "receive", {
        amount: Math.round(cents * 0.4) / 100,
        reference: "DEMO-" + id + "-1",
      }),
    );
    await step("尾款到账结清", () =>
      act(ar, "receive", {
        amount: (cents - Math.round(cents * 0.4)) / 100,
        reference: "DEMO-" + id + "-2",
      }),
    );
    const review = await step("项目复盘", () =>
      create("review", "复盘与复用清单", c.id, project.id, {
        notes:
          "演练：成功点为链路完整；改进点为提前复核缺失项；复用模板为交付检查表。不含原始研究数据或联系人隐私。",
      }),
    );
    await step("复盘审批", () => approve(review));
    await step("确认脱敏并发布", () => act(review, "publish"));
    await db.scenario.update({ where: { id }, data: { status: "passed" } });
    return { ok: true, steps };
  } catch (e: any) {
    steps.push({ label: e.message, status: "failed" });
    await db.scenario.update({
      where: { id },
      data: { status: "failed", steps: JSON.stringify(steps) },
    });
    throw e;
  } finally {
    await db.session.deleteMany({ where: { id: tokenHash(token) } });
  }
}
scenarioRouter.post("/scenarios/:id/run", async (req, res, next) => {
  try {
    res.json(await runScenario(req.params.id, req.user));
  } catch (e) {
    next(e);
  }
});
