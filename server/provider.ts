import { db } from "./db";
import { accessible, recordScope } from "./service";
import { User } from "@prisma/client";
import { tools, quoteTotals } from "../shared/domain";
export interface Provider {
  generate(
    tool: string,
    input: string,
    recordId: string,
    user: User,
  ): Promise<string>;
}
export class DemoProvider implements Provider {
  async generate(tool: string, input: string, recordId: string, user: User) {
    const r = await accessible(user, recordId),
      d = JSON.parse(r.data);
    const prefix = "【演示模板 / 规则结果：请核验后确认】\n";
    if (tool === "knowledge") {
      const terms = input.trim().split(/\s+/).filter(Boolean);
      const docs = await db.record.findMany({
        where: {
          AND: [
            recordScope(user),
            {
              kind: { in: ["knowledge", "review"] },
              status: "published",
              nature:r.nature,
              archived: false,
            },
          ],
        },
      });
      const hits = docs.filter((doc) =>
        terms.some((t) =>
          (doc.title + " " + JSON.parse(doc.data).notes)
            .toLowerCase()
            .includes(t.toLowerCase()),
        ),
      );
      return hits.length
        ? hits
            .map(
              (doc) =>
                `来源：${doc.title} | ID ${doc.id} | v${doc.version} | ${doc.updatedAt.toISOString()}\n${String(JSON.parse(doc.data).notes).slice(0, 1800)}`,
            )
            .join("\n\n")
        : "未找到相关资料。请更换关键词或上传并审核知识文档。";
    }
    if (tool === "triage") {
      const capabilities = await db.record.findMany({
        where: { kind: "capability", archived: false, ...recordScope(user) },
      });
      const match = capabilities.filter((c) => {
        const x = JSON.parse(c.data);
        return String(d.test)
          .toLowerCase()
          .includes(String(x.test).toLowerCase());
      });
      return (
        prefix +
        `检测能力匹配：${match.length ? "50/50" : "0/50"}\n样本匹配：${match.some((c) => JSON.parse(c.data).sampleType === d.sampleType) ? "25/25" : "0/25"}\n地区匹配：${match.some((c) => JSON.parse(c.data).region === d.region) ? "25/25" : "0/25"}\n资质、人遗审批、竞品情况：待人工核验\n建议：${match.length ? "补齐资质信息后评估跟进" : "先核查内部能力，暂时观望"}\n依据：${match.map((c) => c.title).join("、") || "未匹配内部能力条目"}`
      );
    }
    if (tool === "pricing") {
      const q = quoteTotals(d);
      return (
        prefix +
        `报价金额：${q.amountCents / 100} 元\n成本及毛利请由财务在报价明细核算。\n付款结构草案：签署40%、中期40%、验收20%（需协商）。`
      );
    }
    if (tool === "radar")
      return (
        prefix +
        `人工导入记录：${r.title}\n来源：${d.source || "待填写"}\n靶点/瘤种：${d.target || "待填写"}\n临床阶段、样本量、中心地区及 NGS 需求均待核验。未连接外部实时管线。`
      );
    if (tool === "contract")
      return (
        prefix +
        ["付款条件", "IP归属", "数据使用范围", "责任上限", "争议解决"]
          .map(
            (x) =>
              `${x}：${String(d.notes).includes(x) ? "发现相关关键词，需逐条复核" : "未检出明确关键词，请法务确认"}。`,
          )
          .join("\n") +
        "\n本结果为关键词规则检查，不能据此认定合同无风险。"
      );
    if (tool === "report" || tool === "review") {
      const rows = await db.record.findMany({
        where: { caseId: r.caseId, ...recordScope(user), archived: false },
      });
      return (
        prefix +
        `项目：${r.title}\n${rows.map((x) => `${x.kind} · ${x.title} · ${x.status}`).join("\n")}\n${tool === "review" ? "成功点：待复盘\n失败点：待复盘\n改进建议：明确责任人与完成日期\n可复用模板：经脱敏审核后发布" : "本周进展：请核验以上台账\n风险：检查未完成里程碑与应收\n下周安排：补充具体负责人和时间"}`
      );
    }
    if (tool === "health") {
      const rows = await db.record.findMany({
        where: { caseId: r.caseId, ...recordScope(user), archived: false },
      });
      const last = rows
        .filter((x) => ["visit", "maintenance"].includes(x.kind))
        .sort((a, b) => +b.updatedAt - +a.updatedAt)[0];
      const days = last
        ? Math.floor((Date.now() - +last.updatedAt) / 86400000)
        : 999;
      const ar = rows
        .filter((x) => x.kind === "receivable")
        .map((x) => JSON.parse(x.data));
      const total = ar.reduce((s, x) => s + (x.amountCents || 0), 0);
      const received = ar.reduce((s, x) => s + (x.receivedCents || 0), 0);
      const interaction = days <= 30 ? 40 : days <= 60 ? 20 : 0,
        projects = Math.min(
          20,
          rows.filter((x) => x.kind === "project").length * 10,
        ),
        payment = total ? Math.round((received / total) * 40) : 0;
      return (
        prefix +
        `评分 ${interaction + projects + payment}/100\n近期互动 ${interaction}/40；合作项目 ${projects}/20；回款 ${payment}/40。\n无应收数据不假设满分。建议：${days > 30 ? "预约沟通，核实项目需求" : "保持跟进并记录客户反馈"}。`
      );
    }
    const templates: Record<string, string> = {
      brief: `客户：${r.case?.customer.name || "待确认"}\n讨论点：检测需求、样本条件、交付周期\n趋势与联系人论文：无外部来源，待补充\n异议：成本与周期；应对：以已核验检测能力说明。`,
      minutes: `情境：${input}\n问题：待确认客户主要障碍\n暗示：待确认对周期和预算的影响\n需求-满足：待明确检测交付物\n行动：${d.nextAction || "补充下一步动作"}，截止 ${d.dueDate || "待定"}`,
      proposal: `背景：${input}\n目标：${r.title}\n方案设计：${d.test || "待定"}；样本 ${d.samples || "待定"}；中心 ${d.centers || "待定"}\n样本量估算：当前为业务输入，须技术复核\n时间线：启动、收样、检测、报告、验收（日期待定）\n交付物：检测报告与约定的数据集\n里程碑：启动确认、样本交接、中期评审、结项验收\n报价表：由关联的已审批报价提供。`,
      study: `研究目标：${input}\n入排标准：依据目标人群拟定，待临床专家确认\n终点：预先定义主要与次要终点，待确认\n随访：按研究目标确定频率，待确认\n样本量逻辑：明确效应量、检验水准、效能与脱落率后计算；当前缺少参数，不提供数值。`,
    };
    if (!tools.some((t) => t[0] === tool)) throw new Error("未知工具");
    return prefix + (templates[tool] || input);
  }
}
export const provider: Provider = new DemoProvider();
export async function runTask(id: string, user: User) {
  const task = await db.aiTask.findUniqueOrThrow({ where: { id } });
  if (task.status !== "queued") return;
  const claim = await db.aiTask.updateMany({
    where: { id, status: "queued" },
    data: { status: "processing", attempts: { increment: 1 } },
  });
  if (!claim.count) return;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let output: string;
    try {
      output = await Promise.race([
        provider.generate(task.tool, task.input, task.recordId, user),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("生成超时")), 30000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    await db.aiTask.update({
      where: { id },
      data: { output, status: "succeeded", error: "" },
    });
  } catch {
    await db.aiTask.update({
      where: { id },
      data: { status: "failed", error: "生成失败，请检查记录权限或稍后重试" },
    });
  }
}
