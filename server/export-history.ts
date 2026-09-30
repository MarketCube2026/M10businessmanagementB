import { db } from "./db";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
export async function exportHistory(render = false) {
  const [sources, rows, cases, customers, scenarios] = await Promise.all([
    db.sourceDocument.findMany(),
    db.sourceRow.findMany({
      include: { source: true },
      orderBy: [{ sourceId: "asc" }, { page: "asc" }, { locator: "asc" }],
    }),
    db.businessCase.findMany({
      where: { nature: "history" },
      include: { customer: true },
    }),
    db.customer.findMany({ where: { source: { startsWith: "history:" } } }),
    db.scenario.findMany(),
  ]);
  const evidence = (r: any) =>
    (
      ({
        fact: "有来源事实",
        pending: "待核实",
        missing: "缺失",
        conflict: "来源冲突",
      }) as any
    )[r.evidence];
  const sheets: any[] = [
    {
      name: "客户与别名",
      headers: ["客户ID", "原始客户名称", "关联策略", "来源批次"],
      rows: customers.map((c) => [
        c.id,
        c.name,
        "精确名称匹配；简称未擅自归并",
        c.source,
      ]),
      wide: ["B", "C"],
    },
    {
      name: "项目档案",
      headers: ["业务线", "客户", "项目档案", "临床方案号", "数据性质"],
      rows: cases.map((c) => [
        c.businessLine,
        c.customer.name,
        c.title,
        c.protocol,
        "历史档案",
      ]),
      wide: ["B", "C"],
    },
  ];
  for (const name of ["商务与拜访", "交付与质量", "订单与财务", "经营快照"]) {
    sheets.push({
      name,
      headers: [
        "业务线",
        "客户 / 合作方",
        "项目 / 临床方案",
        "原始信息（保留口径）",
        "核对结论",
        "金额原文（非到账）",
        "历史负责人",
        "历史状态",
        "来源文件",
        "来源定位",
        "来源日期",
        "证据状态",
        "字段映射",
      ],
      rows: rows
        .filter((r) => r.category === name)
        .map((r) => {
          const n = JSON.parse(r.normalized);
          return [
            r.source.businessLine,
            n.customer || "",
            n.protocol || n.projectCode || "",
            r.raw,
            r.issues,
            n.rawAmount || "",
            n.historicalOwner || "",
            n.historicalStatus || "",
            r.source.name,
            r.locator,
            r.source.sourceDate,
            evidence(r),
            r.normalized,
          ];
        }),
      wide: ["B", "D", "E", "I", "M"],
    });
  }
  sheets.push({
    name: "缺失冲突",
    headers: ["业务线", "来源定位", "问题", "证据状态", "文件名称", "原始内容"],
    rows: rows
      .filter((r) => r.issues || r.evidence !== "fact")
      .map((r) => [
        r.source.businessLine,
        r.locator,
        r.issues,
        evidence(r),
        r.source.name,
        r.raw,
      ]),
    wide: ["C", "E", "F"],
  });
  sheets.push({
    name: "来源索引",
    headers: [
      "来源ID",
      "文件名称",
      "SHA256",
      "页码/行定位",
      "完整提取内容",
      "结构化映射",
      "证据状态",
    ],
    rows: rows.map((r) => [
      r.sourceId,
      r.source.name,
      r.source.hash,
      r.locator,
      r.raw,
      r.normalized,
      evidence(r),
    ]),
    wide: ["B", "C", "E", "F"],
  });
  sheets.push({
    name: "案例验收",
    headers: ["案例编号", "案例", "步骤", "结果", "记录ID", "执行时间"],
    rows: scenarios.flatMap((s) => {
      const steps = JSON.parse(s.steps);
      return steps.length
        ? steps.map((x: any) => [
            s.code,
            s.title,
            x.label,
            x.status,
            x.recordId || "",
            x.at || "",
          ])
        : [[s.code, s.title, "待执行", s.status, "", ""]];
    }),
    wide: ["B", "C"],
  });
  const folder = path.resolve("outputs/history");
  await fs.mkdir(folder, { recursive: true });
  const input = path.join(folder, "workbook-input.json");
  await fs.writeFile(input, JSON.stringify(sheets));
  const output = path.join(folder, "历史业务核对表.xlsx");
  const node =
    process.env.ARTIFACT_NODE ||
    "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe";
  await run(
    node,
    [
      "scripts/artifact/export.mjs",
      input,
      output,
      ...(render ? ["--render"] : []),
    ],
    { timeout: 240000, maxBuffer: 2 * 1024 * 1024 },
  );
  return output;
}
let pending: Promise<string> | null = null;
export function queuedExport() {
  if (!pending)
    pending = exportHistory().finally(() => {
      pending = null;
    });
  return pending;
}
