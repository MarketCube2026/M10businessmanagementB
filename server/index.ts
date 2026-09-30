import { app } from "./app";
import { db } from "./db";
await db.aiTask.updateMany({
  where: { status: { in: ["queued", "processing"] } },
  data: { status: "failed", error: "服务已重启，请重试任务" },
});
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () =>
  console.log("BD Flow listening on http://" + host + ":" + port),
);
