import { Router } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import multer from "multer";
import { db } from "./db";
import { audit, fail } from "./service";
import { User } from "@prisma/client";
import { queuedExport } from "./export-history";
const run = promisify(execFile);
const root = path.resolve("storage/sources");
export const python =
  process.env.PYTHON_PATH ||
  "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
export type Source = {
  name: string;
  hash: string;
  businessLine: string;
  sourceDate: string;
  slides: {
    page: number;
    title: string;
    category: string;
    text: string;
    tables: { index: number; rows: string[][] }[];
    charts: { series: number; values: string[] }[];
    imageCount: number;
  }[];
};
const mainProjects = [
  {
    match: "JMT101",
    customer: "石药",
    protocol: "JMT101-017",
    code: "KP5C",
    type: "CDx",
    title: "JMT101-017 CTA检测与CDx共同开发",
    indication: "晚期结直肠癌",
    date: "2025-07-14",
  },
  {
    match: "QLS5316",
    customer: "齐鲁制药",
    protocol: "QLS5316-101",
    code: "",
    type: "CTA",
    title: "QLS5316-101 临床检测解决方案",
    indication: "晚期实体瘤",
    date: null,
  },
  {
    match: "BGB-A317",
    customer: "BGB-A317-2001-IIT研究合作方（主体待核实）",
    protocol: "BGB-A317-2001-IIT",
    code: "",
    type: "IIT/科研",
    title: "BGB-A317-2001-IIT 数据分析与文章撰写",
    indication: "EGFR突变非鳞NSCLC",
    date: null,
  },
  {
    match: "FCN-159",
    customer: "复星",
    protocol: "FCN-159-002",
    code: "",
    type: "CTA",
    title: "FCN-159-002 临床检测与研究稽查",
    indication: "I型神经纤维瘤病",
    date: null,
  },
];
function kindFor(category: string) {
  return category === "商务与拜访"
    ? "visit"
    : category === "订单与财务"
      ? "contract"
      : category === "交付与质量"
        ? "project"
        : "knowledge";
}
function rowMap(headers: string[], cells: string[]) {
  return Object.fromEntries(
    cells.map((v, i) => [headers[i] || "列" + (i + 1), v]),
  );
}
export function normalize(headers: string[], cells: string[]) {
  const mapped = rowMap(headers, cells);
  const find = (regex: RegExp) => {
    const key = Object.keys(mapped).find((k) => regex.test(k));
    return key ? mapped[key] : null;
  };
  return {
    fields: mapped,
    customer: find(/客户名称|药企名称|机构名称|客户单位|^客户(?:（|\(|$)|^药企$|顾客/),
    projectCode: find(/项目编号|项目号|科研编码/),
    protocol: find(/临床方案|临床项目号/),
    historicalOwner: find(/负责人|创建人|^BD$|^PM$/),
    historicalStatus: find(/进度|进展|当前|状态/),
    rawAmount: find(/金额|总价|订单金额/),
    evidence: "fact",
    missing: ["合同审批和银行流水不能从汇总资料推定"],
  };
}
export async function previewSources(
  sources: Source[],
  paths: Map<string, string>,
  user: User,
) {
  if (user.role !== "admin") fail("仅管理员可导入历史资料", 403);
  return db.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.create({
        data: { title: "历史PPT导入 " + new Date().toISOString().slice(0, 10) },
      });
      let count = 0;
      for (const s of sources) {
        const exists = await tx.sourceDocument.findUnique({
          where: { hash: s.hash },
        });
        if (exists) continue;
        const source = await tx.sourceDocument.create({
          data: {
            hash: s.hash,
            name: s.name,
            path: paths.get(s.hash) || "",
            businessLine: s.businessLine,
            sourceDate: s.sourceDate,
            content: JSON.stringify(s),
          },
        });
        for (const slide of s.slides) {
          const visual = /时间线|timeline|历史|研究设计/i.test(slide.title);
          const issue = visual
            ? "时间线或复杂图表需按原图核对；日期与节点不自动配对"
            : slide.imageCount && !slide.tables.length
              ? "包含图片：文本提取不代表已核验图片中的全部数据"
              : "";
          const base = {
            sourceId: source.id,
            batchId: batch.id,
            page: slide.page,
            category: slide.category,
          };
          await tx.sourceRow.create({
            data: {
              ...base,
              locator: "p" + slide.page,
              raw: slide.text,
              normalized: JSON.stringify({
                title: slide.title,
                sourceDate: s.sourceDate,
                imageCount: slide.imageCount,
              }),
              evidence: issue ? "pending" : "fact",
              issues: issue,
            },
          });
          count++;
          for (const table of slide.tables) {
            const headers = table.rows[0] || [];
            for (let i = 1; i < table.rows.length; i++) {
              const cells = table.rows[i];
              if (!cells.some(Boolean)) continue;
              const normalized = normalize(headers, cells);
              await tx.sourceRow.create({
                data: {
                  ...base,
                  locator:
                    "p" + slide.page + "/t" + table.index + "/r" + (i + 1),
                  raw: JSON.stringify(cells),
                  normalized: JSON.stringify(normalized),
                  issues: normalized.rawAmount === "TBD" ? "金额未确定" : "",
                },
              });
              count++;
            }
          }
          for (const chart of slide.charts) {
            await tx.sourceRow.create({
              data: {
                ...base,
                locator: "p" + slide.page + "/chart" + chart.series,
                category: "经营快照",
                raw: JSON.stringify(chart.values),
                normalized: JSON.stringify({
                  values: chart.values,
                  aggregation: "sourceSnapshotOnly",
                }),
                evidence: "pending",
                issues: "图表缓存，系列和统计口径需核验",
              },
            });
            count++;
          }
        }
      }
      await audit(
        tx,
        user,
        batch.id,
        "history-preview",
        String(count) + " 条来源记录",
      );
      return { ...batch, count };
    },
    { timeout: 120000 },
  );
}
export async function applyBatch(id: string, user: User) {
  if (user.role !== "admin") fail("仅管理员可应用导入", 403);
  return db.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.findUniqueOrThrow({ where: { id } });
      if (batch.status !== "preview") fail("批次已应用或已撤销", 409);
      const rows = await tx.sourceRow.findMany({
        where: { batchId: id },
        include: { source: true },
      });
      const manifest: {
        recordIds: string[];
        caseIds: string[];
        customerIds: string[];
      } = { recordIds: [], caseIds: [], customerIds: [] };
      const caseMap = new Map<string, string>();
      const customerMap = new Map<string, string>();
      async function customer(name: string) {
        if (customerMap.has(name)) return customerMap.get(name)!;
        let c = await tx.customer.findUnique({ where: { name } });
        if (!c) {
          c = await tx.customer.create({
            data: { name, ownerId: user.id, source: "history:" + id },
          });
          manifest.customerIds.push(c.id);
        }
        customerMap.set(name, c.id);
        return c.id;
      }
      async function business(
        name: string,
        title: string,
        protocol: string,
        line: string,
      ) {
        const key = name + "|" + (protocol || title);
        if (caseMap.has(key)) return caseMap.get(key)!;
        const customerId = await customer(name);
        let c = await tx.businessCase.findFirst({
          where: { customerId, nature: "history", title },
        });
        if (!c) {
          c = await tx.businessCase.create({
            data: {
              customerId,
              title,
              protocol: protocol || null,
              nature: "history",
              businessLine: line,
            },
          });
          manifest.caseIds.push(c.id);
        }
        caseMap.set(key, c.id);
        return c.id;
      }
      for (const sourceId of new Set(rows.map((r) => r.sourceId))) {
        const source = rows.find((r) => r.sourceId === sourceId)!.source;
        const p = mainProjects.find((p) => source.name.includes(p.match));
        if (p) {
          const caseId = await business(p.customer, p.title, p.protocol, "PB");
          const title =
            p.title +
            " / " +
            (source.name.includes("文章")
              ? "文章框架"
              : source.name.includes("研发")
                ? "分析结果"
                : source.name.includes("启动")
                  ? "启动资料"
                  : source.name.includes("稽查")
                    ? "稽查资料"
                    : "解决方案");
          const r = await tx.record.create({
            data: {
              kind: "project",
              title,
              caseId,
              ownerId: user.id,
              nature: "history",
              businessLine: "PB",
              status: "historical",
              data: JSON.stringify({
                protocol: p.protocol,
                projectCode: p.code,
                cooperationType: p.type,
                indication: p.indication,
                sourceDate: source.sourceDate,
                businessDate: p.date,
                historicalStatus: "资料记录，未推定本系统审批状态",
                notes: "详见关联原件与逐页来源记录",
                missing: "合同金额、审批和银行流水待补",
                sourceId: source.id,
              }),
            },
          });
          manifest.recordIds.push(r.id);
        }
      }
      for (const row of rows) {
        const n = JSON.parse(row.normalized);
        const p = mainProjects.find((p) => row.source.name.includes(p.match));
        let caseId: string | undefined;
        if (p) caseId = await business(p.customer, p.title, p.protocol, "PB");
        else if (
          n.customer &&
          String(n.customer).length > 1 &&
          String(n.customer).length < 100 &&
          !/^(合计|总计|客户|药企|备注)$/.test(n.customer)
        ) {
          const name = String(n.customer).trim();
          const title = n.protocol || n.projectCode || "2025年10月合作档案";
          caseId = await business(
            name,
            title,
            n.protocol || "",
            row.source.businessLine,
          );
        }
        if (row.locator.includes("/t") && caseId) {
          const r = await tx.record.create({
            data: {
              kind: kindFor(row.category),
              title:
                (n.protocol ||
                  n.projectCode ||
                  n.customer ||
                  p?.protocol ||
                  "历史记录") +
                " · " +
                row.locator,
              caseId,
              ownerId: user.id,
              nature: "history",
              businessLine: row.source.businessLine,
              status: "historical",
              data: JSON.stringify({
                ...n,
                sourceId: row.sourceId,
                sourceRowId: row.id,
                sourcePage: row.page,
                sourceDate: row.source.sourceDate,
                notes: row.raw,
              }),
            },
          });
          manifest.recordIds.push(r.id);
          await tx.sourceRow.update({
            where: { id: row.id },
            data: { recordId: r.id },
          });
        }
      }
      await tx.importBatch.update({
        where: { id },
        data: { status: "applied", manifest: JSON.stringify(manifest) },
      });
      await audit(
        tx,
        user,
        id,
        "history-apply",
        JSON.stringify({
          records: manifest.recordIds.length,
          cases: manifest.caseIds.length,
          customers: manifest.customerIds.length,
        }),
      );
      return manifest;
    },
    { timeout: 120000 },
  );
}
export const historyRouter = Router();
const wrap = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res)).catch(next);
historyRouter.use((req, res, next) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "历史原件及核对资料仅管理员可访问" });
  next();
});
historyRouter.get(
  "/sources",
  wrap(async (req: any, res: any) =>
    res.json(
      await db.sourceDocument.findMany({
        select: {
          id: true,
          name: true,
          hash: true,
          businessLine: true,
          sourceDate: true,
          createdAt: true,
          _count: { select: { rows: true } },
        },
      }),
    ),
  ),
);
historyRouter.get(
  "/sources/:id/file",
  wrap(async (req: any, res: any) => {
    const s = await db.sourceDocument.findUniqueOrThrow({
      where: { id: req.params.id },
    });
    res.download(s.path, s.name);
  }),
);
historyRouter.get(
  "/sources/:id",
  wrap(async (req: any, res: any) => {
    const s = await db.sourceDocument.findUniqueOrThrow({
      where: { id: req.params.id },
    });
    res.json({ ...s, path: undefined, content: JSON.parse(s.content) });
  }),
);
historyRouter.get(
  "/imports",
  wrap(async (req: any, res: any) =>
    res.json(
      await db.importBatch.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { rows: true } } },
      }),
    ),
  ),
);
historyRouter.get(
  "/imports/export",
  wrap(async (req: any, res: any) =>
    res.download(await queuedExport(), "历史业务核对表.xlsx"),
  ),
);
historyRouter.get(
  "/imports/rows",
  wrap(async (req: any, res: any) => {
    const q = z
      .object({
        q: z.string().default(""),
        category: z.string().default(""),
        line: z.string().default(""),
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(req.query);
    const where = {
      ...(q.category ? { category: q.category } : {}),
      ...(q.line ? { source: { businessLine: q.line } } : {}),
      ...(q.q ? { raw: { contains: q.q } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.sourceRow.findMany({
        where,
        include: {
          source: {
            select: { name: true, businessLine: true, sourceDate: true },
          },
        },
        skip: (q.page - 1) * 30,
        take: 30,
        orderBy: [{ sourceId: "asc" }, { page: "asc" }, { locator: "asc" }],
      }),
      db.sourceRow.count({ where }),
    ]);
    res.json({
      rows: rows.map((r) => ({ ...r, normalized: JSON.parse(r.normalized) })),
      total,
    });
  }),
);
historyRouter.patch(
  "/imports/rows/:id",
  wrap(async (req: any, res: any) => {
    const input = z
      .object({
        evidence: z.enum(["fact", "pending", "missing", "conflict"]),
        issues: z.string(),
        normalized: z.record(z.unknown()),
      })
      .parse(req.body);
    await db.$transaction(async (tx) => {
      await tx.sourceRow.update({
        where: { id: req.params.id },
        data: { ...input, normalized: JSON.stringify(input.normalized) },
      });
      await audit(tx, req.user, req.params.id, "source-review", input.issues);
    });
    res.json({ ok: true });
  }),
);
historyRouter.post(
  "/imports/:id/apply",
  wrap(async (req: any, res: any) =>
    res.json(await applyBatch(req.params.id, req.user)),
  ),
);
historyRouter.post(
  "/imports/:id/undo",
  wrap(async (req: any, res: any) => {
    await db.$transaction(async (tx) => {
      const b = await tx.importBatch.findUniqueOrThrow({
        where: { id: req.params.id },
      });
      if (b.status !== "applied") fail("只能撤销已应用批次", 409);
      const m = JSON.parse(b.manifest);
      const records = await tx.record.findMany({
        where: { id: { in: m.recordIds } },
        include: { children: true, files: true, revisions: true, tasks: true },
      });
      if (
        records.some(
          (r) =>
            r.version !== 1 ||
            r.children.length ||
            r.files.length ||
            r.revisions.length ||
            r.tasks.length,
        ) ||
        (await tx.workflowItem.count({
          where: { recordId: { in: m.recordIds } },
        }))
      )
        fail("记录已修改或存在后续业务，不能撤销", 409);
      const other = await tx.record.count({
        where: { caseId: { in: m.caseIds }, id: { notIn: m.recordIds } },
      });
      if (other) fail("商机已被其他业务使用", 409);
      await tx.sourceRow.updateMany({
        where: { batchId: b.id },
        data: { recordId: null },
      });
      await tx.record.deleteMany({ where: { id: { in: m.recordIds } } });
      await tx.businessCase.deleteMany({ where: { id: { in: m.caseIds } } });
      for (const cid of m.customerIds) {
        const c = await tx.customer.findUniqueOrThrow({
          where: { id: cid },
          include: { cases: true, grants: true },
        });
        if (c.cases.length || c.grants.length || c.version !== 1)
          fail("客户已被使用或修改，不能撤销", 409);
      }
      await tx.customer.deleteMany({ where: { id: { in: m.customerIds } } });
      await tx.importBatch.update({
        where: { id: b.id },
        data: { status: "undone" },
      });
      await audit(tx, req.user, b.id, "history-undo", "撤销未被使用的导入记录");
    });
    res.json({ ok: true });
  }),
);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => {
      fs.mkdir(root, { recursive: true })
        .then(() => cb(null, root))
        .catch((e) => cb(e, root));
    },
    filename: (_r, _f, cb) =>
      cb(
        null,
        Date.now() + "-" + Math.random().toString(36).slice(2) + ".pptx",
      ),
  }),
  limits: { fileSize: 150 * 1024 * 1024 },
});
historyRouter.post(
  "/imports/upload",
  upload.single("file"),
  wrap(async (req: any, res: any) => {
    const f = req.file;
    if (!f) fail("请选择PPTX");
    const output = f.path + ".json";
    const originalName = Buffer.from(f.originalname, "latin1").toString("utf8");
    try {
      if (!originalName.toLowerCase().endsWith(".pptx")) fail("仅支持PPTX");
      await run(
        python,
        ["scripts/extract_history.py", f.path, output, originalName],
        { timeout: 120000, maxBuffer: 1024 * 1024 },
      );
      const sources: Source[] = JSON.parse(await fs.readFile(output, "utf8"));
      const batch = await previewSources(
        sources,
        new Map([[sources[0].hash, f.path]]),
        req.user,
      );
      res.json(batch);
    } finally {
      await fs.unlink(output).catch(() => {});
    }
  }),
);
