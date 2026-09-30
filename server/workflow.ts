import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import {
  accessible,
  audit,
  canCost,
  fail,
  privileged,
  recordScope,
} from "./service";
import { extensionKinds, priceItems, addDays } from "../shared/extensions";
export const workflowRouter = Router();
const wrap = (f: any) => (req: any, res: any, next: any) =>
  Promise.resolve(f(req, res)).catch(next);
function permitted(user: any, kind: string) {
  if (privileged(user)) return;
  if (
    !(
      kind === "deliverable"
        ? ["technical", "delivery"]
        : kind === "quality"
          ? ["technical", "delivery"]
          : kind === "order"
            ? ["bd", "finance"]
            : ["finance"]
    ).includes(user.role)
  )
    fail("当前角色无此业务权限", 403);
}
function sanitized(item: any, user: any) {
  const data = JSON.parse(item.data);
  if (!canCost(user)) {
    delete data.cost;
    data.items = data.items?.map((x: any) => {
      const { cost, ...rest } = x;
      return rest;
    });
  }
  return { ...item, data };
}
workflowRouter.get(
  "/workflow",
  wrap(async (req: any, res: any) => {
    const id = z.string().parse(req.query.recordId);
    await accessible(req.user, id);
    res.json(
      (
        await db.workflowItem.findMany({
          where: { recordId: id },
          orderBy: { createdAt: "desc" },
        })
      ).map((x) => sanitized(x, req.user)),
    );
  }),
);
workflowRouter.post(
  "/workflow",
  wrap(async (req: any, res: any) => {
    const input = z
      .object({
        recordId: z.string(),
        kind: z.enum(extensionKinds),
        title: z.string().trim().min(1),
        data: z.record(z.unknown()),
      })
      .parse(req.body);
    permitted(req.user, input.kind);
    const r = await accessible(req.user, input.recordId);
    if (r.nature === "history") fail("历史资料不可生成模拟流转");
    if (r.kind !== "project" && r.kind !== "contract")
      fail("请在合同或项目下创建扩展业务");
    if (!["signed", "active", "done"].includes(r.status))
      fail("需要已签合同或可交付项目");
    const data = input.data;
    if (input.kind === "order") {
      Object.assign(data, priceItems(data.items));
      if (
        !canCost(req.user) &&
        (data.items as any[]).some((i) => i.cost !== undefined)
      )
        fail("成本仅财务可填", 403);
    }
    if (["settlement", "invoice"].includes(input.kind) && !canCost(req.user))
      fail("仅财务可创建结算发票", 403);
    const item = await db.$transaction(async (tx) => {
      if (input.kind === "settlement") {
        const ids = z.array(z.string()).min(1).parse(data.orderIds);
        if (new Set(ids).size !== ids.length) fail("重复订单");
        const orders = await tx.workflowItem.findMany({
          where: {
            id: { in: ids },
            recordId: r.id,
            kind: "order",
            status: "approved",
          },
        });
        if (orders.length !== ids.length) fail("只能结算本项目已审批订单");
        const previous = await tx.workflowItem.findMany({
          where: { recordId: r.id, kind: "settlement" },
        });
        if (
          previous.some((p) =>
            (JSON.parse(p.data).orderIds || []).some((id: string) =>
              ids.includes(id),
            ),
          )
        )
          fail("订单已经被结算单引用", 409);
        data.amountCents = orders.reduce(
          (s, o) => s + JSON.parse(o.data).amountCents,
          0,
        );
      }
      if (input.kind === "invoice") {
        const s = await tx.workflowItem.findFirst({
          where: {
            id: String(data.settlementId),
            kind: "settlement",
            recordId: r.id,
            status: "approved",
          },
        });
        if (!s) fail("需要已审批结算单");
        if (!String(data.number || "").trim()) fail("发票号码不能为空");
        const amountCents = Math.round(Number(data.amount) * 100);
        if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
          fail("发票金额无效");
        const invoices = await tx.workflowItem.findMany({
          where: { recordId: r.id, kind: "invoice" },
        });
        if (invoices.some((i) => JSON.parse(i.data).number === data.number))
          fail("发票号重复");
        const billed = invoices
          .filter((i) => JSON.parse(i.data).settlementId === s.id)
          .reduce((sum, i) => sum + JSON.parse(i.data).amountCents, 0);
        if (billed + amountCents > JSON.parse(s.data).amountCents)
          fail("开票金额超过结算金额");
        data.amountCents = amountCents;
      }
      const item = await tx.workflowItem.create({
        data: {
          kind: input.kind,
          title: input.title,
          recordId: r.id,
          data: JSON.stringify(data),
        },
      });
      await audit(tx, req.user, item.id, "workflow-create", input.kind);
      return item;
    });
    res.status(201).json(sanitized(item, req.user));
  }),
);
workflowRouter.post(
  "/workflow/:id/actions",
  wrap(async (req: any, res: any) => {
    const input = z
      .object({
        action: z.enum([
          "submit",
          "approve",
          "reject",
          "complete",
          "close",
          "receivable",
        ]),
        version: z.number().int(),
        comment: z.string().default(""),
        dueDate: z.string().optional(),
      })
      .parse(req.body);
    const result = await db.$transaction(async (tx) => {
      const item = await tx.workflowItem.findUniqueOrThrow({
        where: { id: req.params.id },
      });
      const r = await accessible(req.user, item.recordId, tx);
      permitted(req.user, item.kind);
      if (item.version !== input.version) fail("版本冲突", 409);
      const data = JSON.parse(item.data);
      let status = item.status;
      if (input.action === "submit") {
        if (!["draft", "rejected"].includes(status)) fail("不可提交");
        status = "submitted";
      } else if (input.action === "approve" || input.action === "reject") {
        if (status !== "submitted") fail("请先提交审核");
        const role = ["order", "settlement", "invoice"].includes(item.kind)
          ? "finance"
          : "technical";
        if (!privileged(req.user) && req.user.role !== role)
          fail("无审批权限", 403);
        if (input.action === "reject" && !input.comment.trim())
          fail("退回须说明原因");
        status = input.action === "approve" ? "approved" : "rejected";
      } else if (input.action === "receivable") {
        if (
          item.kind !== "settlement" ||
          status !== "approved" ||
          !canCost(req.user)
        )
          fail("仅财务可将通过的结算生成应收", 403);
        if (data.receivableId) fail("应收已生成", 409);
        if (!input.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate))
          fail("请填写到期日期");
        const ar = await tx.record.create({
          data: {
            kind: "receivable",
            title: "结算应收：" + item.title,
            caseId: r.caseId,
            parentId: r.id,
            ownerId: req.user.id,
            nature: r.nature,
            businessLine: r.businessLine,
            data: JSON.stringify({
              amountCents: data.amountCents,
              amount: data.amountCents / 100,
              dueDate: input.dueDate,
              settlementId: item.id,
              notes: "由已批准结算单生成",
            }),
          },
        });
        data.receivableId = ar.id;
      } else {
        if (
          status !== "approved" ||
          !["deliverable", "quality"].includes(item.kind)
        )
          fail("须先通过审核");
        if (!input.comment.trim())
          fail("验收或整改关闭必须填写证据 / 复核结论");
        if (
          item.kind === "quality" &&
          !privileged(req.user) &&
          req.user.role !== "technical"
        )
          fail("整改须技术复核", 403);
        status = input.action === "close" ? "closed" : "completed";
        data.conclusion = input.comment;
      }
      const count = await tx.workflowItem.updateMany({
        where: { id: item.id, version: input.version },
        data: {
          status,
          version: { increment: 1 },
          data: JSON.stringify({
            ...data,
            history: [
              ...(data.history || []),
              {
                action: input.action,
                comment: input.comment,
                actor: req.user.id,
                at: new Date().toISOString(),
              },
            ],
          }),
        },
      });
      if (!count.count) fail("版本冲突", 409);
      await audit(tx, req.user, item.id, input.action, input.comment);
      return tx.workflowItem.findUniqueOrThrow({ where: { id: item.id } });
    });
    res.json(sanitized(result, req.user));
  }),
);
workflowRouter.patch(
  "/workflow/:id",
  wrap(async (req: any, res: any) => {
    const input = z
      .object({
        version: z.number().int(),
        title: z.string().trim().min(1),
        data: z.record(z.unknown()),
      })
      .parse(req.body);
    const result = await db.$transaction(async (tx) => {
      const item = await tx.workflowItem.findUniqueOrThrow({
        where: { id: req.params.id },
      });
      await accessible(req.user, item.recordId, tx);
      permitted(req.user, item.kind);
      if (!["draft", "rejected"].includes(item.status))
        fail("仅草稿或退回记录可修订", 409);
      if (!["deliverable", "quality"].includes(item.kind))
        fail("财务明细请在提交前核对，不支持覆盖已有结算依据");
      const previous = JSON.parse(item.data);
      const data = z
        .object({
          type: z.string(),
          responsible: z.string(),
          dueDate: z.string(),
          requirements: z.string(),
        })
        .partial()
        .parse(input.data);
      const changed = await tx.workflowItem.updateMany({
        where: { id: item.id, version: input.version },
        data: {
          title: input.title,
          version: { increment: 1 },
          data: JSON.stringify({
            ...previous,
            ...data,
            revisions: [
              ...(previous.revisions || []),
              {
                version: item.version,
                title: item.title,
                type: previous.type,
                responsible: previous.responsible,
                dueDate: previous.dueDate,
                requirements: previous.requirements,
                at: new Date().toISOString(),
              },
            ],
          }),
        },
      });
      if (!changed.count) fail("版本冲突", 409);
      await audit(tx, req.user, item.id, "workflow-edit", "交付/整改内容修订");
      return tx.workflowItem.findUniqueOrThrow({ where: { id: item.id } });
    });
    res.json(sanitized(result, req.user));
  }),
);
for (const [route, kind] of Object.entries({
  deliverables: "deliverable",
  "quality-actions": "quality",
  orders: "order",
  settlements: "settlement",
  invoices: "invoice",
})) {
  workflowRouter.get(
    "/" + route,
    wrap(async (req: any, res: any) => {
      const records = await db.record.findMany({
        where: recordScope(req.user),
        select: { id: true },
      });
      res.json(
        (
          await db.workflowItem.findMany({
            where: { kind, recordId: { in: records.map((r) => r.id) } },
          })
        ).map((x) => sanitized(x, req.user)),
      );
    }),
  );
}
workflowRouter.get(
  "/calendar",
  wrap(async (req: any, res: any) =>
    res.json(await db.calendarDay.findMany({ orderBy: { date: "asc" } })),
  ),
);
workflowRouter.post(
  "/calendar",
  wrap(async (req: any, res: any) => {
    if (!privileged(req.user)) fail("仅主管可维护日历", 403);
    const input = z
      .object({ date: z.string(), working: z.boolean(), note: z.string() })
      .parse(req.body);
    addDays(input.date, 0, "calendar");
    res.json(
      await db.calendarDay.upsert({
        where: { date: input.date },
        create: input,
        update: input,
      }),
    );
  }),
);
workflowRouter.post(
  "/calendar/calculate",
  wrap(async (req: any, res: any) => {
    const p = z
      .object({
        start: z.string(),
        days: z.number().int(),
        type: z.enum(["calendar", "working"]),
      })
      .parse(req.body);
    const c = await db.calendarDay.findMany();
    res.json({
      dueDate: addDays(p.start, p.days, p.type, c),
      basis: "起始日次日起计数；工作日为周一至周五，加已配置日历例外",
      exceptions: c.length,
    });
  }),
);
