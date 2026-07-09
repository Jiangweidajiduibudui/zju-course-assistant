# AI 选课助手六人开发主计划 Implementation Plan

> **状态**:本草案已由 grilling 结论修订并合并至 [docs/08-开发实施计划.md](../../08-开发实施计划.md);后续以 08 为准。


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 由负责人带领 5 名组员，以模块化单体方式完成一个可公开演示、可持续扩展的 AI 选课助手网站；负责人掌握可独立集成和演示的主干，其余成员围绕稳定契约并行交付功能模块。

**Architecture:** 使用单 package TypeScript 模块化单体。React/Vite 前端、Fastify 后端、纯 TypeScript 领域层和 Zod 契约层保持单向依赖；功能按业务边界拆分，模块通过显式契约组合，不引入运行时插件系统、微服务或第二种后端语言。开发先建立可运行的纵向主干，再逐个接入真实模块，任何模块失败都必须显式降级而不是污染主流程状态。

**Tech Stack:** Node.js 24.17.0、pnpm 11.10.0、TypeScript 6.0.3、React 19.2.7、Vite 8.1.3、Fastify 5.10.0、Zod 4.4.3、Dexie 4.4.4、PostgreSQL 17.10、Vitest 4.1.10、fast-check 4.8.0、Playwright 1.61.1、Biome 2.5.3；精确版本以 [07 · 技术栈与版本基线](../../07-技术栈与版本基线.md) 为准。

## Global Constraints

- 本文是**待负责人审核的开发主计划**，不是新增产品决策；与 01–07 冲突时，以现行权威文档为准。
- 当前只规划功能实现和协作边界，**不在本阶段创建代码脚手架**；审核后再按模块拆成可执行的详细计划。
- 产品形态是独立网站，不注入 zdbk，不读取浏览器中的 zdbk Cookie，不索取统一认证密码。
- 全程 advise-only；禁止调用选课、退选、调序等 zdbk 业务写接口。
- Demo 的 zdbk 数据只来自脱敏 fixture 或用户主动输入/导入；普通 CI 不访问真实 zdbk 或 chalaoshi。
- 第一版只处理第一、二轮概率筛选；第三/四轮、补选、低分定点、学分优先因素不进入模型。
- 志愿必须指向具体教学班；同课程最多 3 个、同时间段最多 3 个，两类约束叠加。
- 未校准录取概率、风险档位和阈值保持冻结，界面统一显示“暂不可评估”。
- 确定性程序负责硬约束、组合生成、冲突解释、最小扰动和最终校验；LLM 只处理模糊语义、合法方案软排序和解释。
- chalaoshi Demo 由后端按需抓取、限频、缓存并保留来源；长期镜像和 pgvector 不进入首个 Demo 主线。
- Lazuli 为 GPLv3，公开 Quantum 为 MIT，校内 Quantum 未提供开源授权；不得复制 Lazuli 或校内 Quantum 代码。
- 所有直接依赖精确锁定；第三方 API 修改前按 07 查询对应 Context7 主版本文档。
- 新增或修改共享契约、跨模块依赖和产品行为必须由负责人审核。

---

## 1. 本次仓库理解结论

### 1.1 项目真正要解决的问题

项目不是“替学生决定上什么课”，也不是“自动选课”。它解决的是：学生已经决定目标课程并圈定可接受教学班后，如何综合时间、地点、教师评价、按课均绩、待选负载和个人偏好，生成一份可解释、可调整、可手动录入 zdbk 的推荐方案。

核心链路为：

1. 用户同意隐私说明；
2. 导入课程与基线；
3. 浏览课程和教师评价；
4. 把可接受教学班加入待选池；
5. 设置规则与偏好；
6. 确定性求解器生成合法方案集；
7. LLM 在合法集内软排序并解释；
8. 用户调整、重新优化、回滚并定稿；
9. 用户手动录入 zdbk；
10. 重新导入实际状态并做一致性检查。

### 1.2 现有仓库状态

