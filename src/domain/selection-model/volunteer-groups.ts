import type { VolunteerGroup } from "../../shared/contracts/index.js";
import { NotImplementedError } from "./errors.js";
import type { SolverInput } from "./types.js";

/**
 * 志愿组构造（D30、D37；规则细目见 docs/08 §6.2）：
 *
 * 1. 同一课程 ≥2 个候选教学班 → 课程志愿组（最多 3 班，顺位 1/2/3）；
 * 2. 被课程志愿组占用的教学班不得再进入时间槽志愿组；
 * 3. 时间槽组与课程组冲突时，课程组优先，时间槽组失效（invalidated 必须带原因）；
 * 4. 课程组缩小到 1 个教学班时自动消解，该班可参与时间槽组；
 * 5. 时间槽志愿组最多 3 班，顺位 1/2/3。
 *
 * Task 1 交付；测试锚点：tests/domain/volunteer-groups.test.ts。
 */
export function buildVolunteerGroups(_input: SolverInput): VolunteerGroup[] {
  throw new NotImplementedError("buildVolunteerGroups", "Task 1");
}
