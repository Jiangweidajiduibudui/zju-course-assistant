import type { Catalog, Session } from "../../../shared/contracts/index.js";
import { getRecommendationReadiness } from "../session/recommendationReadiness";
import { countSessionPoolSections } from "../session/sessionSummary";

/**
 * 待筛选志愿页（组员 E；docs/08 §8.1 —— zdbk 心智模型）。
 *
 * 定位：以课程志愿组 / 时间槽志愿组分块展示"待筛选志愿"；
 *      每项显示课程、教学班、教师、时间、考试、学分、chalaoshi 状态、缺失字段。
 * 交互：上移/下移调整顺位（不做自由拖拽，D18）；手动调整后该组顺位锁定，
 *      重新优化不得改动（AC-7.1）；时间槽组因课程组失效时必须展示原因（D37）。
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
  const sections = catalog?.courses.flatMap((course) => course.sections) ?? [];
  const candidateCount = session ? countSessionPoolSections(session) : sections.length;
  const readiness = getRecommendationReadiness(session);

  return (
    <section className="space-y-4 p-6">
      <h2 className="text-lg font-bold">待筛选志愿（Task 5 交付）</h2>
      <p className="mt-2 text-sm text-gray-500">
        课程志愿组 / 时间槽志愿组 / 顺位调整 / 失效原因说明 —— 见 docs/08 §8.1。
      </p>
      {session ? (
        <div className="space-y-3">
          <div className="rounded-lg border bg-white p-4">
            <p className="font-semibold">尚未生成推荐</p>
            <p className="mt-1 text-sm text-gray-600">Session 草稿：{session.name}</p>
            <p className="mt-1 text-sm text-gray-600">
              待选池目标：{session.pool.targets.length} 门课程
            </p>
            <p className="mt-1 text-sm text-gray-600">候选教学班总数：{candidateCount}</p>
            <p className="mt-1 text-sm text-gray-600">
              真正的课程志愿组、时间槽志愿组、锁定和重新优化将由 selection-model 与 Task 5
              接入；本页当前只展示主线骨架。
            </p>
          </div>

          <div className="rounded-lg border bg-white p-4">
            <h3 className="font-semibold">生成推荐前置状态</h3>
            <p className="mt-1 text-sm text-gray-600">{readiness.summary}</p>
            <ul className="mt-3 space-y-2 text-sm">
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
            <button
              type="button"
              disabled={!readiness.canGenerateRecommendation}
              className="mt-3 rounded border border-gray-300 px-3 py-2 text-sm text-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              生成推荐（LLM 未配置）
            </button>
            <p className="mt-2 text-xs text-gray-500">
              本按钮只是前置状态提示；当前不收集、不保存 key，不会调用 LLM、planner 或写入 zdbk。
            </p>
            <button
              type="button"
              className="mt-3 rounded border border-gray-300 px-3 py-2 text-sm"
              onClick={onOpenTimetable}
            >
              查看预期课表
            </button>
          </div>

          {catalog ? (
            <ul className="grid gap-2 md:grid-cols-2">
              {catalog.courses.map((course) => (
                <li key={course.courseCode} className="rounded-lg border bg-white p-3 text-sm">
                  <div className="font-medium">{course.courseName}</div>
                  <div className="text-gray-500">
                    候选教学班：{course.sections.map((section) => section.sectionId).join(" / ")}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {session.pool.targets.map((target) => (
                <li key={target.courseCode} className="rounded-lg border bg-white p-3 text-sm">
                  <div className="font-medium">{target.courseCode}</div>
                  <div className="text-gray-500">
                    候选教学班：{target.candidateSectionIds.join(" / ")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="rounded-lg border bg-white p-4 text-sm text-gray-600">
          尚未加载课程数据。请先回到“导入/导出”加载合成 Demo 数据。
        </p>
      )}
    </section>
  );
}