- 当前仓库是文档型仓库，没有业务代码和脚手架。
- 01–07 已覆盖 PRD、选课规则、接口、架构、测试、决策和精确版本。
- `docs/archive/` 只用于追溯，不得作为现行实现依据。
- 选课志愿结构与基本顺位已闭环；精确概率、部分 zdbk 复合字段、时间冲突提交规则和学分/门数上限仍未闭环。
- 技术路线已正式确定为 React + Vite + Fastify 的 TypeScript 单 package 模块化单体。

### 1.3 开发计划的停止条件

本主计划完成的标志不是“所有功能写完”，而是：

1. 六人的职责和文件所有权无重叠；
2. 首个可运行 Demo 的边界明确；
3. 模块输入输出、失败状态和测试责任明确；
4. 依赖顺序与合并门禁明确；
5. 负责人审核后，可把每个模块拆成独立详细实施计划。

## 2. 首个可运行 Demo 的定义

### 2.1 Demo 必须跑通的最短闭环

首个评审 Demo 只证明主链路成立，不追求一次覆盖完整 beta：

1. 首次隐私同意；
2. 加载仓库内脱敏 Demo fixture；
3. 新建 session 并展示基线；
4. 搜索课程和展开教学班；
5. 后端实时获取一名教师的 chalaoshi 信息，并在失败时显示缓存/失败状态；
6. 将教学班加入待选池；
7. 添加一条全局规则和一条硬约束；
8. 生成合法方案集；
9. 通过真实 OpenAI 兼容端点或仅限开发/测试的 mock soft-ranker 选出一份方案；
10. 确定性终校验通过后原子应用；
11. 展示推荐课表、依据、数据时间和不确定性；
12. 锁定一项、重新优化并回滚；
13. 定稿后用第二份 fixture 做一致性检查；
14. Playwright 证明全程没有 zdbk 网络请求。

### 2.2 两级 Demo

| 级别 | 用途 | 数据与依赖 | 是否可对外 |
|---|---|---|---|
| Walking Skeleton | 团队早期联调 | 全部使用 fixture；soft-ranker 使用开发专用 mock | 否，仅内部证明主干可运行 |
| Review Demo | 负责人审核与公开演示候选 | zdbk 使用脱敏 fixture；chalaoshi 实时抓取+缓存；LLM 使用用户自配兼容端点 | 可，但必须保留失败降级与隐私提示 |

开发专用 mock 不得进入生产默认路径，也不得在“无 key”时伪装成真实推荐。生产行为仍遵守 D21：无 key 不生成推荐。

### 2.3 Demo 暂不纳入

- 精确录取概率、稳/悬/危档位；
- 第三/四轮和补选；
- zdbk 自动登录或在线读取；
- 长期镜像站、定时全量抓取、embedding 和 pgvector；
- 资料收集、趋势预测、导出分享；
- 账号系统、云同步和多人协作；
- 运行时安装/卸载功能模块。

## 3. 竞品调研后的采用与拒绝

### 3.1 Lazuli（公开，GPLv3）

可采用的**思路**：

- 教师索引支持本地兜底与在线更新；
- 在线数据写入缓存前先做结构校验；
- 数据源地址与更新时间可见；
- 评分信息靠近教学班展示，减少用户来回查找成本。

明确拒绝：

- 不复制 GPLv3 源码；
- 不做页面 DOM 注入和硬编码表格列位置；
- 不使用“待选人数 ÷ 余量”的简单比值作为可信录取概率；
- 不只按教师姓名取第一个匹配项；
- 不把打包的旧教师索引当作长期事实源。

### 3.2 公开 Quantum（MIT，模块化框架壳）

可采用的**思路**：

- 模块有稳定标识、职责说明、依赖和初始化边界；
- 业务服务模块与 UI 导航模块分开；
- 模块依赖在装配时检查，而不是运行到深处才失败。

明确拒绝：

- 本项目不需要动态 DLL 扫描、模块市场或运行时安装/卸载；
- 不引入为插件框架服务的复杂生命周期；
- 使用 TypeScript 编译期组合和显式依赖即可。

### 3.3 校内 Quantum 相关模块（只读调研，禁止复制）

