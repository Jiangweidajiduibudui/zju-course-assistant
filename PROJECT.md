# PROJECT.md · AI 协作入口（所有组员的 AI 必读）

- **版本**:v1.0(2026-07-09,随脚手架建立)
- **用途**:本文件是每位组员把任务交给 AI(Claude/Cursor/Windsurf 等)时的**第一份输入**。它告诉 AI:这个项目是什么、铁律是什么、你负责的模块边界在哪里、做完之后怎样才算成功。
- **接入方式**:把本文件加入你的 AI 工具的项目上下文(例如在本地 CLAUDE.md/AGENTS.md/.cursorrules 里写一行"先完整阅读 PROJECT.md 并遵守其中硬规则"——这些本地配置文件已被 .gitignore,内容自便,但**必须引用本文件**)。
- **权威边界**:本文件只做导航与约束汇总,**不复制产品事实**。任何与 docs/01–08 冲突之处,以 docs 为准并视为本文件的 bug。

---

## 1. 项目是什么

面向浙江大学第一、二轮概率选课的 **advise-only Web 网站**:用户导入课程/志愿数据、配置学分上限与偏好,系统结合 chalaoshi 教师评价数据,通过**集中确定性选课模型(`selection-model`)+ 两阶段 LLM 排序**生成可解释、可手动录入 zdbk 的志愿方案与预期课表。

- **差异化**(vs Lazuli/Quantum,见 docs/01 §3):它们停在"信息展示"(chalaoshi 只当一个评分数字);我们进入"决策辅助"(按课均绩 + 近五年评价摘要 + 组内软排序 + 合法方案求解)。
- **绝对不做**:写入 zdbk(选课/退选/调序)、代登录、注入 zdbk 页面、展示未校准的录取概率。

## 2. 文档地图与阅读协议

| 文档 | 权威范围(一句话) |
|---|---|
| [README.md](README.md) | 仓库结构、文档地图、当前关键约束 |
| [docs/01-产品需求文档PRD.md](docs/01-产品需求文档PRD.md) | 用户、边界、FR-1~FR-12 与 AC 验收标准、降级行为、文案规范 |
| [docs/02-浙大选课规则核对档.md](docs/02-浙大选课规则核对档.md) | 选课规则唯一权威;每条结论带核验状态 |
| [docs/03-数据接口契约.md](docs/03-数据接口契约.md) | zdbk/chalaoshi 端点与字段语义、只读白名单、写接口黑名单 |
| [docs/04-AI与技术架构设计.md](docs/04-AI与技术架构设计.md) | 架构、状态模型、求解流水线、LLM I/O Schema、隐私安全 |
| [docs/05-验收与测试计划.md](docs/05-验收与测试计划.md) | 各层测试必测项、性质测试、LLM 评测集、beta 门槛 G0–G8 |
| [docs/06-决策记录与版本变更.md](docs/06-决策记录与版本变更.md) | 全部决策 D01–D42、事实修正 F-01~F-10、开放问题 O-Q |
| [docs/07-技术栈与版本基线.md](docs/07-技术栈与版本基线.md) | 精确版本锁定、Context7 ID、易错 API 基线、升级规则 |
| [docs/08-开发实施计划.md](docs/08-开发实施计划.md) | 模块拆分、六人分工、Task 0–7 门禁、目录职责 |

**AI 阅读协议**:

1. 新会话最少读:本文件 → docs/08(你的模块章节)→ docs/07(你要碰的库)→ docs/01 中对应 FR/AC。
2. **单一事实源**:同一事实只在一份文档维护,引用用编号(D05、AC-6.1、G2、F-10),不要复述内容——复述会随上游更新而腐烂。
3. **决策制度**:所有产品/架构决策以 docs/06 的 D 编号为准。推翻任何有效决策必须经产品负责人,并在 06 追加新 D 条目。AI 不得"顺手"做出新决策。
4. **开放问题(06 §4 的 O-Q)不得由 AI 自行补全**——遇到依赖 O-Q 的实现,停下来向负责人报告,不要发明答案。
5. 文档说"待核验"的字段(如 zdbk `rs`/`yxrs`/学分复合字段),**不能凭字段名猜语义**(F-10)。

