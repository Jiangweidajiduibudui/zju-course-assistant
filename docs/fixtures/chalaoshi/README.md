# chalaoshi 合成解析样例

用于组员 B 的 parser / 降级测试（docs/05 §1、§5.2；D41）。

| 文件 | 用途 |
|---|---|
| `search.synthetic.json` | search.json 节选（teachers + colleges） |
| `search-malformed.synthetic.json` | 结构变更：缺 teachers → 解析必须显式失败 |
| `teacher-detail.synthetic.html` | 教师详情页快照（均绩分行、点名比例） |
| `teacher-detail-empty.synthetic.html` | 无均绩 / 无点名比例边界 |
| `comments.synthetic.html` | 评论 HTML 片段（赞踩 + 日期） |
| `comments-empty.synthetic.html` | 无评论边界 |

约定：

- 全部为**结构忠实、内容合成**的样例；评论文本带「（合成评论）」前缀；
- **禁止**把真实 chalaoshi 评论批量入库；
- CI / 单测只读本目录，不访问真实上游。