本次只读核验了 `CourseSelectionAssistant`、`ChalaoshiService` 和 `ZdbkService` 的结构。可采用的**机制**：

- 选课 UI、zdbk 数据服务、chalaoshi 数据服务分成独立模块；
- 用教学班快照保存待选池和历史状态，避免实时对象变化污染历史；
- 待选池按教学班 ID 去重；
- 课表先把时间解析成规范化槽位，再进行冲突检测和渲染；
- 可变上游数据通过缓存实体暴露“当前值 + 刷新任务 + 初始化状态”；
- 课程列表、心愿单、课表和概览是不同视图，不把所有状态塞进一个页面。

明确拒绝：

- 不复制校内代码或类型定义；
- 不沿用旧课程简介入口和硬编码课程分类；
- 不持久化 zdbk Cookie、姓名、学号等账号状态；
- 不采用简单 `余量 / 总待选` 作为选中概率；
- 不允许用户提交并动态执行任意优化代码；
- 不采用教师学院不匹配时回退第一个同名教师的策略；
- 不复用未经测试证明正确的时间/考试冲突实现。

### 3.4 校网与 ZJU Git 只读调研方式

- 校外访问内部资料时，可复用 zju-scholar 的 WebVPN URL 转换与会话机制。
- ZJU Git 只读调研可复用负责人浏览器登录态；登录态文件、Cookie 和凭证永不进入仓库、文档或日志。
- 该方式只用于开发者调研和脱敏 fixture 核验，**不是产品接入 zdbk 的方案**。
- 校内仓库不作为 Git 子模块、包依赖或源码来源；只记录独立归纳出的产品机制。

## 4. 模块边界与计划目录

> 下列目录是审核后的目标结构，不在本次规划阶段创建。

```text
src/
├── client/
│   ├── app/                         # 路由、页面壳、全局错误边界、模块装配
│   ├── api/                         # 同源 API 客户端与错误映射
│   ├── db/                          # Dexie Schema、迁移、清除入口
│   └── features/
│       ├── onboarding/              # 首次引导与隐私同意
│       ├── session/                 # session、基线差异和历史
│       ├── catalog/                 # 导入、搜索、课程/教学班浏览
│       ├── teacher-insights/        # 教师匹配、均绩、评论摘要展示
│       ├── pool/                    # 待选池
│       ├── rules/                   # 规则栏和确认制偏好建议
│       ├── planner/                 # 生成进度、方案、课表、重优化、回滚
│       ├── finalize/                # 定稿与一致性检查
│       └── settings/                # LLM 配置、隐私与数据清除
├── server/
│   ├── app/                         # Fastify 创建、插件注册、静态托管
│   ├── modules/
│   │   ├── import/                  # 导入二次校验与规范化
│   │   ├── chalaoshi/               # 抓取、解析、匹配、缓存 API
│   │   ├── planning/                # 求解流程编排与原子结果
│   │   └── llm/                     # 能力检测、代理、Schema 校验
│   └── repositories/
│       └── public-cache/            # L1/L2 公共抓取缓存与 lease
├── domain/
│   ├── course/                      # 课程、教学班、时间槽、快照
│   ├── session/                     # session 状态、基线差异、历史命令
│   ├── selection/                   # 轮次、志愿、面向对象和容量口径
│   └── solver/                      # 硬过滤、组合、冲突、最小扰动、终校验
└── shared/
    ├── contracts/                   # Zod DTO、LLM Schema、错误码
    └── testing/                     # fixture builder 与测试辅助

tests/
├── contracts/
├── domain/
├── server/
└── integration/
e2e/
├── demo-flow.spec.ts
├── degradation.spec.ts
└── network-boundary.spec.ts
fixtures/
├── import/
├── chalaoshi/
└── zdbk/
sql/migrations/
```

### 4.1 依赖方向

```text
client ───────→ shared ←─────── server
  │               ↑               │
  └────────────→ domain ←──────────┘

domain 不得依赖 client、server、React、Fastify、Dexie、PostgreSQL 或抓取器
client 不得导入 server
模块不得直接读取另一个模块的内部文件，只能使用 shared/domain 中的公开契约
```

