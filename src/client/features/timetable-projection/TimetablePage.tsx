import type { Catalog, Section, Session } from "../../../shared/contracts/index.js";
import { countSessionPoolSections } from "../session/sessionSummary";
import { type GridEntry, TimetableGrid } from "./TimetableGrid";

/**
 * 预期课表页（组员 E；docs/08 §8.2 —— zdbk 心智模型）。
 *
 * 定位：投影当前首选方案的预期课表；备选堆叠仅作标记。
 * 边界：不得把互斥备选渲染成“同时上课”；考试/学分未知的教学班不进课表（D37/D38）。
 */
interface TimetablePageProps {
  catalog: Catalog | null;
  session: Session | null;
}

function buildSectionMap(catalog: Catalog | null): Map<string, Section> {
  const sectionMap = new Map<string, Section>();
  for (const course of catalog?.courses ?? []) {
    for (const section of course.sections) sectionMap.set(section.sectionId, section);
  }
  return sectionMap;
}

function buildGridEntries(catalog: Catalog | null, session: Session | null): GridEntry[] {
  if (!catalog || !session) return [];
  const sectionMap = buildSectionMap(catalog);
  const plan = session.plan;
  const sectionIds = plan
    ? plan.volunteers.map((volunteer) => volunteer.sectionId)
    : session.pool.targets.flatMap((target) => target.candidateSectionIds);
  const seen = new Set<string>();
  const entries: GridEntry[] = [];

  for (const sectionId of sectionIds) {
    if (seen.has(sectionId)) continue;
    seen.add(sectionId);
    const section = sectionMap.get(sectionId);
    if (!section || !section.examTime || !section.credits) continue;
    entries.push({
      sectionId: section.sectionId,
      courseName: section.courseName,
      courseCode: section.courseCode,
      slots: section.slots,
      teacherName: section.teachers.join("、"),
      location: section.place ?? undefined,
    });
  }
  return entries;
}

function missingReason(section: Section): string | null {
  if (section.examTime === null) return "考试时间缺失";
  if (section.credits === null) return "学分缺失";
  return null;
}