## 3. 硬规则(每个 AI 无条件遵守)

> 违反任何一条 = PR 直接拒绝。规则后括号是权威出处。

- **H1 · advise-only 铁律**:永不调用 zdbk 业务写接口;Demo 阶段代码里根本不出现 zdbk 请求、zdbk Cookie/密码/token 处理(D31、G2)。静态守门:`pnpm verify:no-zdbk-write`;运行时守门:E2E 网络断言。
- **H2 · 契约与决策不可私改**:`src/shared/contracts/` 的公共 Schema、错误码、日志字段,改动必须负责人批准(docs/08 §9.1);产品决策变更走 06 追加 D 条目。
- **H3 · 风险数值冻结**:不实现、不展示任何录取概率数值、"稳/悬/危"档位或占位风险算法;`estimateRisk` 恒返回 `{status:"unavailable"}`,UI 恒显"暂不可评估"(D01、D30、AC-6.5)。解冻只能来自 06 的新决策。
- **H4 · 硬约束逻辑只住在 selection-model**:志愿组、考试冲突、学分上限、缺失字段、Top10、投影、终校验全部在 `src/domain/selection-model/`;前端只渲染,后端只编排,**任何模块不得复制一份"简化版规则"**(D36)。
- **H5 · LLM 输出永不直接触达状态**:四类 LLM 任务全部固定 JSON Schema(`src/shared/contracts/llm.ts`);校验失败即任务失败,不从自然语言猜测结果(D25);一切方案必须过 `finalValidate` 才能应用(D27 原子性);评论摘要是纯展示,无任何状态修改通道(D24)。
- **H6 · key 与隐私**:LLM key 只随单次请求进入后端内存——不落库、不写日志、不进提示词(D40);日志禁录清单见 `src/server/modules/diagnostics/logger.ts` 头注释(D42);提示词装配用字段白名单,姓名/学号/Cookie/token/key 永不进入(D04)。
- **H7 · 依赖治理**:`package.json` 只用精确版本(禁 `^`/`~`/`latest`/beta/canary);改第三方库代码前查 docs/07 对应 Context7 ID;业务 PR 不顺手升级依赖;新增依赖必须先证明现有能力不够(D34、docs/07 §5–6)。
- **H8 · 数据合规**:不复制 Lazuli(GPLv3)或校内 Quantum(保留所有权利)代码(D02);真实 chalaoshi 评论不进仓库,合成 fixture 必须 `synthetic:true`(D41);chalaoshi 展示必须带来源链接与抓取时间(D03)。
- **H9 · 不伪装**:不用 mock 结果冒充真实功能;未实现的领域函数抛 `NotImplementedError`,未实现的端点返回 501 + `COMMON_NOT_IMPLEMENTED`;未完成页面藏在正式导航外(docs/08 §2、§3.2)。降级路径必须显式标记(演示数据/暂无/失败原因),绝不假装成功(AC-12.1)。
- **H10 · 依赖方向**:`client → shared/domain`;`server → shared/domain`;`domain` 禁止 import React/Fastify/Dexie/pg/cheerio 等一切框架与 IO;`client` 禁止 import `server`(docs/07 §3)。守门:`pnpm verify:no-zdbk-write` 附带方向检查 + tsconfig 划分。
- **H11 · 不臆断字段语义**:docs/03 标记"待核验"的字段只能原样透传(`unverifiedRaw`),不得参与计算或按名称解释(F-10);课程分类动态读取,不硬编码(F-05)。
- **H12 · 对外文案**:禁止"真实命中率/最优课表/保证正确";一律用 docs/01 §8 规定的表述;结果展示必须附依据、数据时间、不确定性说明(D07)。

## 4. 架构与数据流