### 4.2 五个关键模块契约

| 契约 | 输入 | 成功输出 | 失败输出 |
|---|---|---|---|
| 导入规范化 | 用户导入内容或 fixture | 课程目录、教学班、基线、导入时间 | 字段级错误列表；不创建 session |
| 教师信息 | 教师姓名、学院、课程名 | 唯一教师信息、按课均绩、评论元数据、数据时间 | 未命中/多候选/学院冲突/上游失败/过期缓存 |
| 确定性求解 | 基线、待选池、规则、志愿组、锁定项 | 合法方案集或可解释无解 | 冲突来源；不得放松硬约束 |
| LLM 软排序 | 编号后的合法方案集、软偏好、评价要点 | 输入集合内的 `chosenPlanId` 与理由 | 能力不足、超时、取消、Schema 失败 |
| 规划工作流 | 数据快照、求解结果、代际号 | 终校验通过的完整方案，原子入栈 | 旧代际丢弃；当前方案保持不变 |

### 4.3 共享契约治理

- `src/shared/contracts/` 由负责人最终审核和合并。
- 模块负责人可以在 PR 中提出契约变更，但不得同时绕过契约直接引用对方内部实现。
- 契约变更必须附：受影响模块、兼容方式、fixture、失败样例和测试更新。
- 任何字段在 03 标为“待核验”时，契约必须表达“未知/不可用”，不得填默认假事实。

## 5. 六人分工

### 5.1 负责人：主干整合与可运行 Demo

**拥有路径：**

- `src/client/app/`
- `src/client/features/planner/`
- `src/client/features/finalize/`
- `src/server/app/`
- `src/server/modules/planning/`
- `src/shared/contracts/` 的最终审核权
- `e2e/demo-flow.spec.ts`
- 根级工程配置、CI、Docker 和 README 开发说明

**职责：**

1. 锁定模块契约和依赖方向；
2. 建立可运行 Walking Skeleton；
3. 串联 session → catalog → pool → rules → solver → LLM → plan；
4. 实现生成代际、取消、进度、原子应用和旧结果丢弃；
5. 实现方案展示、锁定、更换、移除、重新优化、回滚、定稿和一致性检查；
6. 维护主分支可运行性和集成测试；
7. 处理跨模块冲突，不替成员长期维护其内部实现。

### 5.2 组员 A：导入、课程目录与待选池

**拥有路径：**

- `src/client/features/catalog/`
- `src/client/features/pool/`
- `src/server/modules/import/`
- `fixtures/import/`
- `tests/contracts/import*.test.ts`

**交付：**

- 导入格式校验、错误定位和脱敏检查；
- 课程/教学班规范化；
- 分类动态读取，不硬编码历史枚举；
- 搜索、展开教学班、批量入池/移除、按课程分组、去重；
- 任何推荐输入都只能来自池内候选。

### 5.3 组员 B：教师评价与 chalaoshi 数据链

**拥有路径：**

- `src/client/features/teacher-insights/`
- `src/server/modules/chalaoshi/`
- `src/server/repositories/public-cache/`
- `fixtures/chalaoshi/`
- `tests/server/chalaoshi*.test.ts`

**交付：**

- search.json、教师详情页和评论 HTML 解析；
- 域名配置、超时、响应体限制、限频、single-flight、3 天 TTL；
- 姓名+学院严格匹配与用户确认状态；
- 课程名唯一匹配后的按课均绩；
- 近五年评论筛选、去重、限长和样本分档；
- 来源链接、更新时间、过期缓存和抓取失败状态。

### 5.4 组员 C：选课规则、志愿模型与确定性求解器

**拥有路径：**

- `src/domain/course/`
- `src/domain/selection/`
- `src/domain/solver/`
- `tests/domain/solver*.test.ts`
- `tests/domain/selection*.test.ts`

**交付：**

- 规范化时间槽、单双周/学期和冲突检测；
- 第一/二轮、预置容量口径、课程面向对象优先；
- 同课程/同时间段双重三志愿约束；
- 硬过滤、合法组合生成、top-N 截断、冲突解释；
- 最小扰动重新优化；
- 最终确定性校验；
- fast-check 性质测试和 benchmark；
- 风险接口恒返回 unavailable，直到 D30 后续决策解冻。

