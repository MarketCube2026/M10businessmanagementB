import { test, expect, Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
const login = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Demo2026!");
  await page.getByRole("button", { name: "登录工作空间" }).click();
  await expect(
    page.getByRole("heading", { name: "你好，管理员" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "业务模块", exact: true }).click();
};
async function submitForm(page: Page) {
  await page.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}
async function action(
  page: Page,
  name: string,
  fill?: (dialog: any) => Promise<void>,
) {
  await page.getByRole("button", { name, exact: true }).click();
  const d = page.getByRole("dialog");
  if (fill) await fill(d);
  await d.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(d).toBeHidden();
}
test("浏览器完成全流程，校验持久化、筛选和导出", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page
    .getByRole("button", { name: "01 · 线索挖掘", exact: true })
    .click();
  await page.getByRole("button", { name: "新建线索", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("浏览器闭环验收");
  await page.getByLabel("客户公司", { exact: true }).fill("浏览器验收客户");
  await page.getByLabel("靶点 / 瘤种", { exact: true }).fill("MRD");
  await submitForm(page);
  await action(page, "转为商机");
  await page.getByRole("button", { name: /^浏览器闭环验收.*机会评估/ }).click();
  await action(page, "决定跟进", (d) =>
    d.getByLabel("操作说明 / 审核意见").fill("项目匹配，推进合作"),
  );
  await page.getByRole("button", { name: "创建客户拜访", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("客户需求拜访");
  await page.getByLabel("联系人", { exact: true }).fill("陈老师");
  await page.getByLabel("计划日期", { exact: true }).fill("2026-10-15");
  await page
    .getByLabel("SPIN 纪要 / 原始记录", { exact: true })
    .fill("客户需要MRD检测，计划10份样本");
  await page.getByLabel("下一步行动", { exact: true }).fill("提交技术方案");
  await submitForm(page);
  await page.getByRole("button", { name: "访后纪要", exact: true }).click();
  await page.getByRole("button", { name: "生成待确认结果" }).click();
  await expect(page.getByLabel("工具生成结果")).toBeVisible();
  await page.getByRole("button", { name: "确认写入正文" }).click();
  await expect(
    page.getByText("访后纪要 · 已确认", { exact: true }),
  ).toBeVisible();
  await action(page, "确认纪要并创建待办");
  await expect(
    page.getByRole("button", { name: /提交技术方案/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看前置记录 →" }).click();
  await page.getByRole("button", { name: "创建商业提案", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("MRD标准商业提案");
  await page.getByLabel("检测项目", { exact: true }).fill("MRD");
  await page.getByLabel("样本数", { exact: true }).fill("10");
  await page.getByLabel("中心数", { exact: true }).fill("1");
  await page
    .getByLabel("背景、目标、设计、交付物、时间线、报价说明", { exact: true })
    .fill("科研背景，目标完成检测，交付报告，周期30天。");
  await submitForm(page);
  await action(page, "提交审核");
  await action(page, "退回修改", (d) =>
    d.getByLabel("操作说明 / 审核意见").fill("补充复核说明"),
  );
  await action(page, "提交审核");
  await action(page, "审核通过");
  await page.getByRole("button", { name: "创建成本报价", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("MRD报价");
  await page.getByLabel("单价（元）", { exact: true }).fill("1000");
  await page.getByLabel("单位成本（元）", { exact: true }).fill("400");
  await submitForm(page);
  await expect(page.getByText("60.0%", { exact: true })).toBeVisible();
  await action(page, "提交审核");
  await action(page, "审核通过");
  await page.getByRole("button", { name: "创建合同", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("科研合同");
  await page
    .getByLabel("合同条款 / 法务意见", { exact: true })
    .fill("付款条件分期；责任上限按合同金额；IP归属按约定。");
  await submitForm(page);
  await action(page, "提交审核");
  await action(page, "审核通过");
  await action(page, "登记签署", async (d) => {
    await d.getByLabel("签署人", { exact: true }).fill("授权代表");
    await d.getByLabel("签署日期", { exact: true }).fill("2026-09-30");
  });
  await page.getByRole("button", { name: "创建交付项目", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("MRD交付项目");
  await page.getByLabel("计划日期", { exact: true }).fill("2026-12-31");
  await submitForm(page);
  const projectUrl = page.url();
  await page.getByRole("button", { name: "创建样本", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("样本001");
  await page.getByLabel("脱敏样本编号", { exact: true }).fill("S001");
  await page.getByLabel("样本类型", { exact: true }).fill("血液");
  await submitForm(page);
  await action(page, "登记异常", (d) =>
    d.getByLabel("操作说明 / 审核意见").fill("运输异常"),
  );
  await action(page, "完成 / 验收", (d) =>
    d.getByLabel("操作说明 / 审核意见").fill("重新采样并通过质控"),
  );
  await page.goto(projectUrl);
  await page.getByRole("button", { name: "创建里程碑", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("报告验收");
  await page.getByLabel("计划日期", { exact: true }).fill("2026-12-01");
  await submitForm(page);
  await action(page, "完成 / 验收");
  await page.goto(projectUrl);
  await action(page, "完成 / 验收");
  await page.getByRole("button", { name: "创建应收计划", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("项目尾款");
  await page.getByLabel("应收金额（元）", { exact: true }).fill("10000");
  await page.getByLabel("计划日期", { exact: true }).fill("2026-12-31");
  await submitForm(page);
  await action(page, "确认到账", async (d) => {
    await d.getByLabel("到账金额（元）", { exact: true }).fill("4000");
    await d.getByLabel("银行流水号", { exact: true }).fill("PW-1");
  });
  await expect(page.getByText("部分到账", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("部分到账", { exact: true })).toBeVisible();
  await action(page, "确认到账", async (d) => {
    await d.getByLabel("到账金额（元）", { exact: true }).fill("6000");
    await d.getByLabel("银行流水号", { exact: true }).fill("PW-2");
  });
  await expect(page.getByText("已结清", { exact: true })).toBeVisible();
  await page.goto(projectUrl);
  await page.getByRole("button", { name: "创建项目复盘", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("MRD项目复盘");
  await page
    .getByLabel("成功点、失败点、改进建议、可复用模板", { exact: true })
    .fill("成功点：交付验收；改进：强化运输；模板：样本质控。");
  await submitForm(page);
  await action(page, "提交审核");
  await action(page, "审核通过");
  await action(page, "确认脱敏并发布");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "DOCX", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.docx$/);
  const businessGroup=page.getByRole("button",{name:"业务模块",exact:true});
  if(await businessGroup.getAttribute("aria-expanded")==="false")await businessGroup.click();
  await page
    .getByRole("button", { name: "09 · 知识沉淀", exact: true })
    .click();
  await page.getByRole("button", { name: "项目复盘", exact: true }).click();
  await page.getByLabel("搜索标题", { exact: true }).fill("MRD项目复盘");
  await expect(
    page.getByRole("button", { name: "MRD项目复盘", exact: true }),
  ).toBeVisible();
  mkdirSync("output/playwright", { recursive: true });
  await page.getByRole("button", { name: "业务工作台", exact: true }).click();
  await page.screenshot({
    path: "output/playwright/dashboard.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("窄屏操作和取消表单", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/#leads");
  await page.getByRole("button", { name: "新建线索", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("取消记录");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByLabel("搜索标题", { exact: true }).fill("取消记录");
  await expect(
    page.getByText("暂无记录。可新建业务，或从上一环节转换。"),
  ).toBeVisible();
  await page.goto("/#dashboard");
  await expect(
    page.getByRole("heading", { name: "你好，管理员" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "output/playwright/mobile.png",
    fullPage: true,
  });
});
