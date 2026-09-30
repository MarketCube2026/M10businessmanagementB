import "dotenv/config";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const url = process.env.DATABASE_URL;
if (!url?.startsWith("file:")) throw new Error("请配置 SQLite DATABASE_URL");
const target = path.resolve("prisma", url.slice(5));
if (process.env.APP_MODE !== "demo" && path.basename(target) === "demo.db")
  throw new Error("日常业务模式不可使用 demo.db");
mkdirSync(path.dirname(target), { recursive: true });
const db = new DatabaseSync(target);
db.close();
