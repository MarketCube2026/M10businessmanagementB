import { z } from "zod";
import { priceItems } from "./extensions";
export const roles = [
  "admin",
  "bd",
  "manager",
  "technical",
  "delivery",
  "finance",
  "legal",
] as const;
export type Role = (typeof roles)[number];
export const roleNames: Record<Role, string> = {
  admin: "管理员",
  bd: "BD",
  manager: "主管",
  technical: "技术",
  delivery: "交付",
  finance: "财务",
  legal: "法务",
};
export const kinds = [
  "lead",
  "opportunity",
  "visit",
  "proposal",
  "study",
  "quote",
  "contract",
  "project",
  "sample",
  "milestone",
  "receivable",
  "receipt",
  "maintenance",
  "knowledge",
  "review",
  "task",
  "contact",
  "capability",
] as const;
export type Kind = (typeof kinds)[number];
export const labels: Record<Kind, string> = {
  lead: "线索",
  opportunity: "机会评估",
  visit: "客户拜访",
  proposal: "商业提案",
  study: "研究设计",
  quote: "成本报价",
  contract: "合同",
  project: "交付项目",
  sample: "样本",
  milestone: "里程碑",
  receivable: "应收计划",
  receipt: "到账记录",
  maintenance: "客户维护",
  knowledge: "知识文档",
  review: "项目复盘",
  task: "行动项",
  contact: "联系人",
  capability: "检测能力",
};
export const statuses: Record<string, string> = {
  historical: "历史资料状态",
  draft: "草稿",
  submitted: "待审核",
  approved: "审核通过",
  rejected: "已退回",
  converted: "已转商机",
  follow: "跟进",
  watch: "观望",
  lost: "放弃",
  confirmed: "已确认",
  signed: "已签署",
  active: "进行中",
  done: "已完成",
  paid: "已结清",
  partial: "部分到账",
  normal: "正常",
  abnormal: "异常",
  published: "已发布",
};
export const reviewers: Partial<Record<Kind, Role>> = {
  proposal: "technical",
  study: "technical",
  quote: "finance",
  contract: "legal",
  knowledge: "manager",
  review: "manager",
};
export type Field = {
  key: string;
  label: string;
  type?: "number" | "date" | "textarea" | "select";
  options?: string[];
  required?: boolean;
};
const note: Field = { key: "notes", label: "说明 / 正文", type: "textarea" };
const due: Field = {
  key: "dueDate",
  label: "计划日期",
  type: "date",
  required: true,
};
export const fields: Record<Kind, Field[]> = {
  lead: [
    { key: "company", label: "客户公司", required: true },
    { key: "target", label: "靶点 / 瘤种" },
    { key: "source", label: "信息来源" },
    note,
  ],
  opportunity: [
    {key:'expectedAmount',label:'预计金额（元，非签约收入）',type:'number'},
    {key:'expectedCloseDate',label:'预计签约日',type:'date'},
    {key:'priority',label:'优先级',type:'select',options:['高','中','低']},
    {key:'nextAction',label:'下一步动作'},
    { key: "test", label: "检测项目", required: true },
    { key: "sampleType", label: "样本类型" },
    { key: "region", label: "中心地区" },
    note,
  ],
  visit: [
    { key: "contact", label: "联系人", required: true },
    due,
    {
      key: "notes",
      label: "SPIN 纪要 / 原始记录",
      type: "textarea",
      required: true,
    },
    { key: "nextAction", label: "下一步行动", required: true },
  ],
  proposal: [
    { key: "test", label: "检测项目", required: true },
    { key: "samples", label: "样本数", type: "number", required: true },
    { key: "centers", label: "中心数", type: "number", required: true },
    {
      key: "notes",
      label: "背景、目标、设计、交付物、时间线、报价说明",
      type: "textarea",
      required: true,
    },
  ],
  study: [
    {
      key: "notes",
      label: "研究目标、入排、终点、随访、样本量假设",
      type: "textarea",
      required: true,
    },
  ],
  quote: [
    { key: "samples", label: "样本数", type: "number", required: true },
    { key: "unitPrice", label: "单价（元）", type: "number", required: true },
    { key: "unitCost", label: "单位成本（元）", type: "number" },
    { key: "centerCost", label: "中心总成本（元）", type: "number" },
    { key: "riskCost", label: "风险成本（元）", type: "number" },
    note,
  ],
  contract: [
    {
      key: "contractType",
      label: "合同类型",
      type: "select",
      options: ["fixed", "framework"],
    },
    {
      key: "notes",
      label: "合同条款 / 法务意见",
      type: "textarea",
      required: true,
    },
    { key: "signer", label: "签署人" },
    { key: "signedDate", label: "签署日期", type: "date" },
  ],
  project: [
    { key: "notes", label: "交付范围与报告要求", type: "textarea" },
    due,
  ],
  sample: [
    { key: "code", label: "脱敏样本编号", required: true },
    { key: "sampleType", label: "样本类型", required: true },
    note,
  ],
  milestone: [due, note],
  receivable: [
    { key: "amount", label: "应收金额（元）", type: "number", required: true },
    due,
    note,
  ],
  receipt: [
    { key: "amount", label: "到账金额（元）", type: "number", required: true },
    { key: "reference", label: "银行流水号", required: true },
  ],
  maintenance: [{ key: "contact", label: "联系人" }, due, note],
  knowledge: [
    {
      key: "category",
      label: "分类",
      type: "select",
      options: ["SOP", "案例", "条款", "报价参考", "研究"],
    },
    { key: "tags", label: "标签" },
    { key: "notes", label: "脱敏正文", type: "textarea", required: true },
  ],
  review: [
    {
      key: "notes",
      label: "成功点、失败点、改进建议、可复用模板",
      type: "textarea",
      required: true,
    },
  ],
  task: [due, note],
  contact: [
    { key: "position", label: "职位 / 科室" },
    { key: "phone", label: "联系方式" },
    note,
  ],
  capability: [
    { key: "test", label: "检测名称", required: true },
    { key: "sampleType", label: "样本类型", required: true },
    { key: "region", label: "覆盖地区", required: true },
    { key: "qualification", label: "资质说明", required: true },
    note,
  ],
};
export const tools = [
  ["radar", "药企管线雷达", "lead"],
  ["triage", "机会评估助手", "opportunity"],
  ["brief", "拜访前情报包", "visit"],
  ["minutes", "访后纪要", "visit"],
  ["proposal", "商业提案生成", "proposal"],
  ["study", "研究设计辅助", "study"],
  ["pricing", "报价测算", "quote"],
  ["contract", "合同条款审查", "contract"],
  ["report", "项目周报", "project"],
  ["health", "客户健康度", "maintenance"],
  ["knowledge", "知识检索", "knowledge"],
  ["review", "项目复盘", "review"],
] as const;
export const bodySchema = z.object({
  kind: z.enum(kinds),
  title: z.string().trim().min(1).max(150),
  caseId: z.string().optional(),
  parentId: z.string().optional(),
  data: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
});
const businessFields: Field[] = [
  {
    key: "cooperationType",
    label: "合作类型",
    type: "select",
    options: ["CTA", "CDx", "IIT/科研", "测序服务", "试剂", "招募", "其他"],
  },
  { key: "protocol", label: "临床方案号" },
  { key: "projectCode", label: "项目编号" },
  { key: "sponsor", label: "申办方" },
  { key: "partner", label: "合作机构" },
  { key: "historicalOwner", label: "历史BD / PM" },
  { key: "indication", label: "适应症" },
  { key: "platform", label: "检测平台" },
  { key: "phase", label: "临床 / 业务阶段" },
  { key: "sourceDate", label: "来源日期（保留年月精度）" },
  { key: "businessDate", label: "业务发生日期", type: "date" },
];
for (const k of [
  "lead",
  "opportunity",
  "proposal",
  "project",
  "contract",
] as Kind[])
  fields[k].push(...businessFields);