### 5.5 组员 D：LLM 能力、规则建议、摘要、软排序与解释

**拥有路径：**

- `src/client/features/rules/`
- `src/client/features/settings/` 中 LLM 配置部分
- `src/server/modules/llm/`
- `tests/server/llm*.test.ts`
- LLM 固定评测 fixture

**交付：**

- OpenAI 兼容端点的连通性、结构化输出、超时和能力检测；
- key 掩码、替换、删除和单次代理；
- 偏好结构化建议，用户确认前零状态修改；
- 评论摘要的 pros/cons、样本量和低样本标记；
- 合法方案软排序，`chosenPlanId` 严格属于输入集合；
- 推荐解释只引用真实方案数据；
- 取消、Schema 失败和能力不足的明确降级。

### 5.6 组员 E：session、基线、Dexie、首次引导与隐私

**拥有路径：**

- `src/client/db/`
- `src/client/features/onboarding/`
- `src/client/features/session/`
- `src/client/features/settings/` 中隐私与清除部分
- `src/domain/session/`
- `tests/domain/session*.test.ts`
- `e2e/degradation.spec.ts` 中客户端状态部分

**交付：**

- Dexie Schema 与只增不改的历史 upgrade 链；
- session 手动创建、历史只读、单项手动取回；
- 基线快照、重新导入差异和确认后同步；
- 完整状态历史栈与回滚；
- 首次隐私同意门禁；
- session、映射和 key 的全量清除；
- 不把用户规划数据持久化到服务端。

## 6. 依赖顺序与并行策略

```text
负责人锁定 shared 契约与 Demo fixture
        │
        ├── 组员 A：导入/目录/待选池 ───────────┐
        ├── 组员 B：chalaoshi ──────────────────┤
        ├── 组员 C：规则/求解器 ────────────────┤
        ├── 组员 D：LLM/规则建议/软排序 ────────┤→ 负责人集成 Review Demo
        └── 组员 E：session/Dexie/隐私 ─────────┘
```

并行前必须先冻结四组 fixture：

1. `DemoImportPayload`：课程、教学班、基线和志愿；
2. `TeacherInsightFixture`：唯一命中、多候选、无均绩、评论样本分档；
3. `PlanningInputFixture`：有解、无解、锁定、双重三志愿边界；
4. `LlmResponseFixture`：合法、越界 planId、缺字段、超时和取消。

如果契约尚未冻结，成员只能完善 fixture 和测试场景，不应各自创建不兼容类型。

## 7. 实施任务与合并门禁

### Task 1: 契约、fixture 与架构守卫

**Owner:** 负责人；五名成员共同评审。

**Planned files:**

- Create: `src/shared/contracts/*`
- Create: `src/shared/testing/*`
- Create: `fixtures/import/*`
- Create: `fixtures/chalaoshi/*`
- Create: `tests/contracts/architecture.test.ts`
- Create: `tests/contracts/schema.test.ts`

**Produces:** 所有模块共同使用的数据结构、错误码、fixture 和依赖规则。

- [ ] 逐条把 PRD FR-1 至 FR-12 的输入、输出和失败状态映射到契约。
- [ ] 为 03 中所有“待核验”字段设计显式 unknown/unavailable 状态。
- [ ] 为五个关键模块契约各准备一个成功 fixture 和至少两个失败 fixture。
- [ ] 添加依赖方向测试，阻止 domain 引用基础设施、client 引用 server。
- [ ] 运行 `pnpm check && pnpm typecheck && pnpm test`，预期全部通过。
- [ ] 提交 `chore: establish contracts and architecture guards`。

**Gate G-A:** 五名模块负责人都能只读契约完成自己的模块设计，且没有相互导入内部文件的需求。

### Task 2: Walking Skeleton 主干

**Owner:** 负责人。

**Planned files:**

