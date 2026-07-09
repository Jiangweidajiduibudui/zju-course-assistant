import type {
  Catalog,
  Course,
  Section,
  Session,
  TermSlot,
} from "../../../shared/contracts/index.js";
import { getRecommendationReadiness } from "../session/recommendationReadiness";
import { countSessionPoolSections } from "../session/sessionSummary";

/**
 * 待筛选志愿页（组员 E；docs/08 §8.1）。
 *
 * 定位：以课程志愿组 / 时间槽志愿组分块展示“待筛选志愿”。
 * 边界：不直接调用外部 LLM 或 chalaoshi；不自行判断志愿合法性；未接入能力只做禁用态。
 */
interface WishPlanPageProps {
  catalog: Catalog | null;
  session: Session | null;
  onOpenTimetable: () => void;
}

const termLabels: Record<TermSlot["term"], string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

const demoReasons: Record<string, string> = {
  "SYN101-01": "上午时段更贴近偏好，且与其余候选冲突较少。教师甲点名偏多，仅作为软偏好展示。",
  "SYN101-02": "教师乙评价更高，但周二时段与偏好次序略低。",
  "SYN201-01": "课程时间与 SYN101-01 存在重叠，demo 中标为备选堆叠，不表现成同时上课。",
  "SYN201-02": "考试时间缺失，按红线留在待选池，不进入课表投影。",
  "SYN301-01": "学分缺失，按 D38 留在待选池，等待用户补全或重新导入。",
};

function formatSlot(slot: TermSlot): string {
  return `${termLabels[slot.term]} · 周${"一二三四五六日"[slot.dayOfWeek - 1]} ${slot.period} 节`;
}

function formatSectionTime(section: Section): string {
  if (section.slots.length === 0) {
    return "时间未知";
  }
  return section.slots.map(formatSlot).join(" / ");
}

function sectionHardFieldLabel(section: Section): string {
  const missing: string[] = [];
  if (section.examTime === null) {
    missing.push("考试时间缺失");
  }
  if (section.credits === null) {
    missing.push("学分缺失");
  }
  return missing.length > 0 ? missing.join(" / ") : "硬字段完整";
}

function sectionNeedsPool(section: Section): boolean {
  return section.examTime === null || section.credits === null;
}

