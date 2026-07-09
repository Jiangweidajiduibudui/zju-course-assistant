# 非法样例（invalid-cases）

用于导入校验器的负向契约测试（docs/05 §1、§2）。每个文件对应一种预期失败：

| 文件 | 预期错误码 | 说明 |
|---|---|---|
| `catalog-schema-mismatch.json` | `IMPORT_SCHEMA_MISMATCH` | `teachers` 为空数组，违反 Schema（min(1)） |
| `catalog-duplicate-section.json` | `IMPORT_DUPLICATE_SECTION` | 同一 `sectionId` 重复出现 |

约定：

- 所有样例必须 `synthetic: true`，内容全部合成，不含真实姓名/学号/评论（D41）；
- 新增样例时同步更新本表和 `tests/server/import.test.ts`；
- 选课期抓包得到的真实脱敏样例按 docs/03 §5 入库，不放本目录。