- Create: `src/client/app/*`
- Create: `src/client/features/planner/*`
- Create: `src/client/features/finalize/*`
- Create: `src/server/app/*`
- Create: `src/server/modules/planning/*`
- Create: `e2e/demo-flow.spec.ts`

**Consumes:** Task 1 契约和 fixture。

**Produces:** 不依赖真实外部服务的内部可运行主链路。

- [ ] 先写 E2E：隐私同意 → fixture → session → 入池 → 规则 → 生成 → 定稿 → 检查。
- [ ] 运行 E2E，确认在主干不存在时按预期失败。
- [ ] 用 fixture adapter 和开发专用 mock soft-ranker 串通页面与 API。
- [ ] 增加生成代际、取消和原子应用断言。
- [ ] 增加网络断言：请求列表中不允许出现 `zdbk.zju.edu.cn`。
- [ ] 运行 `pnpm check && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`。
- [ ] 提交 `feat: add runnable planning skeleton`。

**Gate G-B:** 任意新成员克隆仓库后可用一条开发命令跑通内部 Demo，且不需要真实账号、Cookie 或 API key。

### Task 3: session 与客户端事实源

**Owner:** 组员 E。

**Planned files:**

- Create: `src/client/db/*`
- Create: `src/client/features/onboarding/*`
- Create: `src/client/features/session/*`
- Create: `src/domain/session/*`
- Test: `tests/domain/session*.test.ts`

**Produces:** 可替换 Walking Skeleton 内存状态的正式客户端状态模块。

- [ ] 先写 session 创建、历史隔离、基线差异、确认同步、回滚和全量清除测试。
- [ ] 运行测试并确认失败原因对应缺少正式状态实现。
- [ ] 实现 Dexie 版本 1 和 repository；发布后只通过新版本迁移。
- [ ] 接入首次隐私门禁和清除入口。
- [ ] 与负责人联调 planner 状态历史，禁止出现第二事实源。
- [ ] 运行定向单测、typecheck、build 和状态 E2E。
- [ ] 提交 `feat: persist sessions and baseline history`。

### Task 4: 导入、课程目录与待选池

**Owner:** 组员 A。

**Planned files:**

- Create: `src/server/modules/import/*`
- Create: `src/client/features/catalog/*`
- Create: `src/client/features/pool/*`
- Test: `tests/contracts/import*.test.ts`
- Test: `tests/integration/catalog-pool.test.ts`

**Produces:** 规范化课程目录和严格池内候选集合。

- [ ] 先写正常、空、缺字段、非法引用和未脱敏导入测试。
- [ ] 先写批量入池、移除、去重和按课程分组测试。
- [ ] 实现前后端双重校验和字段级错误展示。
- [ ] 确保分类来自导入数据，不使用历史硬编码列表。
- [ ] 增加“推荐输入出现池外教学班即失败”的集成断言。
- [ ] 运行定向测试、typecheck 和 build。
- [ ] 提交 `feat: add validated catalog and candidate pool`。

### Task 5: chalaoshi 教师信息链

**Owner:** 组员 B。

**Planned files:**

- Create: `src/server/modules/chalaoshi/*`
- Create: `src/server/repositories/public-cache/*`
- Create: `src/client/features/teacher-insights/*`
- Test: `tests/server/chalaoshi*.test.ts`
- Migration: `sql/migrations/001_public_cache.sql`

**Produces:** 可缓存、可降级、可追溯的教师信息模块。

- [ ] 先用固定 HTML/JSON 写索引、详情、评论解析合同测试。
- [ ] 增加结构漂移、Cloudflare 页、超时、4xx/5xx 和过期缓存测试。
- [ ] 实现 L1/L2、single-flight、3 天 TTL 和强制刷新。
- [ ] 实现严格教师/均绩匹配状态，不提供“取第一个同名”回退。
- [ ] 实现近五年评论预处理和 `<5 / 5–9 / ≥10` 分档。
- [ ] 联调教师卡片，始终显示来源和数据时间。
- [ ] 运行定向测试、数据库 migration 测试、typecheck 和 build。
- [ ] 提交 `feat: add resilient teacher insight pipeline`。

### Task 6: 规则、志愿与确定性求解器