fields.quote.push({
  key: "lineItems",
  label: "多单位报价明细（JSON，可选）",
  type: "textarea",
});
fields.sample.push(
  {
    key: "sampleStage",
    label: "样本阶段",
    type: "select",
    options: [
      "收样",
      "待检",
      "检测",
      "异常暂停",
      "报告交付",
      "保存",
      "处置申请",
    ],
  },
  { key: "disposalEvidence", label: "处置申请依据（仅记录，不执行销毁）" },
);
fields.project.push(
  { key: "cycleDays", label: "检测周期天数", type: "number" },
  {
    key: "cycleType",
    label: "检测周期口径",
    type: "select",
    options: ["自然日", "工作日"],
  },
);
export function validateData(
  kind: Kind,
  data: Record<string, unknown>,
  forSubmit = false,
) {
  for (const f of fields[kind]) {
    if (
      kind === "quote" &&
      data.lineItems &&
      ["samples", "unitPrice"].includes(f.key)
    )
      continue;
    const v = data[f.key];
    if (
      f.required &&
      (v === undefined || v === "") &&
      (forSubmit ||
        !["proposal", "study", "contract", "review", "knowledge"].includes(
          kind,
        ))
    )
      throw new Error(`${f.label}不能为空`);
    if (v !== undefined && v !== "") {
      if (
        f.type === "number" &&
        (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e9)
      )
        throw new Error(`${f.label}必须是合理的非负数`);
      if (
        ["samples", "centers"].includes(f.key) &&
        (!Number.isInteger(v) || Number(v) < 1)
      )
        throw new Error(`${f.label}必须为正整数`);
      if (
        f.type === "date" &&
        (typeof v !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
          new Date(v).toISOString().slice(0, 10) !== v)
      )
        throw new Error(`${f.label}不是有效日期`);
    }
  }
  if (["receivable", "receipt"].includes(kind) && Number(data.amount) <= 0)
    throw new Error("金额必须大于零");
}
export function quoteTotals(data: Record<string, unknown>) {
  if (data.lineItems) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(data.lineItems));
    } catch {
      throw Error("多单位报价明细JSON格式错误");
    }
    const result = priceItems(parsed);
    const known = result.items.every((i) => i.cost !== undefined);
    const costCents = known
      ? result.items.reduce(
          (s, i) => s + Math.round(Number(i.cost) * 100 * i.quantity),
          0,
        )
      : null;
    return {
      amountCents: result.amountCents,
      costCents,
      margin:
        costCents === null || result.amountCents === 0
          ? null
          : (result.amountCents - costCents) / result.amountCents,
    };
  }
  const samples = Number(data.samples);
  const amountCents = Math.round(Number(data.unitPrice) * 100) * samples;
  const hasCost = data.unitCost !== undefined && data.unitCost !== "";
  const costCents = hasCost
    ? Math.round(Number(data.unitCost) * 100) * samples +
      Math.round(Number(data.centerCost || 0) * 100) +
      Math.round(Number(data.riskCost || 0) * 100)
    : null;
  if (
    !Number.isSafeInteger(amountCents) ||
    (costCents !== null && !Number.isSafeInteger(costCents))
  )
    throw new Error("金额超出安全计算范围");
  return {
    amountCents,
    costCents,
    margin:
      costCents === null || !amountCents
        ? null
        : (amountCents - costCents) / amountCents,
  };
}
export type DocumentRow = {
  nature?: string;
  businessLine?: string;
  id: string;
  kind: Kind;
  title: string;
  caseId: string | null;
  parentId: string | null;
  ownerId: string;
  status: string;
  version: number;
  archived: boolean;
  updatedAt: string;
  data: Record<string, any>;
  case?: { title: string; customer: { id: string; name: string } };
};