```text
React + Vite Web(src/client)
  待筛选志愿页 / 预期课表页 / 导入导出 / 设置(隐私同意+key 向导+学分上限)
  Dexie/IndexedDB = 用户持久状态唯一事实源(session/映射/端点配置)
        │ 同源 HTTPS JSON(/api;开发期 vite proxy)
        ▼
Fastify API(src/server/modules/*)
  import      JSON 校验、规范化、错误定位
  chalaoshi   限频抓取 + L1(LRU)/L2(PostgreSQL) 缓存 + 合成 seed 降级
  llm-gateway 同源 OpenAI 兼容代理 + SSRF 防护 + 结构化输出校验
  planner     编排两阶段 LLM 与 selection-model(流水线①–⑦)
  diagnostics log.v1 JSON Lines + 本地诊断导出
        │ 纯函数调用
        ▼
selection-model(src/domain,纯 TypeScript)
  时间槽归一化 / 志愿组构造 / 可排性判定 / Top10 枚举 / 投影 / 终校验 / 最小扰动
```

**推荐生成流水线**(docs/04 §3.2,阶段号全仓库通用):
① 输入装配(刷新数据,D20)→ ② 硬过滤(selection-model)→ ③ LLM 组内排序 → ④ Top10 枚举(selection-model)→ ⑤ LLM 方案比较 → ⑥ 确定性终校验 → ⑦ 原子应用(失败/取消不改状态,旧代际结果丢弃,D27)。

## 5. 模块卡片(定位 / 输入 / 输出 / 边界 / 成功判据)

> 负责人分工见 docs/08 §9。"成功判据"= 该模块的 PR 能合并的最低测试证据;全局门禁见 §7。

### 5.1 `src/shared/contracts/` — 契约(负责人)

- **定位**:前后端与 LLM Schema 的单一事实源(Zod 4);类型全部 `z.infer` 导出。
- **输入**:docs/01–05 的字段语义与 AC;各模块的契约需求。
- **输出**:`catalog/baseline/pool/rules/plan/session/chalaoshi/llm` Schema、`ErrorCodes`、`log.v1`。
- **与其他模块关系**:被所有模块 import;不 import 任何模块。
- **边界**:禁止出现 React/Fastify/Dexie/pg;禁止业务逻辑(纯 Schema + 枚举)。
- **成功判据**:`tests/contract/*` 全绿(fixture 可解析、错误码唯一、log.v1 稳定);Schema 改动经负责人批准。

### 5.2 `src/domain/selection-model/` — 选课数学模型(组员 C)

- **定位**:全部硬约束与组合数学的唯一实现地(D36);纯函数、可单测、框架无关。
- **输入**:`SolverInput`(sections 全集、baseline、pool、rules、锁定集)+ 阶段③的 `GroupOrdering[]`。
- **输出**:`EnumerationResult`(Top10 `CandidatePlan[]` 或 无解+`ConflictReport[]`)、`TimetableProjection`、`ValidationResult`、`PlanChangeSet`。
- **与其他模块关系**:被 planner 调用(阶段②④⑥);被 client 只读消费其输出类型。
- **边界**:禁止 LLM 调用、数据库、网络、浏览器状态;`estimateRisk` 冻结(H3)。
- **成功判据**:Task 1 门禁——`tests/domain/` 单测覆盖课程组优先/时间槽失效/考试硬冲突/考试未知/学分未知/学分上限/Top10/投影;`properties.test.ts` 十条性质(docs/05 §3.1)用 fast-check 点亮;所有冲突样例有稳定错误码;"终校验永不接受非法方案"。

### 5.3 `src/server/modules/import/` — 导入与课程池(组员 A)

- **定位**:不信任任何用户输入的 JSON 校验、规范化、错误逐条定位。
- **输入**:用户上传的 catalog/baseline/export JSON 文本;合成 fixture。
- **输出**:规范化 `Catalog`/摘要,或 `ImportIssue[]`(路径+错误码);导出 `export.v1`。
- **与其他模块关系**:输出经 client 写入 Dexie(服务端不持久化用户数据,D04);为 E 的导入导出页提供 API。
- **边界**:不登录 zdbk、不解析未授权页面;首版不做 Excel/OCR/HTML 粘贴。
- **成功判据**:Task 0/2 门禁——`tests/server/import.test.ts` + invalid fixture 全绿;导入→修改→导出→再导入一致;缺失硬字段正确标记(供待选池滞留)。

