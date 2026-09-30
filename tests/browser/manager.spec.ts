import { test, expect, Page } from "@playwright/test";
import {financialWorkflow} from './financial-helper';
async function role(page: Page, username: string) {
  const response = await page.request.post("/api/v1/login", {
    data: { username, password: "Demo2026!" },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
}
async function create(
  page: Page,
  button: string,
  title: string,
  values: Record<string, string>,
) {
  await page.getByRole("button", { name: button, exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("标题", { exact: true }).fill(title);
  for (const [k, v] of Object.entries(values)){
    const field=d.getByLabel(k,{exact:true});
    if(await field.evaluate(el=>el.tagName==='SELECT'))await field.selectOption(v);else await field.fill(v);
  }
  await d.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(d).toBeHidden();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}
async function action(
  page: Page,
  name: string,
  values: Record<string, string> = {},
) {
  await page.getByRole("button", { name, exact: true }).click();
  const d = page.getByRole("dialog");
  for (const [k, v] of Object.entries(values))
    await d.getByLabel(k, { exact: true }).fill(v);
  await d.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(d).toBeHidden();
}
async function approval(page: Page, author: string, reviewer: string) {
  await role(page, author);
  await action(page, "提交审核");
  await role(page, reviewer);
  await action(page, "审核通过");
}
async function workflow(
  page: Page,
  kind: "交付包" | "稽查整改",
  title: string,
) {
  await page.getByRole("button", { name: "新增" + kind, exact: true }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("名称", { exact: true }).fill(title);
  await d
    .getByLabel(kind === "交付包" ? "交付类型 / 分支" : "问题及依据", {
      exact: true,
    })
    .fill(title);
  await d.getByLabel("责任人 / 责任部门", { exact: true }).fill("模拟交付组");
  await d.getByLabel("计划完成日期", { exact: true }).fill("2026-12-31");
  await d
    .getByLabel(
      kind === "交付包"
        ? "交付范围、图表清单、版本及验收要求"
        : "整改要求与复核证据",
      { exact: true },
    )
    .fill("版本与证据完整");
  await d.getByRole("button", { name: "保存草稿" }).click();
  await expect(d).toBeHidden();
  const open = async () => {
    const summary = page.locator("summary").filter({ hasText: title }).first();
    await summary.click();
    return summary.locator("..");
  };
  let container = await open();
  await container
    .getByRole("button", { name: "提交审核", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.getByLabel("审核、验收或整改说明").fill("提交材料");
  await d.getByRole("button", { name: "确认操作" }).click();
  await expect(d).toBeHidden();
  await role(page, "technical");
  container = await open();
  await container.getByRole("button", { name: "通过", exact: true }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("审核、验收或整改说明").fill("复核通过");
  await d.getByRole("button", { name: "确认操作" }).click();
  await expect(d).toBeHidden();
  await container
    .getByRole("button", { name: "验收 / 复核关闭", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.getByLabel("审核、验收或整改说明").fill("证据完整、独立复核完成");
  await d.getByRole("button", { name: "确认操作" }).click();
  await expect(d).toBeHidden();
  await role(page, "delivery");
}
for (const type of ["CTA", "CDx", "分析文章", "稽查整改", "SR"]) {
  test("真实角色浏览器完整链路 · " + type, async ({ page }) => {
    test.setTimeout(180000);
    await page.goto("/");
    await role(page, "bd");
    // Only customer authorization is provisioned by manager; all business transitions below use UI.
    const c = await page.request.post("/api/v1/customers", {
      data: { name: "浏览器团队 " + type, contact: "模拟联系人" },
    });
    expect(c.ok()).toBeTruthy();
    const customer = await c.json();
    const users = await (await page.request.get("/api/v1/users")).json();
    await role(page, "manager");
    expect(
      (
        await page.request.post(
          "/api/v1/customers/" + customer.id + "/grants",
          { data: { userIds: users.map((u: any) => u.id) } },
        )
      ).ok(),
    ).toBeTruthy();
    await role(page, "bd");
    await page.goto("/#leads");
    await create(page, "新建线索", "团队 " + type + " 线索", {
      客户公司: customer.name,
      "靶点 / 瘤种": "NGS",
    });
    await action(page, "转为商机");
    await page
      .getByRole("button", {
        name: new RegExp("^团队 " + type + " 线索.*机会评估"),
      })
      .click();
    await action(page, "决定跟进", {
      "操作说明 / 审核意见": "技术能力匹配，推进合作",
    });
    const oppURL = page.url();
    await create(page, "创建客户拜访", "团队 " + type + " 拜访", {
      联系人: "模拟联系人",
      计划日期: "2026-10-15",
      "SPIN 纪要 / 原始记录": "明确样本与报告要求",
      下一步行动: "提交方案",
    });
    await action(page, "确认纪要并创建待办");
    await page.goto(oppURL);
    await create(page, "创建商业提案", "团队 " + type + " 提案", {
      检测项目: "NGS",
      样本数: "10",
      中心数: "2",
      "背景、目标、设计、交付物、时间线、报价说明":
        "模拟研究背景，目标、设计、报告、里程碑明确",
    });
    await approval(page, "bd", "technical");
    await role(page, "bd");
    await create(page, "创建成本报价", "团队 " + type + " 报价", {
      "单价（元）": "1000",
    });
    await approval(page, "bd", "finance");
    await role(page, "bd");
    await create(page, "创建合同", "团队 " + type + " 合同", {
      "合同条款 / 法务意见": "付款、IP、数据、责任条款明确",
      ...(type==='SR'?{"合同类型":"framework"}:{}),
    });
    await approval(page, "bd", "legal");
    await role(page, "bd");
    await action(page, "登记签署", {
      签署人: "模拟授权人",
      签署日期: "2026-09-30",
    });
    await role(page, "delivery");
    await create(page, "创建交付项目", "团队 " + type + " 项目", {
      计划日期: "2026-12-31",
    });
    const projectURL = page.url();
    if (type === "CDx" || type === "分析文章") {
      await workflow(page, "交付包", type + "分支一");
      await workflow(page, "交付包", type + "分支二");
    }
    if (type === "稽查整改") await workflow(page, "稽查整改", "运输记录缺失");
    await create(page, "创建样本", "团队 " + type + " 样本", {
      脱敏样本编号: "PW-" + type,
      样本类型: "血液",
    });
    await action(page, "完成 / 验收");
    await page.goto(projectURL);
    await create(page, "创建里程碑", "团队 " + type + " 里程碑", {
      计划日期: "2026-12-31",
    });
    await action(page, "完成 / 验收");
    await page.goto(projectURL);
    await action(page, "完成 / 验收");
    await role(page, "finance");
    if(type==='SR')await financialWorkflow(page);
    else await create(page, "创建应收计划", "团队 " + type + " 应收", {
      "应收金额（元）": "10000",
      计划日期: "2026-12-31",
    });
    await action(page, "确认到账", {
      "到账金额（元）": "4000",
      银行流水号: "PW-" + type + "-1",
    });
    await action(page, "确认到账", {
      "到账金额（元）": "6000",
      银行流水号: "PW-" + type + "-2",
    });
    await expect(
      page.getByText("已结清", { exact: true }).first(),
    ).toBeVisible();
    await page.goto(projectURL);
    await role(page, "bd");
    await create(page, "创建项目复盘", "团队 " + type + " 复盘", {
      "成功点、失败点、改进建议、可复用模板":
        "流程完整；下一次提前核验样本和资金计划",
    });
    await approval(page, "bd", "manager");
    await role(page, "bd");
    await action(page, "确认脱敏并发布");
  });
}
test("负责人筛选、风险处理、任务分派与周报", async ({ page }) => {
  await page.goto("/");
  await role(page, "manager");
  await page.goto("/#dashboard");
  await page.getByLabel("数据范围", { exact: true }).selectOption("scenario");
  await page.getByLabel("业务线筛选", { exact: true }).selectOption("SR");
  await expect(
    page.getByText("当前查看演练数据，所有模拟金额和审批不计入日常经营指标。"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "安排处理", exact: true })
    .first()
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel("负责人", { exact: true })
    .selectOption({ label: "财务 · 财务" });
  await d.getByLabel("截止日期", { exact: true }).fill("2026-12-31");
  await d
    .getByLabel("处理说明", { exact: true })
    .fill("安排财务复核并跟进催款");
  await d.getByRole("button", { name: "确认处理" }).click();
  await expect(d).toBeHidden();
  await expect(page.getByText(/条件仍存在，继续提醒/).first()).toBeVisible();
  await page.getByRole("button", { name: "生成经营周报", exact: true }).click();
  const report = page.getByRole("dialog");
  await expect(report.getByLabel("周报正文")).toContainText("业务周报");
  await report.getByLabel("周报正文").fill("周报：已检查SR业务与回款风险。");
  await report.getByRole("button", { name: "保存修改" }).click();
  const download = page.waitForEvent("download");
  await report.getByRole("link", { name: "导出已保存Word" }).click();
  expect((await download).suggestedFilename()).toMatch(/docx$/);
  await report.getByRole("button", { name: "关闭" }).click();
  await page.getByLabel("业务线筛选", { exact: true }).selectOption("PB");
  await page.getByRole("button", { name: /^待办 / }).click();
  await page.getByRole("button", { name: "分派", exact: true }).first().click();
  await page
    .getByRole("dialog")
    .getByLabel("负责人", { exact: true })
    .selectOption({ label: "技术 · 技术" });
  await page.getByRole("dialog").getByLabel("处理说明").fill("技术确认下一步");
  await page.getByRole("button", { name: "确认处理" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#dashboard");
  await expect(page.getByRole("heading", { name: "你好，主管" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
});
