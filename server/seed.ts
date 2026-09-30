import { db } from "./db";
import { hashPassword } from "./auth";
import { roles, roleNames } from "../shared/domain";
export async function seed() {
  const demo = process.env.APP_MODE === "demo";
  const password = demo ? "Demo2026!" : process.env.ADMIN_PASSWORD;
  for (const role of demo ? roles : (["admin"] as const)) {
    if (await db.user.findUnique({ where: { username: role } })) continue;
    if (!password || (!demo && password.length < 10))
      throw new Error("请设置至少10位 ADMIN_PASSWORD");
    await db.user.upsert({
      where: { username: role },
      update: {},
      create: {
        username: role,
        name: roleNames[role],
        role,
        passwordHash: hashPassword(password),
      },
    });
  }
  if (demo) {
    const owner = await db.user.findUniqueOrThrow({
      where: { username: "bd" },
    });
    const existing = await db.customer.findUnique({
      where: { name: "演示 · 诺诚生物" },
    });
    if (!existing) {
      const customer = await db.customer.create({
        data: {
          name: "演示 · 诺诚生物",
          ownerId: owner.id,
          contact: "张老师（演示）",
          source: "demo",
        },
      });
      const users = await db.user.findMany();
      await db.grant.createMany({
        data: users.map((u) => ({ customerId: customer.id, userId: u.id })),
      });
      const c = await db.businessCase.create({
        data: { customerId: customer.id, title: "肺癌 MRD 科研合作" },
      });
      await db.record.create({
        data: {
          kind: "lead",
          title: "肺癌 MRD 科研合作",
          ownerId: owner.id,
          caseId: c.id,
          data: JSON.stringify({
            company: customer.name,
            target: "肺癌 / MRD",
            source: "演示数据：非真实管线",
            notes: "请验证中心、资质与样本条件",
          }),
        },
      });
      await db.record.create({
        data: {
          kind: "capability",
          title: "MRD 检测（演示）",
          ownerId: owner.id,
          status: "approved",
          data: JSON.stringify({
            test: "MRD",
            sampleType: "血液",
            region: "全国",
            qualification: "演示，待核验",
          }),
        },
      });
    }
  }
}
if (process.argv[1]?.endsWith("seed.ts"))
  seed()
    .then(() => console.log("数据库初始化完成；演示账号说明见 README"))
    .finally(() => db.$disconnect());