### 5.4 `src/server/modules/chalaoshi/` — 评价数据(组员 B)

- **定位**:chalaoshi 公开资源的限频抓取、解析(cheerio)、两级缓存、seed 降级、来源标记。
- **输入**:docs/03 §3.1 的三类上游(search.json / 教师详情 HTML / 评论 HTML);`.env` 可配域名。
- **输出**:`TeacherIndexEntry[]`、`TeacherDetail`、`CommentBatch`——一律携带 `sourceMeta{sourceUrl,fetchedAt,cacheState}`。
- **与其他模块关系**:为 client 教师卡与 planner 阶段①提供数据;L2 用 `sql/migrations` 的表。
- **边界**:只抓白名单资源;解析失败显式抛错,不用错位数据污染缓存;真实评论不进仓库(D41);抓取失败是常态场景,必须走 seed/缓存降级而不是报死。
- **成功判据**:Task 3 门禁——parser fixture tests、缓存命中/过期/single-flight 测试、抓取失败降级测试;UI 侧 seed 数据被标"演示数据"。

### 5.5 `src/server/modules/llm-gateway/` — LLM 网关(组员 D)

- **定位**:唯一的 LLM 出口:同源 OpenAI 兼容代理 + SSRF 防护 + 能力检测 + 结构化输出校验。
- **输入**:client 传来的(endpoint 三件套 + 任务载荷);契约输入(志愿组/Top10/评论要点/偏好)。
- **输出**:`llm.ts` 五类 Schema 校验后的结构化结果;失败 = 稳定错误码(`LLM_*`),无部分结果。
- **与其他模块关系**:被 planner 调用(阶段③⑤)、被 client 评论摘要/偏好/解释功能调用。
- **边界**:key 零持久化零日志(H6);仅 HTTPS + 私网阻断 + DNS/重定向复核(D40);LLM 返回的 ID 必须属于输入集合,越界即 `LLM_ID_OUT_OF_INPUT`;无 key 时不服务推荐类任务(D21)。
- **成功判据**:Task 4 门禁——`tests/server/ssrf.test.ts` 全矩阵点亮;Schema 校验失败测试;无 key 降级测试;固定评测集(docs/05 §4)对代表性端点通过。

### 5.6 `src/server/modules/planner/` — 编排(负责人,依赖 C/D)

- **定位**:把流水线①–⑦串起来的唯一地方;持有 generationId 代际逻辑。
- **输入**:client 的生成/重排请求(含 session 状态快照 + AbortSignal)。
- **输出**:终校验通过的一份完整方案 + 变更集 + 过程进度;或冲突来源/稳定错误码。
- **与其他模块关系**:调用 chalaoshi(①)、selection-model(②④⑥)、llm-gateway(③⑤)。
- **边界**:不复制任何领域校验(H4);取消/失败/校验不过 → 零状态变更;旧代际结果丢弃(D27)。
- **成功判据**:Task 4/6 门禁——编排层集成测试(成功/失败/取消/超时/并发);E2E 主流程绿。

### 5.7 `src/server/modules/diagnostics/` — 日志与诊断(负责人)

- **定位**:log.v1 JSON Lines 输出与用户主动触发的诊断导出。
- **输入**:各模块的 `logEvent()` 调用。
- **输出**:stdout JSON Lines;`/api/diagnostics/export`。
- **边界**:禁录清单(H6);默认零远程遥测。
- **成功判据**:Task 6 门禁——日志导出敏感字段扫描通过(docs/05 §5.1)。

### 5.8 `src/client/` — Web 工作台(组员 E)

- **定位**:zdbk 心智模型的四个 feature 页 + 应用外壳 + Dexie 持久化。
  - `features/import-export`:内置 demo/JSON 导入/错误定位展示/导出(与 A 对接);
  - `features/wish-plan`:课程组/时间槽组分块、上下移顺位、锁定、失效原因(docs/08 §8.1);
  - `features/timetable-projection`:首选投影 + 备选堆叠 + "为什么这样排"(docs/08 §8.2);
  - `features/settings`:隐私同意闸门(ConsentGate)、key 向导(FR-10)、学分上限、数据清除;
  - `app/`:外壳、queryClient、db(Dexie Schema 版本链)。