function renderCourseGroup(course: Course) {
  return (
    <article key={course.courseCode} className="panel overflow-hidden">
      <div className="border-b border-hairline bg-card-alt px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill pill-blue px-2.5 py-1">课程志愿组</span>
              <span className="font-mono text-[12px] text-ink-faint">{course.courseCode}</span>
            </div>
            <h3 className="mt-2 text-[17px] font-semibold tracking-[-0.01em] text-ink">
              {course.courseName}
            </h3>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              {course.category ?? "分类未知"} · {course.college ?? "学院未知"}
            </p>
          </div>
          <span className="pill pill-warn px-2.5 py-1">排序理由 · 示例 · LLM 未接入</span>
        </div>
      </div>

      <ol className="grid gap-3 p-5">
        {course.sections.map((section, index) => {
          const poolOnly = sectionNeedsPool(section);
          return (
            <li
              key={section.sectionId}
              className="rounded-[14px] border border-hairline bg-paper-deep p-4"
            >
              <div className="grid gap-4 lg:grid-cols-[auto_1fr_auto] lg:items-start">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-btn font-mono text-[13px] font-semibold text-cream-white shadow-warm-blue">
                  {index + 1}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {index === 0 ? <span className="pill pill-blue px-2.5 py-1">首选</span> : null}
                    <span className="font-mono text-[12.5px] font-semibold text-ink">
                      {section.sectionId}
                    </span>
                    <span className="text-[13px] font-medium text-ink-body">
                      {section.teachers.join("、")}
                    </span>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-5 text-ink-muted">
                    {formatSectionTime(section)} · {section.place ?? "地点未知"}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-5 text-ink-muted">
                    考试：{section.examTime?.raw ?? "未知"} · 学分：{section.credits ?? "未知"}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className={`pill px-2.5 py-1 ${poolOnly ? "pill-warn" : "pill-ok"}`}>
                      {sectionHardFieldLabel(section)}
                    </span>
                    <span className="pill pill-blue px-2.5 py-1">chalaoshi 合成演示数据</span>
                    <span className="pill pill-neutral px-2.5 py-1">风险：暂不可评估</span>
                  </div>

                  {poolOnly ? (
                    <div className="mt-3 rounded-[10px] border border-warn-border bg-warn-bg px-3 py-2 text-[12.5px] leading-5 text-warn">
                      留待选池 · 缺失硬字段，不进课表
                    </div>
                  ) : null}

                  <div className="mt-3 rounded-[12px] border border-blue-soft-border bg-blue-soft p-3 text-[12.5px] leading-5 text-blue-ink">
                    <p className="font-semibold">排序理由 · 示例 · LLM 未接入</p>
                    <p className="mt-1">
                      {demoReasons[section.sectionId] ?? "当前仅展示 demo 排列，不代表真实推荐。"}
                    </p>
                  </div>
                </div>

                <div className="flex gap-1.5 lg:flex-col">
                  <button
                    type="button"
                    className="icon-button"
                    disabled
                    aria-label={`${section.sectionId} 上移`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled
                    aria-label={`${section.sectionId} 下移`}
                  >
                    ↓
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

export function WishPlanPage({ catalog, session, onOpenTimetable }: WishPlanPageProps) {
  const sections = catalog?.courses.flatMap((course) => course.sections) ?? [];
  const candidateCount = session ? countSessionPoolSections(session) : sections.length;
  const readiness = getRecommendationReadiness(session);

  return (
    <section className="page-shell page-stack" aria-labelledby="wish-heading">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 id="wish-heading" className="text-2xl font-semibold tracking-[-0.015em] text-ink">
            待筛选志愿
          </h1>
          <p className="mt-2 max-w-[65ch] text-[13.5px] leading-6 text-ink-muted">
            课程志愿组、时间槽志愿组和顺位解释只做展示。硬约束仍等待 selection-model 终校验。
          </p>
        </div>
        <span className="pill pill-neutral px-3 py-1.5">风险 · 暂不可评估</span>
      </div>

      {session ? (
        <div className="grid gap-4">
          <div className="panel p-5">
            <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">尚未生成推荐</p>
                  <span className="pill pill-warn px-2.5 py-1">LLM 未接入</span>
                  <span className="pill pill-neutral px-2.5 py-1">selection-model 待接入</span>
                </div>
                <p className="mt-2 text-[13.5px] text-ink-muted">Session 草稿：{session.name}</p>
                <p className="mt-1 text-[13.5px] text-ink-muted">
                  待选池目标：{session.pool.targets.length} 门课程
                </p>
                <p className="mt-1 text-[13.5px] text-ink-muted">
                  候选教学班总数：{candidateCount}
                </p>
                <p className="mt-3 max-w-[68ch] text-[13px] leading-6 text-ink-muted">
                  硬约束由 selection-model 保证；LLM 只做组内软排序与解释。当前不收集 key，不调用
                  planner，不写入 zdbk。
                </p>
              </div>

              <button
                type="button"
                disabled={!readiness.canGenerateRecommendation}
                className="secondary-button px-4 py-2.5 text-ink-disabled disabled:bg-card-alt"
              >
                生成推荐（LLM 未配置）
              </button>
            </div>
          </div>

          <div className="panel p-5">
            <h2 className="text-[15px] font-semibold text-ink">生成推荐前置状态</h2>
            <p className="mt-2 text-[13.5px] leading-6 text-ink-muted">{readiness.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {readiness.items.map((item) => (
                <p
                  key={item.id}
                  className={`pill px-3 py-1.5 ${
                    item.state === "ready"
                      ? "pill-ok"
                      : item.state === "missing"
                        ? "pill-warn"
                        : "pill-neutral"
                  }`}
                >
                  {item.label}：{item.detail}
                </p>
              ))}
            </div>
            <p className="mt-4 text-[12.5px] leading-5 text-ink-faint">
              当前不收集、不保存 key，不会调用 LLM、planner 或写入 zdbk。
            </p>
            <button
              type="button"
              className="secondary-button mt-4 px-4 py-2.5"
              onClick={onOpenTimetable}
            >
              查看预期课表
            </button>
          </div>

          {catalog ? (
            <>
              <div className="grid gap-4">{catalog.courses.map(renderCourseGroup)}</div>
              <article className="rounded-[16px] border border-dashed border-warn-border bg-paper-deep p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="pill pill-warn px-2.5 py-1">时间槽志愿组</span>
                  <span className="pill pill-warn px-2.5 py-1">已失效</span>
                </div>
                <h3 className="mt-3 text-[16px] font-semibold text-ink">周一 1-2 节偏好组</h3>
                <p className="mt-2 max-w-[68ch] text-[13px] leading-6 text-ink-muted">
                  已被课程志愿组“合成微积分演示”占用（周一 1-2 节）。demo
                  中只展示失效原因，真实取舍等待 selection-model 输出。
                </p>
              </article>
            </>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {session.pool.targets.map((target) => (
                <li key={target.courseCode} className="panel p-4 text-[13px]">
                  <div className="font-mono font-semibold text-ink">{target.courseCode}</div>
                  <div className="mt-2 leading-6 text-ink-muted">
                    候选教学班：{target.candidateSectionIds.join(" / ")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="panel-soft p-5 text-[13.5px] leading-6 text-ink-muted">
          <p className="font-semibold text-ink">尚未加载课程数据</p>
          <p className="mt-1">请先回到“导入/导出”加载合成 Demo 数据。</p>
        </div>
      )}
    </section>
  );
}
