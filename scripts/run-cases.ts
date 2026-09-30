import { db } from "../server/db";
import { initializeScenarios, runScenario } from "../server/scenarios";
import { exportHistory } from "../server/export-history";
import { promises as fs } from "node:fs";
await initializeScenarios();
const user = await db.user.findUniqueOrThrow({ where: { username: "admin" } });
for (const s of await db.scenario.findMany({ orderBy: { code: "asc" } })) {
  if (s.status === "ready") {
    await runScenario(s.id, user);
    console.log(s.code + " passed");
  } else console.log(s.code + " " + s.status);
}
const results = await db.scenario.findMany();
await fs.mkdir("outputs/history", { recursive: true });
await fs.writeFile(
  "outputs/history/case-report.json",
  JSON.stringify(results, null, 2),
);
console.log(await exportHistory(true));
await db.$disconnect();