- **输入**:同源 `/api/*` 响应(TanStack Query)+ Dexie 状态(useLiveQuery)。
- **输出**:用户可见状态;一切"改状态"操作先展示结构化改动、确认后生效(FR-9)。
- **边界**:不直连外部服务(H10);不自行计算志愿合法性/冲突(H4);互斥备选不得渲染成同时上课;未同意隐私前无功能可用(AC-11.1)。
- **成功判据**:Task 2/5 门禁——Playwright 主流程、锁定后重新优化不动锁定组、失效解释可见、键盘可用性、数据清除有效(AC-11.3)。

### 5.9 `tests/` + `scripts/` + `sql/` — 质量与守门(全员,负责人收口)

- `tests/contract|domain|server`:Vitest 4 + fast-check 4;`tests/e2e`:Playwright(合成 fixture + mock 上游)。
- `scripts/verify-no-zdbk-write.ts`:zdbk 特征 + 依赖方向静态扫描;`scripts/verify-doc-links.ts`:文档链接检查。
- `sql/migrations/`:有序只追加;当前仅公共缓存表,**永不出现用户数据表**(除非 06 新增决策)。

## 6. 目录结构(与 docs/08 §5 一致)

```text
src/
├── shared/contracts/     # Zod Schema、DTO、错误码、log.v1(负责人)
├── domain/selection-model/  # 纯 TS 选课数学模型(组员 C)
├── server/               # Fastify:app.ts 装配 + modules/{import,chalaoshi,llm-gateway,planner,diagnostics}
└── client/               # React:app/ + features/{import-export,wish-plan,timetable-projection,settings} + lib/
tests/{contract,domain,server,e2e}/
scripts/                  # verify-no-zdbk-write / verify-doc-links
sql/migrations/           # PostgreSQL 公共缓存(L2)
docs/fixtures/            # 合成 fixture(synthetic:true)+ invalid-cases/
```

**导入路径约定**:`shared`/`domain`/`server` 内相对导入写 `.js` 扩展名(NodeNext 要求;Vite 端同样兼容);client 内部组件可省略扩展名;暂不使用路径别名(避免 tsc/vite/tsx 三方配置漂移,新增须负责人决策)。

## 7. 开发顺序与门禁(docs/08 §10 摘要)

| Task | 内容 | 门禁(必须全过才进下一步) |
|---|---|---|
| 0 | 契约 + 合成 fixture(负责人) | 契约测试证明 fixture 可解析;无真实评论/学号/姓名/Cookie/key |
| 1 | selection-model 先行(C) | 冲突样例全有稳定错误码;性质测试"终校验永不接受非法方案" |
| 2 | 导入、池与本地状态(A+E) | 导入→修改→导出→再导入一致;缺失硬字段留在待选池 |
| 3 | chalaoshi + seed 降级(B) | 网络失败 UI 不崩;seed 标记演示数据;真实评论不进仓库 |
| 4 | LLM 网关 + 两阶段 AI(D+C+负责人) | 无 key 不生成推荐;SSRF 样例被拒;LLM 返回不存在 ID 不改状态 |
| 5 | zdbk-like 工作台(E) | 锁定后重新优化不动锁定组;时间槽失效解释可见 |
| 6 | 正式 Demo 集成(负责人) | Playwright 十六步闭环;verify-no-zdbk-write;日志无敏感字段 |
| 7 | GitHub 同步前硬化 | docs/08 §14 清单 + `pnpm verify` 全绿 |

**每个 PR 的 CI 顺序**(docs/05 §5.3):`pnpm check` → `pnpm typecheck` → `pnpm test` → `pnpm build` →(涉及用户流程/网络边界/数据清除时)`pnpm test:e2e`。本地一键:`pnpm verify`。

## 8. 常用命令

