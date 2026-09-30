import { Prisma, Record as DbRecord, User } from "@prisma/client";
import { db } from "./db";
import {
  Kind,
  Role,
  fields,
  reviewers,
  validateData,
  quoteTotals,
} from "../shared/domain";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(message: string, status = 400): never {
  throw new HttpError(status, message);
}
export const privileged = (u: User) => ["admin", "manager"].includes(u.role);
export const canCost = (u: User) =>
  ["admin", "manager", "finance"].includes(u.role);
export function customerScope(u: User): Prisma.CustomerWhereInput {
  return privileged(u)
    ? {}
    : { OR: [{ ownerId: u.id }, { grants: { some: { userId: u.id } } }] };
}
export function recordScope(u: User): Prisma.RecordWhereInput {
  return privileged(u)
    ? {}
    : {
        OR: [
          { case: { customer: customerScope(u) } },
          { caseId: null, ownerId: u.id },
          { kind: "capability" },
        ],
      };
}
export const includeCase = { case: { include: { customer: true } } } as const;
export async function accessible(
  u: User,
  id: string,
  tx: Prisma.TransactionClient = db,
) {
  const r = await tx.record.findFirst({
    where: { id, ...recordScope(u) },
    include: includeCase,
  });
  return r || fail("记录不存在或无权访问", 404);
}
export function safeRecord(u: User, r: DbRecord) {
  const data = JSON.parse(r.data);
  if (!canCost(u) && data.lineItems) {
    data.lineItems = JSON.stringify(
      JSON.parse(data.lineItems).map((i: any) => {
        const { cost, ...rest } = i;
        return rest;
      }),
    );
  }
  if (!canCost(u))
    for (const k of [
      "unitCost",
      "centerCost",
      "riskCost",
      "costCents",
      "margin",
    ])
      delete data[k];
  return { ...r, data };
}
export function writer(u: User, kind: Kind) {
  const permitted: Partial<Record<Kind, string[]>> = {
    quote: ["bd", "finance"],
    contract: ["bd", "legal"],
    project: ["delivery"],
    sample: ["delivery"],
    milestone: ["delivery"],
    receivable: ["finance"],
    receipt: ["finance"],
    capability: ["technical"],
    study: ["bd", "technical"],
    proposal: ["bd", "technical"],
    knowledge: ["bd", "technical", "delivery", "legal", "finance"],
    review: ["bd", "delivery"],
    task: ["bd", "technical", "delivery", "legal", "finance"],
  };
  if (!privileged(u) && !(permitted[kind] || ["bd"]).includes(u.role))
    fail("当前角色不能执行此操作", 403);
}
export function editable(r: DbRecord) {
  if (r.nature === "history")
    fail("历史档案请在来源核对中修订证据，不覆盖原始事实", 409);
  if (r.archived) fail("已归档记录不可修改", 409);
  if (
    ![
      "draft",
      "rejected",
      "follow",
      "watch",
      "active",
      "abnormal",
      "normal",
    ].includes(r.status)
  )
    fail("当前状态不可编辑，请创建修订版", 409);
}
export async function audit(
  tx: Prisma.TransactionClient,
  u: User,
  id: string,
  action: string,
  detail: string,
) {
  await tx.auditLog.create({
    data: { actorId: u.id, entityId: id, action, detail },
  });
}
export async function write(
  tx: Prisma.TransactionClient,
  u: User,
  r: DbRecord,
  patch: Prisma.RecordUncheckedUpdateManyInput,
  action: string,
  comment = "",
) {
  const updated = await tx.record.updateMany({
    where: { id: r.id, version: r.version },
    data: { ...patch, version: { increment: 1 } },
  });
  if (!updated.count) fail("记录已被他人更新，请重新加载", 409);
  await tx.revision.create({
    data: {
      recordId: r.id,
      version: r.version,
      snapshot: JSON.stringify({
        title: r.title,
        status: r.status,
        data: JSON.parse(r.data),
      }),
      actorId: u.id,
      action,
      comment,
    },
  });
  await audit(tx, u, r.id, action, comment);
  return tx.record.findUniqueOrThrow({
    where: { id: r.id },
    include: includeCase,
  });
}
export function cleanData(
  u: User,
  kind: Kind,
  input: Record<string, unknown>,
  old: Record<string, unknown> = {},
) {
  const allowed = fields[kind].map((f) => f.key);
  const data = { ...old };
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) continue;
    if (!canCost(u) && ["unitCost", "centerCost", "riskCost"].includes(key))
      fail("无权修改成本", 403);
    data[key] = value;
    if (key === "lineItems" && !canCost(u) && value) {
      const parsed = JSON.parse(String(value));
      if (
        !Array.isArray(parsed) ||
        parsed.some((i: any) => i.cost !== undefined)
      )
        fail("多明细成本仅财务可填", 403);
      const previous = old.lineItems ? JSON.parse(String(old.lineItems)) : [];
      data[key] = JSON.stringify(
        parsed.map((item: any, i: number) =>
          previous[i]?.name === item.name && previous[i]?.unit === item.unit
            ? {
                ...item,
                ...(previous[i].cost !== undefined
                  ? { cost: previous[i].cost }
                  : {}),
              }
            : item,
        ),
      );
    }
  }
  validateData(kind, data);
  if (kind === "quote") Object.assign(data, quoteTotals(data));
  if (kind === "receivable")
    data.amountCents = Math.round(Number(data.amount) * 100);
  return data;
}
const parentRules: Partial<Record<Kind, { kind: Kind; status?: string[] }>> = {
  quote: { kind: "proposal", status: ["approved"] },
  contract: { kind: "quote", status: ["approved"] },
  project: { kind: "contract", status: ["signed"] },
  sample: { kind: "project", status: ["active"] },
  milestone: { kind: "project", status: ["active"] },
  receivable: { kind: "project", status: ["active", "done"] },
  review: { kind: "project", status: ["done"] },
};
export async function createRecord(
  u: User,
  input: {
    kind: Kind;
    title: string;
    caseId?: string;
    parentId?: string;
    data: Record<string, unknown>;
  },
) {
  writer(u, input.kind);
  if (["receipt", "opportunity"].includes(input.kind))
    fail("请从关联业务执行转换或到账操作");
  return db.$transaction(async (tx) => {
    const context = input.caseId
      ? await tx.businessCase.findUniqueOrThrow({ where: { id: input.caseId } })
      : null;
    if (context?.nature === "history")
      fail("历史档案不可伪造正常审批，请创建独立演练副本");
    if (input.caseId) {
      const c = await tx.businessCase.findFirst({
        where: { id: input.caseId, customer: customerScope(u) },
      });
      if (!c) fail("无权访问商机", 403);
    }
    if (
      !input.caseId &&
      !["lead", "knowledge", "capability"].includes(input.kind)
    )
      fail("请选择关联商机");
    let parent: DbRecord | null = null;
    if (input.parentId) {
      parent = await accessible(u, input.parentId, tx);
      if (parent.caseId !== input.caseId || parent.archived)
        fail("关联记录不属于该商机或已归档");
    }
    const rule = parentRules[input.kind];
    if (
      rule &&
      (!parent ||
        parent.kind !== rule.kind ||
        (rule.status && !rule.status.includes(parent.status)))
    )
      fail("请关联满足前置状态的业务记录");
    if (
      ["project","contract"].includes(input.kind) &&
      (await tx.record.count({
        where: { kind: input.kind, parentId: input.parentId, archived: false },
      }))
    )
      fail("该前置记录已创建关联合同或项目", 409);
    const data = cleanData(u, input.kind, input.data);
    if (input.kind === "lead" && !String(data.company || "").trim())
      fail("客户公司不能为空");
    if (
      input.kind === "sample" &&
      (await tx.record.findFirst({
        where: {
          kind: "sample",
          caseId: input.caseId,
          data: { contains: JSON.stringify(String(data.code)) },
          archived: false,
        },
      }))
    )
      fail("该商机中的样本编号已存在", 409);
    if (parent && input.kind === "contract")
      data.amountCents = JSON.parse(parent.data).amountCents;
    if (input.kind === "contract" && data.contractType === "framework")
      data.amountCents = null;
    if (parent && input.kind === "project")
      data.amountCents = JSON.parse(parent.data).amountCents;
    if (input.kind === "receivable" && parent) {
      if (JSON.parse(parent.data).amountCents === null)
        fail("框架合同请通过订单结算单生成应收");
      const plans = await tx.record.findMany({
        where: { kind: "receivable", parentId: parent.id },
      });
      if (
        plans.reduce((s, r) => s + JSON.parse(r.data).amountCents, 0) +
          Number(data.amountCents) >
        JSON.parse(parent.data).amountCents
      )
        fail("应收计划总额不能超过合同金额");
    }
    const r = await tx.record.create({
      data: {
        kind: input.kind,
        nature: context?.nature || "daily",
        businessLine: context?.businessLine || "PB",
        title: input.title,
        caseId: input.caseId,
        parentId: input.parentId,
        ownerId: u.id,
        status: input.kind === "project" ? "active" : "draft",
        data: JSON.stringify(data),
      },
      include: includeCase,
    });
    await audit(tx, u, r.id, "create", input.title);
    return safeRecord(u, r);
  });
}
export async function action(
  u: User,
  id: string,
  input: {
    action: string;
    version: number;
    comment?: string;
    amount?: number;
    reference?: string;
    userId?: string;
  },
) {
  return db.$transaction(async (tx) => {
    const r = await accessible(u, id, tx);
    if (r.nature === "history")
      fail("历史记录保留来源状态，不执行模拟审批", 409);
    if (r.version !== input.version) fail("版本冲突，请重新加载", 409);
    if (r.archived) fail("记录已归档", 409);
    const kind = r.kind as Kind,
      data = JSON.parse(r.data);
    const a = input.action,
      comment = input.comment?.trim() || "";
    let status = r.status;
    let newCaseId = r.caseId;
    let ownerId = r.ownerId;
    if (["approve", "reject"].includes(a)) {
      if (!reviewers[kind] || (!privileged(u) && u.role !== reviewers[kind]))
        fail("无审核权限", 403);
      if (r.status !== "submitted") fail("仅可审核已提交记录", 409);
      if (a === "reject" && !comment) fail("退回必须填写原因");
      validateData(kind, data, true);
      status = a === "approve" ? "approved" : "rejected";
    } else if (a === "receive") {
      if (kind !== "receivable" || !canCost(u))
        fail("仅财务可确认应收到账", 403);
      const cents = Math.round(Number(input.amount) * 100);
      if (!Number.isSafeInteger(cents) || cents <= 0)
        fail("到账金额必须大于零");
      if (!input.reference?.trim()) fail("请填写银行流水号");
      if (
        await tx.record.findFirst({
          where: {
            kind: "receipt",
            parentId: r.id,
            data: { contains: JSON.stringify(input.reference.trim()) },
          },
        })
      )
        fail("此银行流水号已登记", 409);
      const received = Number(data.receivedCents || 0);
      if (received + cents > data.amountCents) fail("到账金额超过未收余额");
      await tx.record.create({
        data: {
          kind: "receipt",
          nature: r.nature,
          businessLine: r.businessLine,
          title: `到账：${r.title}`,
          ownerId: u.id,
          caseId: r.caseId,
          parentId: r.id,
          status: "confirmed",
          data: JSON.stringify({
            amountCents: cents,
            reference: input.reference.trim(),
          }),
        },
      });
      data.receivedCents = received + cents;
      status = data.receivedCents === data.amountCents ? "paid" : "partial";
    } else {
      writer(u, kind);
      if (a === "submit") {
        if (!reviewers[kind] || !["draft", "rejected"].includes(status))
          fail("当前记录不能提交", 409);
        validateData(kind, data, true);
        status = "submitted";
      } else if (a === "convert") {
        if (kind !== "lead" || status !== "draft")
          fail("该线索已转换或不可转换", 409);
        if (!newCaseId) {
          const name = String(data.company).trim();
          let customer = await tx.customer.findUnique({ where: { name } });
          if (
            customer &&
            !(await tx.customer.findFirst({
              where: { id: customer.id, ...customerScope(u) },
            }))
          )
            fail("该客户已存在，请联系主管分配", 409);
          if (!customer)
            customer = await tx.customer.create({
              data: {
                name,
                ownerId: r.ownerId,
                source: String(data.source || "manual"),
              },
            });
          newCaseId = (
            await tx.businessCase.create({
              data: {
                customerId: customer.id,
                title: r.title,
                nature: r.nature,
                businessLine: r.businessLine,
              },
            })
          ).id;
        }
        await tx.record.create({
          data: {
            kind: "opportunity",
            nature: r.nature,
            businessLine: r.businessLine,
            title: r.title,
            caseId: newCaseId,
            parentId: r.id,
            ownerId: r.ownerId,
            data: JSON.stringify({
              test: data.target || "待确认",
              notes: data.notes || "",
            }),
          },
        });
        status = "converted";
      } else if (["follow", "watch", "lost"].includes(a)) {
        if (
          kind !== "opportunity" ||
          !["draft", "follow", "watch"].includes(status)
        )
          fail("当前商机不能评估", 409);
        if (!comment) fail("请填写评估依据");
        data.evaluation = comment;
        status = a;
      } else if (a === "confirm") {
        if (kind !== "visit" || status !== "draft")
          fail("纪要已确认或不可确认", 409);
        validateData(kind, data, true);
        await tx.record.create({
          data: {
            kind: "task",
            nature: r.nature,
            businessLine: r.businessLine,
            title: data.nextAction,
            caseId: r.caseId,
            parentId: r.id,
            ownerId: r.ownerId,
            data: JSON.stringify({
              dueDate: data.dueDate,
              notes: "由拜访纪要确认生成",
            }),
          },
        });
        status = "confirmed";
        if(r.caseId)await tx.record.updateMany({where:{caseId:r.caseId,kind:'opportunity'},data:{lastFollowUpAt:new Date(),version:{increment:1}}});
      } else if(a==='followup'){
        if(kind!=='opportunity'||status==='lost'||!comment)fail('请填写有效商机跟进纪要');
        data.nextAction=comment;
        return safeRecord(u,await write(tx,u,r,{lastFollowUpAt:new Date(),data:JSON.stringify(data)},a,comment));
      } else if (a === "sign") {
        if (kind !== "contract" || status !== "approved")
          fail("合同必须先通过法务审核", 409);
        // Signer/date are collected as a comment JSON to keep ordinary editing locked.
        let signed: { signer: string; signedDate: string };
        try {
          signed = JSON.parse(comment);
        } catch {
          fail("请填写签署人和日期");
        }
        if (!signed!.signer?.trim() || !signed!.signedDate)
          fail("签署人和签署日期不能为空");
        validateData("contract", { ...data, ...signed! }, true);
        Object.assign(data, signed!);
        status = "signed";
      } else if (a === "done") {
        if(kind==='task'&&!privileged(u)&&r.ownerId!==u.id)fail('只能完成分派给自己的任务',403);
        if (
          !["task", "milestone", "project", "sample"].includes(kind) ||
          !["draft", "active", "normal", "abnormal"].includes(status)
        )
          fail("当前记录不可完成", 409);
        if (kind === "sample" && status === "abnormal" && !comment)
          fail("请填写异常解决说明");
        if (kind === "project") {
          const unfinished = await tx.workflowItem.count({
            where: {
              recordId: r.id,
              kind: { in: ["deliverable", "quality"] },
              status: { notIn: ["completed", "closed"] },
            },
          });
          if (unfinished) fail("请先完成交付包和稽查整改验收");
          const children = await tx.record.findMany({
            where: {
              parentId: r.id,
              kind: { in: ["milestone", "sample"] },
              archived: false,
            },
          });
          if (!children.length || children.some((c) => c.status !== "done"))
            fail("请先完成全部样本和里程碑验收");
        }
        status = "done";
      } else if (a === "abnormal") {
        if (kind !== "sample" || status === "done" || !comment)
          fail("请填写样本异常原因");
        data.issue = comment;
        status = "abnormal";
      } else if (a === "publish") {
        if (!["knowledge", "review"].includes(kind) || status !== "approved")
          fail("发布前须通过主管审核");
        data.sanitized = true;
        status = "published";
      } else if (a === "favorite") {
        if (kind !== "lead") fail("仅支持线索收藏");
        data.favorite = !data.favorite;
      } else if (a === "assign") {
        if (!privileged(u)) fail("仅主管可分派", 403);
        const target = await tx.user.findUnique({
          where: { id: input.userId || "" },
        });
        if (!target) fail("负责人不存在");
        ownerId = target.id;
        if (r.caseId) {
          const c = await tx.businessCase.findUniqueOrThrow({
            where: { id: r.caseId },
          });
          if(!await tx.customer.findFirst({where:{id:c.customerId,...customerScope(target)}}))fail('负责人未获该客户授权，请先在客户档案授权',403);
        }
      } else if (a === "archive") {
        if (
          ["receivable", "receipt"].includes(kind) ||
          !["draft", "rejected", "done", "lost", "published"].includes(status)
        )
          fail("财务或流转中记录不可归档");
        if (
          await tx.record.count({ where: { parentId: r.id, archived: false } })
        )
          fail("有关联业务，不能归档");
        return safeRecord(
          u,
          await write(tx, u, r, { archived: true }, a, comment),
        );
      } else if (a === "revise") {
        if (
          !["proposal", "study", "quote"].includes(kind) ||
          !["approved", "rejected"].includes(status)
        )
          fail("当前记录不能创建修订版");
        const copy = await tx.record.create({
          data: {
            nature: r.nature,
            businessLine: r.businessLine,
            kind,
            title: `${r.title} · 修订`,
            caseId: r.caseId,
            parentId: r.parentId,
            ownerId: u.id,
            data: r.data,
          },
        });
        await audit(tx, u, r.id, "revise", copy.id);
        return safeRecord(u, copy);
      } else if (a === "comment") {
        if (!comment) fail("评论不能为空");
      } else fail("不支持的业务操作");
    }
    return safeRecord(
      u,
      await write(
        tx,
        u,
        r,
        { status, data: JSON.stringify(data), caseId: newCaseId, ownerId },
        a,
        comment,
      ),
    );
  });
}
