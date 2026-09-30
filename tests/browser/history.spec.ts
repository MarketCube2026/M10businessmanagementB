import {test,expect} from '@playwright/test';
test('历史资料入口、权限提示、案例列表和周期表单',async({page})=>{
 await page.goto('/');await page.getByLabel('用户名',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill('Demo2026!');await page.getByRole('button',{name:'登录工作空间'}).click();
 await page.getByRole('button',{name:'其他',exact:true}).click();
 await page.getByRole('button',{name:'历史业务核对',exact:true}).click();await expect(page.getByRole('heading',{name:'历史业务与资料核对'})).toBeVisible();
 await page.getByLabel('检索来源正文').fill('JMT101');await page.getByLabel('业务线',{exact:true}).selectOption('PB');await expect(page.getByRole('link',{name:'导出最新核对表'})).toBeVisible();
 await page.getByRole('button',{name:'五大案例演练',exact:true}).click();await expect(page.getByRole('heading',{name:'业务案例演练'})).toBeVisible();
 await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByLabel('用户名',{exact:true}).fill('bd');await page.getByLabel('密码',{exact:true}).fill('Demo2026!');await page.getByRole('button',{name:'登录工作空间'}).click();await page.goto('/#history');await expect(page.getByRole('alert')).toContainText('仅管理员');
});
