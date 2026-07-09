import { ArrowDown, ArrowUp, Unlock } from "lucide-react";
import type { Catalog, PoolTarget, Section, Session } from "../../../shared/contracts/index.js";
import { getRecommendationReadiness } from "../session/recommendationReadiness";
import { countSessionPoolSections } from "../session/sessionSummary";

/**
 * 待筛选志愿页（组员 E；docs/08 §8.1 —— zdbk 心智模型）。
 *
 * 定位：以课程志愿组展示"待筛选志愿"；每项显示课程、教学班、教师、时间、
 *      考试、学分、chalaoshi 状态、缺失字段。
 * 交互：上移/下移调整顺位（不做自由拖拽，D18）；手动调整后该组顺位锁定，
 *      重新优化不得改动（AC-7.1）。
 * 边界：不直接调用外部 LLM 或 chalaoshi（一切走同源 /api）；
 *      不自行判断志愿合法性 —— 状态由 selection-model 产出，本页只渲染。
 * 成功判据：Task 5 门禁 + Playwright 主流程（docs/05 §5.1）。
 */
interface WishPlanPageProps {
  catalog: Catalog | null;
  session: Session | null;
  onOpenTimetable: () => void;
}

export function WishPlanPage({ catalog, session, onOpenTimetable }: WishPlanPageProps) {
  const candidateCount = session ? countSessionPoolSections(session) : 0;
  const readiness = getRecommendationReadiness(session);

  if (!session) {
    return (
      <section className="space-y-4 p-6">
        <h2 className="text-lg font-bold">待筛选志愿</h2>
        <p className="rounded-lg border bg-white p-4 text-sm text-gray-600">
          尚未加载课程数据。请先回到"导入/导出"加载合成 Demo 数据。
        </p>
      </section>
    );
  }

  if (session.pool.targets.length === 0) {
    return (
      <section className="space-y-4 p-6">
        <h2 className="text-lg font-bold">待筛选志愿</h2>
        <p className="rounded-lg border bg-white p-4 text-sm text-gray-600">
          Session「{session.name}」已创建，但待选池为空。
          请先回到"导入/导出"导入课程目录，系统会自动将全部教学班加入候选池。
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">待筛选志愿</h2>
          <p className="text-sm text-gray-500">
            {session.pool.targets.length} 门课程 · {candidateCount} 个候选教学班
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          disabled
          onClick={onOpenTimetable}
        >
          生成推荐（等待 planner 接入）
        </button>
      </div>

      {/* Readiness checklist */}
      <details className="rounded-lg border bg-white p-4 text-sm">
        <summary className="cursor-pointer font-semibold">
          生成推荐前置状态（{readiness.userPrerequisitesMet ? "已就绪" : "未满足"}）
        </summary>
        <ul className="mt-3 space-y-2">
          {readiness.items.map((item) => (
            <li
              key={item.id}
              className={
                item.state === "ready"
                  ? "text-emerald-700"
                  : item.state === "missing"
                    ? "text-amber-700"
                    : "text-gray-600"
              }
            >
              {item.label}：{item.detail}
            </li>
          ))}
        </ul>
      </details>

      {/* Pool target list */}
      <ul className="space-y-3">
        {session.pool.targets.map((target, index) => (
          <PoolTargetCard
            key={target.courseCode}
            target={target}
            index={index}
            total={session.pool.targets.length}
            catalog={catalog}
          />
        ))}
      </ul>

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border border-gray-300 px-3 py-2 text-sm"
          onClick={onOpenTimetable}
        >
          查看预期课表
        </button>
      </div>
    </section>
  );
}

/** 单门课程的候选池卡片 */
function PoolTargetCard({
  target,
  index,
  total,
  catalog,
}: {
  target: PoolTarget;
  index: number;
  total: number;
  catalog: Catalog | null;
}) {
  const sectionMap = new Map<string, Section>();
  if (catalog) {
    for (const course of catalog.courses) {
      for (const section of course.sections) {
        sectionMap.set(section.sectionId, section);
      }
    }
  }

  const candidateSections = target.candidateSectionIds
    .map((sid) => sectionMap.get(sid))
    .filter((s): s is Section => s != null);

  return (
    <li className="rounded-lg border bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-blue-100 px-2 py-0.5 font-mono text-xs text-blue-700">
              {target.courseCode}
            </span>
            <h3 className="font-semibold">
              {catalog
                ? (catalog.courses.find((c) => c.courseCode === target.courseCode)?.courseName ??
                  target.courseCode)
                : target.courseCode}
            </h3>
            <span className="text-xs text-gray-400">{candidateSections.length} 个候选教学班</span>
          </div>

          {/* Section list */}
          {candidateSections.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {candidateSections.map((section) => (
                <li
                  key={section.sectionId}
                  className="flex items-center gap-2 rounded bg-gray-50 px-3 py-1.5 text-sm"
                >
                  <span className="font-mono text-xs text-gray-500">{section.sectionId}</span>
                  <span className="text-gray-700">{section.courseName}</span>
                  {section.examTime ? (
                    <span className="text-xs text-gray-400">考试：{section.examTime.raw}</span>
                  ) : (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                      考试未知
                    </span>
                  )}
                  {section.credits ? (
                    <span className="text-xs text-gray-400">{section.credits}学分</span>
                  ) : (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                      学分缺失
                    </span>
                  )}
                  {/* Time slots */}
                  <span className="text-xs text-gray-400">
                    {section.slots.map((s) => `周${s.dayOfWeek}第${s.period}节`).join(" / ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-amber-600">候选教学班尚未加载到当前 catalog 中。</p>
          )}

          {/* Missing info warnings */}
          {candidateSections.some((s) => !s.examTime || !s.credits) && (
            <p className="mt-2 text-xs text-amber-600">
              ⚠️
              部分教学班考试时间或学分缺失——这些教学班在生成推荐时将留在待选池，不参与排课（D37/D38）。
            </p>
          )}
        </div>

        {/* Reorder controls */}
        <div className="ml-4 flex flex-col gap-1">
          <button
            type="button"
            disabled={index === 0}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
            title="上移"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
            title="下移"
          >
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            className="mt-2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="锁定此项（重新优化不得改动）"
          >
            <Unlock size={14} />
          </button>
        </div>
      </div>
    </li>
  );
}
