import type { Catalog, Section, Session } from "../../../shared/contracts/index.js";
import { countSessionPoolSections } from "../session/sessionSummary";
import { type GridEntry, TimetableGrid } from "./TimetableGrid";

/**
 * 预期课表页（组员 E；docs/08 §8.2 —— zdbk 心智模型）。
 *
 * 定位：投影当前首选方案的预期课表；备选堆叠仅作标记。
 * 边界：不得把互斥备选渲染成"同时上课"；考试/学分未知的教学班不进课表（D37/D38）；
 *      本页只渲染 selection-model 的 TimetableProjection 输出，不自行计算冲突。
 * 附加：支持"为什么这样排"——展示 LLM 软理由 + deterministic 校验摘要。
 * 成功判据：Task 5 门禁 + Playwright 主流程（docs/05 §5.1）。
 */
interface TimetablePageProps {
  catalog: Catalog | null;
  session: Session | null;
}

function buildGridEntries(catalog: Catalog | null, session: Session | null): GridEntry[] {
  if (!catalog || !session) return [];

  const sectionMap = new Map<string, Section>();
  for (const course of catalog.courses) {
    for (const section of course.sections) {
      sectionMap.set(section.sectionId, section);
    }
  }

  // If plan exists, show plan volunteers; otherwise show pool candidates as preview
  const plan = session.plan;
  const sectionIds = plan
    ? plan.volunteers.map((v) => v.sectionId)
    : session.pool.targets.flatMap((t) => t.candidateSectionIds);

  const seen = new Set<string>();
  const entries: GridEntry[] = [];

  for (const sid of sectionIds) {
    if (seen.has(sid)) continue;
    seen.add(sid);
    const section = sectionMap.get(sid);
    if (!section) continue;
    // 考试/学分缺失的教学班不进课表（D37/D38）
    if (!section.examTime || !section.credits) continue;

    entries.push({
      sectionId: section.sectionId,
      courseName: section.courseName,
      courseCode: section.courseCode,
      slots: section.slots,
    });
  }

  return entries;
}

export function TimetablePage({ catalog, session }: TimetablePageProps) {
  const entries = buildGridEntries(catalog, session);
  const plan = session?.plan;
  const poolSectionCount = session ? countSessionPoolSections(session) : 0;

  if (!session) {
    return (
      <section className="space-y-4 p-6">
        <h2 className="text-lg font-bold">预期课表</h2>
        <p className="rounded-lg border bg-white p-4 text-sm text-gray-600">
          尚未加载课程数据。请先回到"导入/导出"加载合成 Demo 数据。
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">预期课表</h2>
          <p className="text-sm text-gray-500">
            {plan
              ? `方案「${plan.planId}」· ${plan.volunteers.length} 个志愿`
              : `待选池预览 · ${session.pool.targets.length} 门课程 / ${poolSectionCount} 个候选教学班`}
          </p>
        </div>
        {plan && (
          <span className="rounded bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
            当前为候选方案预览；planner 接入后切换为正式课表投影
          </span>
        )}
      </div>

      {/* Plan summary */}
      {plan && (
        <div className="flex gap-3 text-sm">
          <div className="rounded-lg border bg-white px-4 py-2">
            <span className="font-semibold">{plan.volunteers.length}</span> 个志愿
          </div>
          <div className="rounded-lg border bg-white px-4 py-2">
            <span className="font-semibold">{plan.groups.length}</span> 个志愿组
          </div>
          <div className="rounded-lg border bg-white px-4 py-2">
            锁定{" "}
            <span className="font-semibold">{plan.volunteers.filter((v) => v.locked).length}</span>{" "}
            项
          </div>
        </div>
      )}

      {/* Excluded sections warning */}
      {entries.length < poolSectionCount && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠️ 部分教学班因考试时间或学分缺失未进入课表（D37/D38）。 请返回"待筛选志愿"补全缺失信息。
        </div>
      )}

      {/* The actual grid */}
      <TimetableGrid entries={entries} />

      {/* Why explanation (placeholder until LLM is wired) */}
      {plan && (
        <details className="rounded-lg border bg-white p-4 text-sm">
          <summary className="cursor-pointer font-semibold">为什么这样排？</summary>
          <p className="mt-2 text-gray-500">
            LLM 软理由 + deterministic 校验摘要将在 planner 接入后展示。
          </p>
        </details>
      )}

      {/* Export */}
      {entries.length > 0 && (
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => {
              const lines = entries.map(
                (e) =>
                  `${e.courseCode} ${e.courseName}: ${e.slots.map((s) => `周${s.dayOfWeek}第${s.period}节`).join(" / ")}`,
              );
              const text = `预期课表\n${"=".repeat(36)}\n\n${lines.join("\n")}`;
              navigator.clipboard.writeText(text).catch(() => {
                // Clipboard write failed — silently ignore
              });
            }}
          >
            复制课表文本
          </button>
        </div>
      )}
    </section>
  );
}
