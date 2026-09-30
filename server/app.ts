import express, { Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { User } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { verifyPassword, tokenHash, hashPassword } from "./auth";
import {
  bodySchema,
  kinds,
  Kind,
  tools,
  roles,
  validateData,
} from "../shared/domain";
import {
  accessible,
  action,
  audit,
  canCost,
  cleanData,
  createRecord,
  customerScope,
  editable,
  fail,
  HttpError,
  includeCase,
  privileged,
  recordScope,
  safeRecord,
  write,
  writer,
} from "./service";
import { runTask } from "./provider";
import { filesRouter } from "./files";
import { historyRouter } from "./history";
import { workflowRouter } from "./workflow";
import { scenarioRouter } from "./scenarios";
import { managementRouter,phase } from "./management";
declare global {
  namespace Express {
    interface Request {
      user: User;
    }
  }
}
export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  role: u.role,
  username: u.username,
});
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
    const allowed = [
      `http://${req.headers.host}`,
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ];
    if (!allowed.includes(req.headers.origin))
      return res.status(403).json({ error: "跨站请求被拒绝" });
  }
  next();
});
const attempts = new Map<string, { count: number; until: number }>();
app.post(
  "/api/v1/login",
  asyncRoute(async (req, res) => {
    const { username, password } = z
      .object({ username: z.string().max(80), password: z.string().max(200) })
      .parse(req.body);
    const key = req.ip || "local",
      previous = attempts.get(key),
      limit =
        previous && previous.until > Date.now()
          ? previous
          : { count: 0, until: Date.now() + 600000 };
    if (limit.count >= 20) fail("尝试次数过多，请10分钟后重试", 429);
    const u = await db.user.findUnique({ where: { username } });
    if (!u || !verifyPassword(password, u.passwordHash)) {
      limit.count++;
      attempts.set(key, limit);
      fail("用户名或密码错误", 401);
    }
    attempts.delete(key);
    const token = randomBytes(32).toString("hex");
    await db.session.create({
      data: {
        id: tokenHash(token),
        userId: u.id,
        expiresAt: new Date(Date.now() + 8 * 3600000),
      },
    });
    res.cookie("bd_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 8 * 3600000,
      path: "/",
    });
    res.json(publicUser(u));
  }),
);
app.get("/api/v1/environment", (_req, res) =>
  res.json({ demo: process.env.APP_MODE === "demo" }),
);
app.use("/api/v1", (req, res, next) => {
  const token = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("bd_session="))
    ?.slice(11);
  if (!token) return res.status(401).json({ error: "请登录" });
  db.session
    .findUnique({ where: { id: tokenHash(token) }, include: { user: true } })
    .then((s) => {
      if (!s || s.expiresAt < new Date())
        return res.status(401).json({ error: "登录已过期" });
      req.user = s.user;
      next();
    })
    .catch(next);
});
app.get("/api/v1/me", (req, res) => res.json(publicUser(req.user)));
app.post(
  "/api/v1/logout",
  asyncRoute(async (req, res) => {
    await db.session.deleteMany({ where: { userId: req.user.id } });
    res.clearCookie("bd_session", { path: "/" });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/v1/users",
  asyncRoute(async (req, res) => {
    res.json((await db.user.findMany()).map(publicUser));
  }),
);
app.post(
  "/api/v1/users",
  asyncRoute(async (req, res) => {
    if (req.user.role !== "admin") fail("仅管理员可创建账号", 403);
    const input = z
      .object({
        username: z.string().regex(/^[a-z0-9_-]{2,40}$/),
        name: z.string().trim().min(1).max(80),
        role: z.enum(roles),
        password: z.string().min(10).max(200),
      })
      .parse(req.body);
    const user = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          username: input.username,
          name: input.name,
          role: input.role,
          passwordHash: hashPassword(input.password),
        },
      });
      await audit(tx, req.user, u.id, "create-user", u.username);
      return u;
    });
    res.status(201).json(publicUser(user));
  }),
);
app.post(
  "/api/v1/password",
  asyncRoute(async (req, res) => {
    const input = z
      .object({ current: z.string(), password: z.string().min(10).max(200) })
      .parse(req.body);
    if (!verifyPassword(input.current, req.user.passwordHash))
      fail("当前密码不正确", 403);
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: req.user.id },
        data: { passwordHash: hashPassword(input.password) },
      });
      await tx.session.deleteMany({ where: { userId: req.user.id } });
      await audit(tx, req.user, req.user.id, "password-change", "会话已撤销");
    });
    res.clearCookie("bd_session", { path: "/" });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/v1/customers",
  asyncRoute(async (req, res) =>
    res.json(
      await db.customer.findMany({
        where: { ...customerScope(req.user), archived: false },
        include: { cases: true, grants: true },
        orderBy: { updatedAt: "desc" },
      }),
    ),
  ),
);
app.post(
  "/api/v1/customers",
  asyncRoute(async (req, res) => {
    writer(req.user, "lead");
    const data = z
      .object({
        name: z.string().trim().min(1).max(150),
        contact: z.string().max(500).default(""),
      })
      .parse(req.body);
    const row = await db.$transaction(async (tx) => {
      const c = await tx.customer.create({
        data: { ...data, ownerId: req.user.id },
      });
      await audit(tx, req.user, c.id, "create", c.name);
      return c;
    });
    res.status(201).json(row);
  }),
);
app.patch(
  "/api/v1/customers/:id",
  asyncRoute(async (req, res) => {
    writer(req.user, "lead");
    const input = z
      .object({
        name: z.string().trim().min(1).max(150),
        contact: z.string().max(500),
        version: z.number().int(),
      })
      .parse(req.body);
    res.json(
      await db.$transaction(async (tx) => {
        const c = await tx.customer.findFirst({
          where: { id: req.params.id, ...customerScope(req.user) },
        });
        if (!c) fail("客户不存在", 404);
        const changed = await tx.customer.updateMany({
          where: { id: c.id, version: input.version },
          data: {
            name: input.name,
            contact: input.contact,
            version: { increment: 1 },
          },
        });
        if (!changed.count) fail("版本冲突", 409);
        await audit(tx, req.user, c.id, "edit", input.name);
        return tx.customer.findUnique({ where: { id: c.id } });
      }),
    );
  }),
);
app.post(
  "/api/v1/customers/:id/grants",
  asyncRoute(async (req, res) => {
    if (!privileged(req.user)) fail("仅主管可授权", 403);
    const { userIds } = z
      .object({ userIds: z.array(z.string()) })
      .parse(req.body);
    await db.$transaction(async (tx) => {
      await tx.grant.deleteMany({ where: { customerId: req.params.id } });
      for (const userId of new Set(userIds))
        await tx.grant.create({ data: { customerId: req.params.id, userId } });
      await audit(
        tx,
        req.user,
        req.params.id,
        "grant",
        JSON.stringify(userIds),
      );
    });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/v1/cases",
  asyncRoute(async (req, res) =>
    res.json(
      await db.businessCase.findMany({
        where: { customer: { ...customerScope(req.user), archived: false } },
        include: { customer: true },
      }),
    ),
  ),
);
app.post(
  "/api/v1/cases",
  asyncRoute(async (req, res) => {
    writer(req.user, "lead");
    const input = z
      .object({
        customerId: z.string(),
        title: z.string().trim().min(1).max(150),
      })
      .parse(req.body);
    if (
      !(await db.customer.findFirst({
        where: { id: input.customerId, ...customerScope(req.user) },
      }))
    )
      fail("无权访问客户", 403);
    res.status(201).json(await db.businessCase.create({ data: input }));
  }),
);
app.get(
  "/api/v1/records",
  asyncRoute(async (req, res) => {
    const query = z
      .object({
        kind: z.enum(kinds).optional(),
        q: z.string().optional(),
        caseId: z.string().optional(),
        customerId: z.string().optional(),
        ownerId: z.string().optional(),
        status: z.string().optional(),
        nature: z.enum(["daily", "history", "scenario"]).optional(),
        businessLine: z.enum(["PB", "SR"]).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const where = {
      AND: [
        recordScope(req.user),
        {
          archived: false,
          kind: query.kind,
          caseId: query.caseId,
          ownerId: query.ownerId,
          status: query.status,
          nature: query.nature,
          businessLine: query.businessLine,
          ...(query.customerId
            ? { case: { customerId: query.customerId } }
            : {}),
          ...(query.q ? { title: { contains: query.q } } : {}),
        },
      ],
    };
    const [rows, total] = await db.$transaction([
      db.record.findMany({
        where,
        include: includeCase,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { updatedAt: "desc" },
      }),
      db.record.count({ where }),
    ]);
    res.json({
      rows: rows.map((r) => safeRecord(req.user, r)),
      total,
      page: query.page,
    });
  }),
);
app.post(
  "/api/v1/records",
  asyncRoute(async (req, res) =>
    res
      .status(201)
      .json(await createRecord(req.user, bodySchema.parse(req.body))),
  ),
);
app.get(
  "/api/v1/records/:id",
  asyncRoute(async (req, res) => {
    const r = await accessible(req.user, req.params.id);
    const [files, revisions, tasks, children] = await Promise.all([
      r.kind === "quote" && !canCost(req.user)
        ? Promise.resolve([])
        : db.attachment.findMany({
            where: { recordId: r.id },
            select: {
              id: true,
              name: true,
              mime: true,
              size: true,
              text: true,
              parseStatus: true,
              createdAt: true,
            },
          }),
      db.revision.findMany({
        where: { recordId: r.id },
        orderBy: { version: "desc" },
      }),
      db.aiTask.findMany({
        where: { recordId: r.id },
        orderBy: { createdAt: "desc" },
      }),
      db.record.findMany({
        where: { parentId: r.id, ...recordScope(req.user) },
        include: includeCase,
      }),
    ]);
    res.json({
      ...safeRecord(req.user, r),
      phase:r.caseId?phase(await db.record.findMany({where:{caseId:r.caseId,archived:false},select:{kind:true,status:true}})):'评估',
      ownerName:(await db.user.findUnique({where:{id:r.ownerId},select:{name:true}}))?.name,
      files,
      revisions: revisions.map((v) => {
        const snapshot = JSON.parse(v.snapshot);
        if (!canCost(req.user))
          for (const k of [
            "unitCost",
            "centerCost",
            "riskCost",
            "costCents",
            "margin",
          ])
            delete snapshot.data[k];
        if (!canCost(req.user)) delete snapshot.data.lineItems;
        return { ...v, snapshot };
      }),
      tasks,
      children: children.map((c) => safeRecord(req.user, c)),
    });
  }),
);
app.patch(
  "/api/v1/records/:id",
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        title: z.string().trim().min(1).max(150),
        version: z.number().int(),
        data: z.record(z.union([z.string(), z.number(), z.boolean()])),
      })
      .strict()
      .parse(req.body);
    res.json(
      await db.$transaction(async (tx) => {
        const r = await accessible(req.user, req.params.id, tx);
        writer(req.user, r.kind as Kind);
        editable(r);
        if (r.kind === "receivable")
          fail("应收计划创建后不可修改，请核对后新增");
        if (r.version !== input.version) fail("版本冲突，请重新加载", 409);
        const data = cleanData(
          req.user,
          r.kind as Kind,
          input.data,
          JSON.parse(r.data),
        );
        return safeRecord(
          req.user,
          await write(
            tx,
            req.user,
            r,
            { title: input.title, data: JSON.stringify(data) },
            "edit",
          ),
        );
      }),
    );
  }),
);
app.post(
  "/api/v1/records/:id/actions",
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        action: z.string(),
        version: z.number().int(),
        comment: z.string().max(20000).optional(),
        amount: z.number().optional(),
        reference: z.string().max(200).optional(),
        userId: z.string().optional(),
      })
      .strict()
      .parse(req.body);
    res.json(await action(req.user, req.params.id, input));
  }),
);
app.get(
  "/api/v1/dashboard",
  asyncRoute(async (req, res) => {
    const rows = await db.record.findMany({
      where: { ...recordScope(req.user), archived: false, nature: "daily" },
      include: includeCase,
    });
    const now = new Date().toISOString().slice(0, 10);
    const ar = rows.filter((r) => r.kind === "receivable");
    const pending = ar.reduce((s, r) => {
      const d = JSON.parse(r.data);
      return s + d.amountCents - (d.receivedCents || 0);
    }, 0);
    const overdue = rows.filter((r) => {
      const d = JSON.parse(r.data);
      return (
        d.dueDate &&
        d.dueDate < now &&
        !["done", "paid", "confirmed"].includes(r.status) &&
        ["task", "milestone", "receivable"].includes(r.kind)
      );
    });
    res.json({
      opportunities: rows.filter(
        (r) => r.kind === "opportunity" && !["lost"].includes(r.status),
      ).length,
      projects: rows.filter(
        (r) => r.kind === "project" && r.status === "active",
      ).length,
      signedCents: rows
        .filter((r) => r.kind === "contract" && r.status === "signed")
        .reduce((s, r) => s + (JSON.parse(r.data).amountCents || 0), 0),
      pendingCents: pending,
      alerts: [
        ...overdue,
        ...rows.filter((r) => r.kind === "sample" && r.status === "abnormal"),
      ].map((r) => safeRecord(req.user, r)),
      tasks: rows
        .filter((r) => r.kind === "task" && r.status !== "done")
        .map((r) => safeRecord(req.user, r)),
      counts: Object.fromEntries(
        kinds.map((k) => [k, rows.filter((r) => r.kind === k).length]),
      ),
    });
  }),
);
app.get(
  "/api/v1/audit",
  asyncRoute(async (req, res) => {
    if (!privileged(req.user)) fail("仅主管可查看审计", 403);
    res.json(
      await db.auditLog.findMany({ take: 200, orderBy: { createdAt: "desc" } }),
    );
  }),
);
app.post(
  "/api/v1/import/leads",
  asyncRoute(async (req, res) => {
    writer(req.user, "lead");
    const { csv } = z.object({ csv: z.string().max(500000) }).parse(req.body);
    let rows: any[];
    try {
      rows = parse(csv, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        trim: true,
      });
    } catch {
      fail("CSV 格式错误");
    }
    if (!rows!.length || rows!.length > 500) fail("CSV 应包含1至500条记录");
    const inputs = rows!.map((r) =>
      bodySchema.parse({
        kind: "lead",
        title: r.title,
        data: {
          company: r.company,
          source: r.source || "CSV",
          target: r.target || "",
          notes: r.notes || "",
        },
      }),
    );
    for (const r of inputs) validateData("lead", r.data);
    await db.$transaction(async (tx) => {
      for (const r of inputs)
        await tx.record.create({
          data: {
            kind: "lead",
            title: r.title,
            data: JSON.stringify(r.data),
            ownerId: req.user.id,
          },
        });
      await audit(
        tx,
        req.user,
        req.user.id,
        "import",
        String(inputs.length) + " 条线索",
      );
    });
    res.json({ count: inputs.length });
  }),
);
app.use("/api/v1", filesRouter);
app.use("/api/v1", workflowRouter);
app.use("/api/v1", scenarioRouter);
app.use("/api/v1", managementRouter);
app.use("/api/v1", (req, res, next) =>
  /^\/(sources|imports)(\/|$)/.test(req.path)
    ? historyRouter(req, res, next)
    : next(),
);
app.post(
  "/api/v1/ai",
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        recordId: z.string(),
        tool: z.string(),
        input: z.string().trim().min(1).max(20000),
      })
      .parse(req.body);
    const r = await accessible(req.user, input.recordId);
    writer(req.user, r.kind as Kind);
    const tool = tools.find((t) => t[0] === input.tool);
    if (!tool || tool[2] !== r.kind) fail("工具与业务记录类型不匹配");
    const task = await db.aiTask.create({ data: input });
    setTimeout(() => void runTask(task.id, req.user).catch(() => {}), 50);
    res.status(202).json(task);
  }),
);
app.post(
  "/api/v1/ai/:id/retry",
  asyncRoute(async (req, res) => {
    const t = await db.aiTask.findUnique({ where: { id: req.params.id } });
    if (!t) fail("任务不存在", 404);
    const r = await accessible(req.user, t.recordId);
    writer(req.user, r.kind as Kind);
    if (t.status !== "failed") fail("仅失败任务可重试");
    const claimed = await db.aiTask.updateMany({
      where: { id: t.id, status: "failed" },
      data: { status: "queued" },
    });
    if (!claimed.count) fail("任务状态已改变", 409);
    setTimeout(() => void runTask(t.id, req.user).catch(() => {}), 50);
    res.json({ ok: true });
  }),
);
app.post(
  "/api/v1/ai/:id/confirm",
  asyncRoute(async (req, res) => {
    const { output, version } = z
      .object({
        output: z.string().min(1).max(30000),
        version: z.number().int(),
      })
      .parse(req.body);
    await db.$transaction(async (tx) => {
      const t = await tx.aiTask.findUnique({ where: { id: req.params.id } });
      if (!t) fail("任务不存在", 404);
      const r = await accessible(req.user, t.recordId, tx);
      writer(req.user, r.kind as Kind);
      if (t.status === "confirmed") fail("已经确认，不会重复写入", 409);
      if (t.status !== "succeeded") fail("任务未完成");
      editable(r);
      if (r.version !== version) fail("记录已更新，请重新加载", 409);
      const data = JSON.parse(r.data);
      data.notes = output;
      await write(
        tx,
        req.user,
        r,
        { data: JSON.stringify(data) },
        "ai-confirm",
        t.tool,
      );
      await tx.aiTask.update({
        where: { id: t.id },
        data: { output, status: "confirmed" },
      });
    });
    res.json({ ok: true });
  }),
);
app.post(
  "/api/v1/demo/reset",
  asyncRoute(async (req, res) => {
    if (
      process.env.APP_MODE !== "demo" ||
      !String(process.env.DATABASE_URL).endsWith("/demo.db")
    )
      fail("仅允许重置 demo.db", 403);
    if (req.user.role !== "admin") fail("仅管理员可重置", 403);
    if (req.body.confirm !== "RESET DEMO") fail("确认文字不正确");
    await db.$transaction(async (tx) => {
      await tx.aiTask.deleteMany();
      await tx.attachment.deleteMany();
      await tx.revision.deleteMany();
      if (await tx.sourceDocument.count())
        fail(
          "已导入历史资料，演示清空被禁用；请使用批次撤销，避免误删档案",
          409,
        );
      await tx.workflowItem.deleteMany();
      await tx.scenario.deleteMany();
      await tx.record.updateMany({ data: { parentId: null } });
      await tx.record.deleteMany();
      await tx.businessCase.deleteMany();
      await tx.grant.deleteMany();
      await tx.customer.deleteMany();
      await tx.auditLog.deleteMany();
    });
    res.json({ ok: true });
  }),
);
app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
app.use(express.static(path.resolve("dist")));
app.get("*", (_req, res) => res.sendFile(path.resolve("dist/index.html")));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    err instanceof HttpError
      ? err.status
      : err instanceof z.ZodError
        ? 400
        : err.code === "P2002"
          ? 409
          : err.code === "LIMIT_FILE_SIZE"
            ? 413
            : 400;
  res.status(status).json({
    error:
      err instanceof z.ZodError
        ? err.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")
        : err.code === "P2002"
          ? "记录重复，请检查名称或标识"
          : err.code === "P2003"
            ? "关联记录不存在"
            : err.code === "LIMIT_FILE_SIZE"
              ? "文件不能超过20MB"
              : err.message || "操作失败",
  });
});