```bash
pnpm install          # Node 24.17 LTS + pnpm 11(版本见 .node-version / package.json engines)
pnpm dev              # 并行起 Vite(5173) + Fastify(3000);/api 由 vite 代理
pnpm verify           # check + typecheck + test + build + 两个守门脚本
pnpm test:e2e         # Playwright(自动拉起 dev server)
```

PostgreSQL 仅 chalaoshi L2 缓存需要;本地没有时置空 `DATABASE_URL`,模块自动降级 L1+seed(开发允许,CI 的 Task 3 测试会覆盖两种形态)。首次:`cp .env.example .env`。

## 9. 脚手架现状(2026-07-09 建立)

**真实可用**:契约层全部 Schema、错误码、log.v1;导入校验 `parseCatalogJson` + 路由;`/api/health`;时间槽归一化与重叠检测;`estimateRisk` 冻结实现;logger;合成 fixture;两个 verify 脚本;`tests/{contract,server}` 大部分用例。

**诚实占位(等 Task 交付)**:selection-model 六个核心函数抛 `NotImplementedError`;chalaoshi 解析器/路由、llm-gateway 路由、planner 路由返回 501;四个 feature 页为占位组件;SSRF 的 IP 判定默认拒绝(fail-closed);`tests/domain/properties.test.ts` 与部分 ssrf 用例为 `it.todo`。

**约定**:实现一个函数 = 删掉它的 `NotImplementedError`/501 + 把对应 `it.todo`/`test.fixme` 变成真实断言 + 门禁测试全绿。**禁止**在保留 stub 的同时让上层"绕过"它。

**首个动作建议**(任何组员的 AI 接手时):先跑 `pnpm install && pnpm verify`,确认基线是绿的,再开始你的 Task。脚手架配置若与实际安装的库版本有出入(本框架按 docs/07 基线书写,未经 `pnpm install` 实测),修复配置本身不算契约变更,但要在 PR 里说明。

## 10. 反模式速查(AI 高频错误)

**行为反模式**:

- 为了"让 Demo 看起来能跑"返回硬编码假数据 → 违反 H9;
- 在前端/planner 里"顺手"写一个简化冲突检查 → 违反 H4;
- LLM 输出解析失败时用正则从文本里"抢救"结果 → 违反 H5(D25);
- 把 `rs`"余量/容量"按名字拆开参与计算 → 违反 H11(F-10);
- 给风险栏做一个"临时"的稳/悬/危 → 违反 H3;
- 装一个新 npm 包解决小问题 / 把版本号改成 `^` → 违反 H7;
- 在日志/报错信息里带出评论原文、偏好全文或 key → 违反 H6。

**API 反模式**(全表见 docs/07 §4,这里是最常踩的):

| ❌ 训练语料旧写法 | ✅ 本项目基线 |
|---|---|
| `ReactDOM.render` | `createRoot`(react-dom/client) |
| `useQuery(key, fn)` 位置参数 / `cacheTime` | `useQuery({queryKey,queryFn})` / `gcTime` |
| Zod3 写法 / 第三方 JSON Schema 转换器 | `import * as z from "zod"`(v4)/ `z.toJSONSchema()` |
| Fastify async 插件里再调 `done` | 只选一种风格(本仓库统一 async) |
| Tailwind v3 `@tailwind base` / content 配置 | v4 `@import "tailwindcss"` + `@tailwindcss/vite` |
| `cheerio(...)` 静态调用 | `import * as cheerio` + `load()` |
| Vitest `workspace` | `test.projects`(如需多配置) |
| CommonJS `require` / `moduleResolution: node` | ESM only;bundler(client)/NodeNext(server) |

## 11. 术语速查(完整表见 docs/01 §11)

教学班(section,xkkh 唯一)· 待选池(目标课程+候选班,只在池内决策)· 基线(已选固定+已填志愿锁定)· 基线补全(在基线上补齐方案,D18)· 志愿/顺位(指向具体教学班,同课程≤3 且同时间段≤3,D30)· 课程志愿组优先于时间槽志愿组(D37)· 均绩(某师某课平均绩点,不跨课替代 D14)· advise-only(只建议不写入)· session(手动创建,从基线从零开始,D08)。
