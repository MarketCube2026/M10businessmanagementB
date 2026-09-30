import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
const folder = mkdtempSync(path.join(tmpdir(), "bd-flow-browser-"));
process.env.DATABASE_URL =
  "file:" + path.join(folder, "test.db").replaceAll("\\", "/");
process.env.APP_MODE = "demo";
process.env.STORAGE_DIR = path.join(folder, "storage");
new DatabaseSync(path.join(folder, "test.db")).close();
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env: process.env, stdio: "pipe" },
);
const { seed } = await import("../server/seed");
await seed();
const { app } = await import("../server/app");
const {executeRandom}=await import('../server/random-flow');
for(const [i,target] of [[12,'approval'],[18,'delivery'],[24,'partial']] as const)await executeRandom('browser-manager',i,target);
app.listen(3188, "127.0.0.1");
