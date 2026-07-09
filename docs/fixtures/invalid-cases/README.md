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
| `catalog-duplicate-course-code.json` | `IMPORT_SCHEMA_MISMATCH` | 同一 `courseCode` 出现两次 |

另见上级目录 `catalog-normalize-teachers.synthetic.json`：合法样例，用于验证 trim / `<br>` 拆师 / section 与课程字段对齐。

约定：

- 所有样例必须 `synthetic: true`（或嵌套 session 内无真实学号/姓名/评论），内容全部合成（D41）；
- 新增样例时同步更新本表和 `tests/server/import.test.ts`；
- 选课期抓包得到的真实脱敏样例按 docs/03 §5 入库，不放本目录。
