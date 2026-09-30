import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
const tmp = mkdtempSync(path.join(tmpdir(), "bd-random30-"));
process.env.DATABASE_URL =
  "file:" + path.join(tmp, "test.db").replaceAll("\\", "/");
process.env.APP_MODE = "demo";
process.env.STORAGE_DIR = path.join(tmp, "storage");
new DatabaseSync(path.join(tmp, "test.db")).close();
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env: process.env, stdio: "pipe" },
);
const { db } = await import("../server/db");
const { seed } = await import("../server/seed");
await seed();
const { executeRandom } = await import("../server/random-flow");
const { overview } = await import("../server/management");
const batch = "acceptance-" + new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("outputs/manager", { recursive: true });
after(async () => {
  const runs = await db.randomRun.findMany({
    where: { batch },
    orderBy: { index: "asc" },
  });
  writeFileSync(
    "outputs/manager/" + batch + ".json",
    JSON.stringify(
      {
        batch,
        database: tmp,
        total: runs.length,
        passed: runs.filter((r) => r.status === "passed").length,
        runs,
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
});
test(
  "30轮固定种子、真实角色分工、全链路与指标隔离",
  { timeout: 900000 },
  async (t) => {
    const manager = await db.user.findUniqueOrThrow({
      where: { username: "manager" },
    });
    const before = await overview(manager, { nature: "daily" });
    for (let i = 0; i < 30; i++)
      await t.test("种子 " + (20260930 + i), async () => {
        const r = await executeRandom(batch, i, "complete");
        assert.equal(r.status, "passed");
        const steps = JSON.parse(r.steps);
        assert.ok(steps.some((s: any) => s.role === "technical"));
        assert.ok(steps.some((s: any) => s.role === "legal"));
        assert.ok(steps.some((s: any) => s.role === "finance"));
        assert.ok(steps.every((s: any) => s.role !== "admin"));
      });
    const after = await overview(manager, { nature: "daily" });
    assert.equal(after.signedCents, before.signedCents);
    assert.equal(after.pendingCents, before.pendingCents);
    const demo = await overview(manager, { nature: "scenario" });
    assert.equal(demo.pendingCents, 0);
    assert.equal(demo.stageCounts["已签"], 30);
    const repeat = await executeRandom(batch, 0);
    assert.equal(repeat.status, "passed");
    assert.equal(await db.randomRun.count({ where: { batch } }), 30);
  },
);
