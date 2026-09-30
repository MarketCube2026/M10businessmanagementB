# BD Flow · 检测公司业务管理系统

面向检测公司BD团队的Web业务中控台，覆盖线索、机会评估、拜访、方案、报价、合同、交付、回款和知识复盘，支持PB药企合作与SR科研合作。

## 功能

- 负责人工作台：团队筛选、审批、任务分派、停滞商机、交付异常、逾期应收和经营周报。
- 客户与联系人：搜索、业务线及数据范围筛选、独立滚动列表和客户时间线。
- 业务闭环：技术/法务/财务分工审批、合同签署、交付包、样本、CAPA、结算、开票及回款。
- 多单位报价与订单、Word/PDF导出、附件解析、版本记录及审计。
- 历史PPT资料导入、来源索引及核对；需要自行提供合法授权的资料。
- 30套固定种子随机演练，日常、历史、演练数据隔离。
- 侧栏“业务模块”和“其他”支持折叠/展开。

技术栈：React、TypeScript、Vite、Express、Prisma、SQLite。

## 快速启动

需要 Node.js 24 和 npm。在项目根目录执行：

~~~powershell
npm ci
Copy-Item .env.demo.example .env
npm run db:init
npm run dev
~~~

开发界面：<http://127.0.0.1:5173>。

构建后运行：

~~~powershell
npm run build
npm start
~~~

访问 <http://127.0.0.1:3001>。默认监听所有本机网卡；局域网可使用服务器内网IP和3001端口访问。可通过 HOST、PORT 指定监听地址及端口。

### 演示账号

仅在 APP_MODE=demo 初始化时创建：

| 用户名 | 角色 |
|---|---|
| admin | 管理员 |
| manager | 主管 |
| bd | BD |
| technical | 技术 |
| delivery | 交付 |
| finance | 财务 |
| legal | 法务 |

以上演示账号初始密码为 Demo2026!。演示模式是可公开复现的测试配置，不包含任何现有部署的账号数据库。

### 日常业务模式

复制 .env.example 为 .env，设置 DATABASE_URL、APP_MODE=business 和至少10位的 ADMIN_PASSWORD，执行 npm run db:init。只初始化管理员；其他团队账号通过设置页面创建，再由主管分配客户权限。

数据库、上传附件和环境配置不在本仓库中。初始化不会覆盖已存在账号密码。

## 随机演练与测试

~~~powershell
npx tsx scripts/seed-manager-demo.ts
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
~~~

随机演练入口：/#random。负责人工作台：/#dashboard。页面内使用指南：/#guide。

测试使用独立临时数据库。随机全链路测试使用固定种子，覆盖30套PB/SR业务及正常角色分工。浏览器测试包含5种业务、负责人处理、筛选、导出和窄屏。

完整测试证据、运行时生成的报告及截图在本地生成，不随源码提交。

## 可选功能依赖

- PDF导出：Windows探测系统中文字体；其他平台设置 PDF_FONT 为中文字体绝对路径。
- PPTX解析：设置 PYTHON_PATH 为Python解释器路径，使用标准库提取原始文本、表格与图表缓存。
- 历史Excel导出使用 @oai/artifact-tool 运行时。设置 ARTIFACT_NODE，并将 scripts/artifact/node_modules 连接到已安装该工具的依赖目录。该工具不是常规npm安装的一部分；未配置时其他核心业务仍可使用。
- 真实大模型、实时药企抓取、语音转写和企业通讯尚未接入；当前辅助工具明确使用本地演示模板与规则。

## 源码范围

本仓库只包含应用代码、示例配置、合成演练和测试。不包含客户PPT、历史业务数据库、上传文件、备份、实际密码或内部数据导出，也不包含特定历史材料的整理脚本。

详细使用方法见 [负责人使用指南](负责人使用指南.md)。
