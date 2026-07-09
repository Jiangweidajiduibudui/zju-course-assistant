# 非法样例（invalid-cases）

用于导入校验器的负向契约测试（docs/05 §1、§2）。每个文件对应一种预期失败：

| 文件 | 预期错误码 | 说明 |
|---|---|---|
| `catalog-schema-mismatch.json` | `IMPORT_SCHEMA_MISMATCH` | `teachers` 为空数组，违反 Schema（min(1)） |
| `catalog-duplicate-section.json` | `IMPORT_DUPLICATE_SECTION` | 同一 `sectionId` 重复出现 |
| `catalog-missing-schema-version.json` | `IMPORT_SCHEMA_MISMATCH` | 缺少 `schemaVersion` |
| `catalog-empty-courses.json` | （当前 Schema 允许空 courses） | 保留样例：空目录可解析成功，供 UI 展示「无课程」 |
| `export-unknown-section-ref.json` | `IMPORT_UNKNOWN_SECTION_REF` | pool 引用 catalog 中不存在的 `sectionId`（须与 demo-catalog 联检） |
| `baseline-unknown-section.json` | `IMPORT_UNKNOWN_SECTION_REF` | baseline.selected 引用不存在的教学班（须与 demo-catalog 联检） |
| `pool-section-wrong-course.json` | `IMPORT_UNKNOWN_SECTION_REF` | 候选班属于其他课程（须与 demo-catalog 联检） |
| `pool-unknown-course.json` | `IMPORT_UNKNOWN_SECTION_REF` | pool.targets 引用不存在的 courseCode（须与 demo-catalog 联检） |
| `catalog-privacy-student-id.json` | `IMPORT_PRIVACY_SUSPECT` | place 含「学号: …」未脱敏样例 |
| `catalog-privacy-cookie.json` | `IMPORT_PRIVACY_SUSPECT` | unverifiedRaw 含 `session=` 疑似 Cookie 片段 |
| `catalog-duplicate-course-code.json` | `IMPORT_SCHEMA_MISMATCH` | 同一 `courseCode` 出现两次 |

另见上级目录 `catalog-normalize-teachers.synthetic.json`：合法样例，用于验证 trim / `<br>` 拆师 / section 与课程字段对齐。

约定：

- 所有样例必须 `synthetic: true`（或嵌套 session 内无真实学号/姓名/评论），内容全部合成（D41）；
- 新增样例时同步更新本表和 `tests/server/import.test.ts`；
- 选课期抓包得到的真实脱敏样例按 docs/03 §5 入库，不放本目录。

---

## 给组员 E 的 API 对接约定（import）

前缀：`/api/import/*`。请求体一律传**原始 JSON 文本字符串**（不要先在前端 `JSON.parse` 再丢对象，错误定位由服务端统一产出）。

### 成功

HTTP 200，形如：

```json
{
  "ok": true,
  "incompleteSectionIds": ["SYN301-01"],
  "catalog": { "...": "catalog.v1，已规范化" }
}
```

各路由还会带各自摘要字段（如 `courseCount`、`envelope`、`exportJson`）。`incompleteSectionIds`：`credits` 或 `examTime` 为 null 的教学班，**校验通过**，应留在待选池。

### 失败

| HTTP | 含义 |
|------|------|
| 400 | 请求体缺字段 / 不符合路由 Schema → `COMMON_VALIDATION_FAILED` |
| 422 | 业务校验失败 → `errorCode` + `details: ImportIssue[]` |

```json
{
  "errorCode": "IMPORT_SCHEMA_MISMATCH",
  "message": "导入数据未通过校验",
  "details": [
    { "path": "courses[0].sections[0].teachers", "code": "IMPORT_SCHEMA_MISMATCH", "message": "…" }
  ]
}
```

前端应把 `details[].path` / `message`（及 `code`）逐条展示给用户。

### 路由一览

| 方法 | 路径 | 请求体要点 | 用途 |
|------|------|------------|------|
| POST | `/api/import/catalog` | `{ catalogJson }` | 导入课程目录 |
| POST | `/api/import/export-envelope` | `{ exportJson, catalogJson? }` | 校验已有 export.v1 |
| POST | `/api/import/build-export` | `{ sessionJson, catalogJson?, exportedAt? }` | 由当前 session 构造 export.v1 |
| POST | `/api/import/bundle` | `{ catalogJson, exportJson }` | 往返主路径联检 |
| POST | `/api/import/baseline` | `{ baselineJson, catalogJson? }` | 基线校验 |
| POST | `/api/import/pool` | `{ poolJson, catalogJson? }` | 待选池校验（含课程归属） |

字段修正（trim、`<br>` 拆师、section 与课程字段对齐）在 **`/catalog` / `/bundle` 成功响应的 `catalog`** 中已完成；UI 少量手工改字段后应再走校验/导出，不要绕过服务端。