**Owner:** 组员 C。

**Planned files:**

- Create: `src/domain/course/*`
- Create: `src/domain/selection/*`
- Create: `src/domain/solver/*`
- Test: `tests/domain/selection*.test.ts`
- Test: `tests/domain/solver*.test.ts`
- Test: `tests/domain/solver.property.test.ts`

**Produces:** 框架无关、可重复、可解释的合法方案生成器。

- [ ] 先写时间槽解析和冲突固定样例，覆盖学期、单双周、星期和节次。
- [ ] 先写两类三志愿约束、锁定保持、池内性和第一/二轮边界测试。
- [ ] 先写有解/无解、最小扰动和终校验性质测试。
- [ ] 实现硬过滤、组合搜索、启发式截断和冲突解释。
- [ ] benchmark 典型与压力输入；持续超过 200ms 时记录证据，再评估 worker thread。
- [ ] 确认风险输出始终为 unavailable，不生成概率或档位。
- [ ] 运行定向测试、fast-check、typecheck 和 benchmark。
- [ ] 提交 `feat: add deterministic planning engine`。

### Task 7: LLM 能力与软语义模块

**Owner:** 组员 D。

**Planned files:**

- Create: `src/server/modules/llm/*`
- Create: `src/client/features/rules/*`
- Modify: `src/client/features/settings/*`
- Test: `tests/server/llm*.test.ts`
- Test: `tests/integration/llm-workflows.test.ts`

**Consumes:** Task 1 LLM Schema；Task 6 的编号合法方案集。

**Produces:** 能力分级、偏好建议、摘要、软排序和解释。

- [ ] 先写连通、结构化输出失败、超时、取消和低能力端点测试。
- [ ] 先写四类任务的 Schema 成功/失败固定样例。
- [ ] 实现字段白名单提示词装配，排除姓名、学号、Cookie、token 和 key。
- [ ] 实现 key 掩码、替换、删除和日志脱敏。
- [ ] 确保偏好建议未经确认不生效，评论摘要路径无状态写能力。
- [ ] 确保越界 `chosenPlanId` 和自然语言补充内容一律失败。
- [ ] 运行定向测试、固定评测集、typecheck 和 build。
- [ ] 提交 `feat: add guarded llm workflows`。

### Task 8: 正式模块替换与 Review Demo

**Owner:** 负责人；各模块负责人处理本模块联调缺陷。

**Planned files:**

- Modify: `src/client/app/*`
- Modify: `src/server/app/*`
- Modify: `src/server/modules/planning/*`
- Modify: `e2e/demo-flow.spec.ts`
- Create: `e2e/degradation.spec.ts`
- Create: `e2e/network-boundary.spec.ts`

**Produces:** 使用正式模块的评审 Demo。

- [ ] 逐个替换 fixture adapter：session → import/catalog → solver → LLM → chalaoshi。
- [ ] 每替换一个模块都运行主流程 E2E，不一次合并五个大模块。
- [ ] 接入真实 chalaoshi 合同测试，但保持普通 CI 使用 fixture。
- [ ] 接入用户自配 OpenAI 兼容端点的手动 smoke 流程。
- [ ] 验证取消、旧请求、Schema 失败、抓取失败和数据库失败不会覆盖当前方案。
- [ ] 验证无 key 时不生成推荐，信息类功能仍可用。
- [ ] 运行完整 CI 与 Playwright 网络断言。
- [ ] 提交 `feat: integrate review demo`。

**Gate G-C:** Review Demo 可完整演示，任何外部依赖失败都有明确状态，且不产生 zdbk 调用或半成品方案。

### Task 9: beta 硬化与发布审查

**Owner:** 负责人统筹，五名成员按模块关闭缺陷。

**Planned files:**

- Modify: `docs/05-验收与测试计划.md`（只回填实际覆盖和证据）
- Modify: `README.md`（补开发、测试和演示说明）
- Modify: `.github/workflows/*`
- Modify: `Dockerfile`、部署配置和 migration 入口

**Produces:** 对照 05 的 G0–G8 发布证据。