export function TimetablePage({ catalog, session }: TimetablePageProps) {
  const entries = buildGridEntries(catalog, session);
  const poolSectionCount = session ? countSessionPoolSections(session) : 0;
  const plan = session?.plan;
  const excluded = (catalog?.courses.flatMap((course) => course.sections) ?? []).filter((section) =>
    missingReason(section),
  );

  return (
    <section className="page-shell page-stack" aria-labelledby="timetable-heading">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 id="timetable-heading" className="text-2xl font-semibold tracking-[-0.015em] text-ink">
            预期课表
          </h1>
          <p className="mt-2 max-w-[65ch] text-[13.5px] leading-6 text-ink-muted">
            {session
              ? plan
                ? `方案「${plan.planId}」· ${plan.volunteers.length} 个志愿`
                : `待选池预览 · ${session.pool.targets.length} 门课程 / ${poolSectionCount} 个候选教学班`
              : "尚未加载课程数据。请先回到“导入/导出”加载合成 Demo 数据。"}
          </p>
        </div>
        <div className="flex rounded-[11px] border border-hairline bg-card p-1 shadow-warm-1">
          <button type="button" className="segment-button bg-blue-soft px-3 py-2 text-blue-ink">
            秋学期
          </button>
          <button type="button" className="segment-button px-3 py-2 text-ink-faint" disabled>
            冬学期
          </button>
        </div>
      </div>

      {session ? (
        <div className="grid gap-4">
          <div className="panel p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="font-semibold text-ink">
                  {plan ? "当前候选方案预览" : "等待 selection-model 输出"}
                </p>
                <p className="mt-2 text-[13.5px] text-ink-muted">Session 草稿：{session.name}</p>
                <p className="mt-1 text-[13.5px] text-ink-muted">
                  待选池：{session.pool.targets.length} 门课程 / {poolSectionCount} 个候选教学班
                </p>
              </div>
              <span className="pill pill-neutral px-3 py-1.5">projection.v1</span>
            </div>
            <p className="mt-3 max-w-[76ch] text-[13px] leading-6 text-ink-muted">
              {plan
                ? "本页只渲染 planner/selection-model 输出，不自行判断合法性。"
                : "当前用待选池可入课表教学班做预览；硬字段缺失的教学班留在待选池，不进入课表。"}
            </p>
          </div>

          {plan ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="panel p-4 text-[13px] text-ink-muted">
                <span className="text-[20px] font-semibold text-ink">{plan.volunteers.length}</span> 个志愿
              </div>
              <div className="panel p-4 text-[13px] text-ink-muted">
                <span className="text-[20px] font-semibold text-ink">{plan.groups.length}</span> 个志愿组
              </div>
              <div className="panel p-4 text-[13px] text-ink-muted">
                锁定 <span className="text-[20px] font-semibold text-ink">{plan.volunteers.filter((v) => v.locked).length}</span> 项
              </div>
            </div>
          ) : null}

          {entries.length < poolSectionCount ? (
            <div className="rounded-[14px] border border-warn-border bg-warn-bg p-4 text-[13px] leading-6 text-warn">
              ⚠️ 部分教学班因考试时间或学分缺失未进入课表（D37/D38）。请返回“待筛选志愿”补全缺失信息。
            </div>
          ) : null}

          <TimetableGrid entries={entries} />

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="panel p-5">
              <h2 className="text-[15px] font-semibold text-ink">待选池说明区</h2>
              <div className="mt-4 grid gap-3">
                {excluded.length > 0 ? (
                  excluded.map((section) => (
                    <div key={section.sectionId} className="rounded-[12px] border border-warn-border bg-warn-bg p-3 text-[12.5px] leading-5 text-warn">
                      <p className="font-mono font-semibold">{section.sectionId}</p>
                      <p className="mt-1">reasonCode：{missingReason(section)}</p>
                      <p className="mt-1">缺失硬字段，留待选池，不进入课表。</p>
                    </div>
                  ))
                ) : (
                  <p className="text-[13px] text-ink-muted">暂无硬字段缺失教学班。</p>
                )}
              </div>
            </div>

            <div className="panel p-5">
              <h2 className="text-[15px] font-semibold text-ink">为什么这样排</h2>
              <div className="mt-4 rounded-[12px] border border-blue-soft-border bg-blue-soft p-4 text-[12.5px] leading-6 text-blue-ink">
                <p className="font-semibold">示例 · LLM 未接入</p>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  <li>首选可入课表教学班进入网格。</li>
                  <li>重叠或缺失硬字段的候选留在待选池说明区。</li>
                  <li>正式推荐以 selection-model 终校验结果为准。</li>
                </ul>
              </div>
              <div className="mt-4 grid gap-2 text-[12.5px] leading-5 text-ok">
                <p className="pill pill-ok justify-start px-3 py-2">deterministic · 事实：{session.pool.targets.length} 门课程 / {poolSectionCount} 个教学班</p>
                <p className="pill pill-ok justify-start px-3 py-2">advise-only 不写入 zdbk</p>
              </div>
              <p className="mt-4 text-[12.5px] text-ink-faint">风险：暂不可评估</p>
            </div>
          </div>

          {entries.length > 0 ? (
            <button
              type="button"
              className="secondary-button w-fit px-4 py-2.5"
              onClick={() => {
                const lines = entries.map(
                  (entry) =>
                    `${entry.courseCode} ${entry.courseName}: ${entry.slots.map((slot) => `周${slot.dayOfWeek}第${slot.period}节`).join(" / ")}`,
                );
                const text = `预期课表\n${"=".repeat(36)}\n\n${lines.join("\n")}`;
                navigator.clipboard.writeText(text).catch(() => undefined);
              }}
            >
              复制课表文本
            </button>
          ) : null}
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
