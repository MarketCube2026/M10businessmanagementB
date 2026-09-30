import { Router } from "express";
import { z } from "zod";
import { User } from "@prisma/client";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { db } from "./db";
import {
  accessible,
  audit,
  customerScope,
  fail,
  privileged,
  recordScope,
  safeRecord,
  write,
} from "./service";
import { Kind, reviewers } from "../shared/domain";
import { addDays } from "../shared/extensions";
import { resetRandomBatch } from "./random-reset";
export const managementRouter = Router();
const wrap = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res)).catch(next);
export const filterSchema = z.object({
  nature: z.enum(["daily", "history", "scenario"]).default("daily"),
  businessLine: z.enum(["PB", "SR"]).optional(),
  ownerId: z.string().optional(),
  customerId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export function validFilters(input: any) {
  const f = filterSchema.parse(input);
  for (const d of [f.from, f.to]) if (d) addDays(d, 0, "calendar");
  if (f.from && f.to && f.from > f.to) fail("开始日期不能晚于结束日期");
  return f;
}
export function phase(rows: { kind: string; status: string }[]) {
  if (rows.some((r) => r.kind === "contract" && r.status === "signed"))
    return "已签";
  if (rows.some((r) => r.kind === "opportunity" && r.status === "lost"))
    return "丢单";
  for (const [kind, label] of [
    ["contract", "合同"],
    ["quote", "报价"],
    ["proposal", "方案"],
    ["visit", "拜访"],
  ])
    if (rows.some((r) => r.kind === kind)) return label;
  return "评估";
}
export const workflowReviewer = (kind: string) =>
  ["order", "settlement", "invoice"].includes(kind) ? "finance" : "technical";
export async function overview(user: User, input: any) {
  const f = validFilters(input),
    today = new Date().toISOString().slice(0, 10);
  const settings = await db.managementSetting.findUnique({
    where: { id: "company" },
  });
  const threshold = settings?.stagnantDays ?? 14;
  const all = await db.record.findMany({
    where: {
      ...recordScope(user),
      archived: false,
      nature: f.nature,
      ...(f.businessLine ? { businessLine: f.businessLine } : {}),
    },
    include: {
      case: { include: { customer: true } },
      owner: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const caseGroups = new Map<string, typeof all>();
  for (const r of all) {
    if (r.caseId)
      caseGroups.set(r.caseId, [...(caseGroups.get(r.caseId) || []), r]);
  }
  const rows = all.filter(
    (r) =>
      (!f.customerId || r.case?.customerId === f.customerId) &&
      (!f.ownerId || r.ownerId === f.ownerId) &&
      (!f.from || r.createdAt.toISOString().slice(0, 10) >= f.from) &&
      (!f.to || r.createdAt.toISOString().slice(0, 10) <= f.to),
  );
  const safe = (r: (typeof all)[number]) => ({
    ...safeRecord(user, r),
    ownerName: r.owner.name,
    phase: r.caseId ? phase(caseGroups.get(r.caseId) || []) : "评估",
  });
  const rowMap = new Map(rows.map((r) => [r.id, r]));
  const workflows = await db.workflowItem.findMany({
    where: { recordId: { in: rows.map((r) => r.id) } },
  });
  const approvals = [
    ...rows
      .filter(
        (r) =>
          r.status === "submitted" &&
          (privileged(user) || reviewers[r.kind as Kind] === user.role),
      )
      .map((r) => ({
        id: r.id,
        type: "record",
        recordId: r.id,
        title: r.title,
        kind: r.kind,
        version: r.version,
        requester: r.owner.name,
        status: r.status,
      })),
    ...workflows
      .filter(
        (w) =>
          w.status === "submitted" &&
          (privileged(user) || workflowReviewer(w.kind) === user.role),
      )
      .map((w) => ({
        id: w.id,
        type: "workflow",
        recordId: w.recordId,
        title: w.title,
        kind: w.kind,
        version: w.version,
        requester: rowMap.get(w.recordId)?.owner.name || "未知",
        status: w.status,
      })),
  ];
  const tasks = rows
    .filter(
      (r) =>
        r.kind === "task" &&
        r.status !== "done" &&
        (privileged(user) || r.ownerId === user.id),
    )
    .map(safe);
  const riskMap = new Map<string, any>();
  const push = (
    key: string,
    r: (typeof all)[number],
    type: string,
    note: string,
  ) =>
    riskMap.set(key, {
      key,
      recordId: r.id,
      title: r.title,
      type,
      note,
      ownerName: r.owner.name,
      ownerId: r.ownerId,
      ...(r.case ? { customer: r.case.customer.name } : {}),
    });
  for (const r of rows) {
    const d = JSON.parse(r.data);
    if (f.nature === "history") continue;
    if (
      r.kind === "opportunity" &&
      !["lost"].includes(r.status) &&
      phase(caseGroups.get(r.caseId || "") || []) !== "已签"
    ) {
      if (!r.lastFollowUpAt)
        push("follow:" + r.id, r, "待跟进", "尚无有效跟进记录，请补充沟通纪要");
      else if (Date.now() - +r.lastFollowUpAt > threshold * 86400000)
        push(
          "follow:" + r.id,
          r,
          "停滞商机",
          "超过" + threshold + "天无有效跟进",
        );
    }
    if (
      d.dueDate &&
      d.dueDate < today &&
      ["milestone", "task", "project"].includes(r.kind) &&
      !["done", "confirmed"].includes(r.status)
    )
      push("delay:" + r.id, r, "交付/任务延期", "计划日期 " + d.dueDate);
    if (
      r.kind === "receivable" &&
      d.dueDate < today &&
      Number(d.amountCents) > Number(d.receivedCents || 0)
    )
      push(
        "receivable:" + r.id,
        r,
        "逾期回款",
        "未收余额 ¥" +
          ((d.amountCents - (d.receivedCents || 0)) / 100).toFixed(2),
      );
    if (r.kind === "sample" && r.status === "abnormal")
      push("sample:" + r.id, r, "样本异常", String(d.issue || "待处理"));
  }
  for (const w of workflows) {
    const d = JSON.parse(w.data);
    const r = rowMap.get(w.recordId)!;
    if (
      f.nature !== "history" &&
      w.kind === "quality" &&
      d.dueDate < today &&
      !["closed", "completed"].includes(w.status)
    )
      push("quality:" + w.id, r, "CAPA逾期", w.title + " · " + d.dueDate);
  }
  const priority: Record<string, number> = {
    逾期回款: 0,
    样本异常: 1,
    CAPA逾期: 2,
    "交付/任务延期": 3,
    停滞商机: 4,
    待跟进: 5,
  };
  const risks = [...riskMap.values()].sort(
    (a, b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9),
  );
  const handling = await db.riskHandling.findMany({
    where: { riskKey: { in: risks.map((r) => r.key) } },
    orderBy: { createdAt: "desc" },
  });
  risks.forEach(
    (r) => (r.handling = handling.filter((h) => h.riskKey === r.key)),
  );
  const sum = (
    kind: string,
    field: string,
    condition: (r: any) => boolean = () => true,
  ) =>
    rows
      .filter((r) => r.kind === kind && condition(r))
      .reduce((n, r) => n + Number(JSON.parse(r.data)[field] || 0), 0);
  const receivables = rows.filter((r) => r.kind === "receivable"),
    pending = receivables.reduce((n, r) => {
      const d = JSON.parse(r.data);
      return (
        n +
        Math.max(0, Number(d.amountCents || 0) - Number(d.receivedCents || 0))
      );
    }, 0);
  const overdue = receivables.reduce((n, r) => {
    const d = JSON.parse(r.data);
    return (
      n +
      (d.dueDate < today
        ? Math.max(0, Number(d.amountCents || 0) - Number(d.receivedCents || 0))
        : 0)
    );
  }, 0);
  const stageCounts = Object.fromEntries(
    ["评估", "拜访", "方案", "报价", "合同", "已签", "丢单"].map((s) => [
      s,
      rows.filter(
        (r) =>
          r.kind === "opportunity" &&
          phase(caseGroups.get(r.caseId || "") || []) === s,
      ).length,
    ]),
  );
  return {
    filters: f,
    threshold,
    dateBasis: "业务记录创建日期；预计签约金额不是实际签约收入",
    signedCents: sum("contract", "amountCents", (r) => r.status === "signed"),
    receivedCents: sum("receipt", "amountCents"),
    pendingCents: pending,
    overdueCents: overdue,
    opportunities: rows.filter(
      (r) =>
        r.kind === "opportunity" &&
        !["lost"].includes(r.status) &&
        phase(caseGroups.get(r.caseId || "") || []) !== "已签",
    ).length,
    projects: rows.filter((r) => r.kind === "project" && r.status === "active")
      .length,
    stageCounts,
    approvals,
    tasks,
    risks,
    rows: rows.map(safe),
    workflowTotals: Object.fromEntries(
      ["order", "settlement", "invoice"].map((k) => [
        k,
        workflows
          .filter((w) => w.kind === k && w.status === "approved")
          .reduce((n, w) => n + Number(JSON.parse(w.data).amountCents || 0), 0),
      ]),
    ),
  };
}
managementRouter.get(
  "/management",
  wrap(async (req: any, res: any) =>
    res.json(await overview(req.user, req.query)),
  ),
);
managementRouter.post(
  "/management/settings",
  wrap(async (req: any, res: any) => {
    if (!privileged(req.user)) fail("仅主管可调整规则", 403);
    const data = z
      .object({ stagnantDays: z.number().int().min(1).max(180) })
      .parse(req.body);
    res.json(
      await db.managementSetting.upsert({
        where: { id: "company" },
        create: { id: "company", ...data },
        update: data,
      }),
    );
  }),
);
managementRouter.get(
  "/management/assignees/:id",
  wrap(async (req: any, res: any) => {
    const r = await accessible(req.user, req.params.id);
    const users = await db.user.findMany({
      where: r.case
        ? {
            OR: [
              { role: { in: ["admin", "manager"] } },
              { id: r.case.customer.ownerId },
              { grants: { some: { customerId: r.case.customerId } } },
            ],
          }
        : { id: r.ownerId },
      select: { id: true, name: true, role: true },
    });
    res.json(users);
  }),
);
managementRouter.post(
  "/management/tasks/:id",
  wrap(async (req: any, res: any) => {
    const input = z
      .object({
        version: z.number().int(),
        action: z.enum(["assign", "postpone"]),
        assigneeId: z.string().optional(),
        dueDate: z.string().optional(),
        note: z.string().trim().min(1),
      })
      .parse(req.body);
    const result = await db.$transaction(async (tx) => {
      const r = await accessible(req.user, req.params.id, tx);
      if (
        r.kind !== "task" ||
        r.status === "done" ||
        r.archived ||
        r.nature === "history"
      )
        fail("当前任务不可调整", 409);
      if (!privileged(req.user) && r.ownerId !== req.user.id)
        fail("只能处理自己的任务", 403);
      if (r.version !== input.version) fail("版本冲突", 409);
      const data = JSON.parse(r.data);
      let ownerId = r.ownerId;
      if (input.action === "assign") {
        if (!privileged(req.user)) fail("仅主管可分派", 403);
        const target = await tx.user.findUnique({
          where: { id: input.assigneeId || "" },
        });
        if (!target) fail("负责人不存在");
        if (
          r.case &&
          !(await tx.customer.findFirst({
            where: { id: r.case.customerId, ...customerScope(target) },
          }))
        )
          fail("人员未获客户授权", 403);
        ownerId = target.id;
      } else {
        if (!input.dueDate) fail("延期日期不能为空");
        addDays(input.dueDate, 0, "calendar");
        if (data.dueDate && input.dueDate <= data.dueDate)
          fail("延期日期须晚于原到期日");
        data.dueDate = input.dueDate;
      }
      data.lastTaskNote = input.note;
      return safeRecord(
        req.user,
        await write(
          tx,
          req.user,
          r,
          { ownerId, data: JSON.stringify(data) },
          input.action,
          input.note,
        ),
      );
    });
    res.json(result);
  }),
);
managementRouter.post(
  "/management/risks",
  wrap(async (req: any, res: any) => {
    const input = z
      .object({
        key: z.string(),
        recordId: z.string(),
        assigneeId: z.string(),
        dueDate: z.string(),
        note: z.string().trim().min(1),
        nature: z.enum(["daily", "scenario"]).default("daily"),
      })
      .parse(req.body);
    if (!privileged(req.user)) fail("风险分派仅主管可用", 403);
    addDays(input.dueDate, 0, "calendar");
    const current = await overview(req.user, { nature: input.nature });
    if (
      !current.risks.some(
        (r) => r.key === input.key && r.recordId === input.recordId,
      )
    )
      fail("风险已不再存在，请刷新", 409);
    const r = await accessible(req.user, input.recordId);
    const target = await db.user.findUnique({
      where: { id: input.assigneeId },
    });
    if (
      !target ||
      (r.case &&
        !(await db.customer.findFirst({
          where: { id: r.case.customerId, ...customerScope(target) },
        })))
    )
      fail("处理人未获客户授权", 403);
    const result = await db.$transaction(async (tx) => {
      const h = await tx.riskHandling.create({
        data: {
          riskKey: input.key,
          recordId: r.id,
          actorId: req.user.id,
          assigneeId: target.id,
          dueDate: input.dueDate,
          note: input.note,
        },
      });
      await audit(tx, req.user, r.id, "risk-handle", input.note);
      return h;
    });
    res.json(result);
  }),
);
managementRouter.post(
  "/management/reports",
  wrap(async (req: any, res: any) => {
    if (!privileged(req.user)) fail("经营周报由负责人生成", 403);
    const d = await overview(req.user, req.body);
    const yuan = (x: number) => (x / 100).toFixed(2);
    const text = [
      "业务周报 · " + new Date().toISOString().slice(0, 10),
      "数据范围：" +
        d.filters.nature +
        " / " +
        (d.filters.businessLine || "PB+SR") +
        "；创建日期 " +
        (d.filters.from || "不限") +
        " 至 " +
        (d.filters.to || "不限"),
      "签约金额 " +
        yuan(d.signedCents) +
        " 元；已收款 " +
        yuan(d.receivedCents) +
        " 元；待回款 " +
        yuan(d.pendingCents) +
        " 元；逾期 " +
        yuan(d.overdueCents) +
        " 元。",
      "待审核 " +
        d.approvals.length +
        " 项；待办 " +
        d.tasks.length +
        " 项；风险 " +
        d.risks.length +
        " 项。",
      "本周进展",
      ...d.rows
        .filter(
          (r) => new Date(r.updatedAt).getTime() > Date.now() - 7 * 86400000,
        )
        .map((r) => r.title + "：" + r.status + "（" + r.id + "）"),
      "待决事项与风险",
      ...d.risks.map(
        (r) =>
          r.title + "：" + r.type + "，" + r.note + "（" + r.recordId + "）",
      ),
      "下周行动",
      ...d.tasks.map(
        (r) =>
          r.title +
          "；负责人 " +
          r.ownerName +
          "；截止 " +
          (r.data.dueDate || "缺失") +
          "（" +
          r.id +
          "）",
      ),
      "负责人补充：待填写。",
    ].join("\n");
    res.json(
      await db.weeklyReport.create({
        data: {
          ownerId: req.user.id,
          title: "业务周报",
          filters: JSON.stringify(d.filters),
          content: text,
        },
      }),
    );
  }),
);
managementRouter.get(
  "/management/reports",
  wrap(async (req: any, res: any) => {
    if (!privileged(req.user)) fail("无经营报告权限", 403);
    res.json(
      await db.weeklyReport.findMany({
        where: { ownerId: req.user.id },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    );
  }),
);
managementRouter.patch(
  "/management/reports/:id",
  wrap(async (req: any, res: any) => {
    const p = z
      .object({ version: z.number().int(), content: z.string().max(100000) })
      .parse(req.body);
    const n = await db.weeklyReport.updateMany({
      where: { id: req.params.id, ownerId: req.user.id, version: p.version },
      data: { content: p.content, version: { increment: 1 } },
    });
    if (!n.count) fail("报告无权限或版本冲突", 409);
    res.json({ ok: true });
  }),
);
managementRouter.get(
  "/management/reports/:id/export",
  wrap(async (req: any, res: any) => {
    const r = await db.weeklyReport.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });
    if (!r || !privileged(req.user)) fail("无报告访问权限", 403);
    const doc = new Document({
      sections: [
        {
          children: r.content
            .split("\n")
            .map(
              (text) =>
                new Paragraph({
                  children: [new TextRun({ text, font: "Microsoft YaHei" })],
                }),
            ),
        },
      ],
    });
    res.attachment("BD-weekly.docx").send(await Packer.toBuffer(doc));
  }),
);
managementRouter.get(
  "/random-runs",
  wrap(async (req: any, res: any) => {
    if (!privileged(req.user)) fail("仅负责人可查看验收批次", 403);
    res.json(
      await db.randomRun.findMany({
        orderBy: [{ createdAt: "desc" }, { index: "asc" }],
      }),
    );
  }),
);
managementRouter.post('/random-runs/reset',wrap(async(req:any,res:any)=>{const p=z.object({batch:z.string(),confirmation:z.string()}).parse(req.body);res.json(await resetRandomBatch(req.user,p.batch,p.confirmation));}));