- [ ] 建立 FR/AC → 测试文件 → CI 任务映射表。
- [ ] 完成所有解析器、求解器、状态和 LLM 降级测试。
- [ ] 完成 Chromium E2E；O-Q6 定标后再扩展正式浏览器矩阵。
- [ ] 审计日志、错误响应和构建产物，确认无 key/Cookie/token/个人信息。
- [ ] 审计依赖许可证和内部竞品净室边界。
- [ ] 从空库顺序执行 migration，并验证 Docker 非 root 启动。
- [ ] 运行 `pnpm check && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`。
- [ ] 负责人逐项审核 G0–G8；未满足项明确阻断发布。
- [ ] 提交 `chore: prepare beta release evidence`。

## 8. GitHub 协作规则

### 8.1 分支与 PR

- `main` 始终保持可构建、可测试、可运行。
- 每项任务使用短生命周期分支，例如 `feat/chalaoshi-parser`、`feat/solver-constraints`。
- 一个 PR 只交付一个可独立验收的行为，不混入依赖升级。
- 共享契约变更先合并，再由模块 PR 消费；不在两个并行 PR 中各自发明同名字段。
- PR 必须写明：对应 FR/AC、改变的契约、失败行为、验证命令和剩余风险。

### 8.2 文件所有权

- 每个模块路径只有一名直接负责人；其他人修改前先在 PR 中 @ 路径负责人。
- `src/shared/contracts/`、根配置、CI 和生产装配由负责人最终合并。
- fixture 可由模块负责人维护，但脱敏规则由负责人复核。

### 8.3 合并顺序

1. 契约与架构守卫；
2. Walking Skeleton；
3. session、catalog、solver、LLM、chalaoshi 各自小 PR；
4. 每次只接入一个正式模块；
5. Review Demo；
6. beta 硬化。

避免创建一个“全员同时修改、最后一次性合并”的长期集成分支。

## 9. 评审时重点确认的 8 个问题

1. 首个 Demo 是否应同时包含真实 chalaoshi 与真实 LLM，还是先只完成 Walking Skeleton？
2. 负责人是否接受主干拥有 planner/finalize，而组员分别提供可替换模块？
3. 组员 A–E 的工作量是否符合实际能力，是否需要在 UI 工作量上重新平衡？
4. 是否同意采用“编译期显式模块契约”，而不照搬 Quantum 的运行时插件系统？
5. 是否同意仅吸收校内 Quantum 的机制，不导入源码、类型或仓库依赖？
6. 是否同意 zju-scholar/WebVPN 与浏览器登录态只服务于开发调研和脱敏核验，不进入产品？
7. 是否同意风险估计继续显示“暂不可评估”，不为 Demo 临时添加简单概率？
8. 是否同意审核本主计划后，再拆成 6 份详细实施计划，而不是现在直接创建脚手架？

## 10. 自检结果

### 10.1 现行规格覆盖

- FR-1：组员 E + 负责人主干；
- FR-2：组员 A；
- FR-3：组员 B + 组员 D 摘要；
- FR-4：组员 A；
- FR-5：组员 C 规则语义 + 组员 D 规则 UI/建议；
- FR-6：组员 C 求解 + 组员 D 软排序 + 负责人工作流；
- FR-7：负责人 planner；
- FR-8：负责人 finalize；
- FR-9：组员 D；
- FR-10：组员 D；
- FR-11：组员 E；
- FR-12：各模块提供失败状态，负责人维护全局降级 E2E。

### 10.2 关键边界检查

- 没有恢复插件、DOM 注入或 zdbk 在线登录；
- 没有恢复 Agent loop、拖拽代填、多方案输出或池外推荐；
- 没有引入未定的精确风险算法；
- 没有把内部 Quantum 作为依赖或代码来源；
- 没有新增技术种类或运行时服务；
- 没有在规划阶段创建代码脚手架。

### 10.3 审核后动作

本计划获批后，按 Task 1–9 拆为六份实施计划：主干、session、catalog、teacher-insights、solver、LLM。每份计划再补充精确文件、测试内容、执行命令和逐步提交，不在本主计划中提前生成实现代码。
