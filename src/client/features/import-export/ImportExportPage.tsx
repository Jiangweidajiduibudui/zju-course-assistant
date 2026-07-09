import type {
  Catalog,
  Course,
  Section,
  Session,
  TermSlot,
} from "../../../shared/contracts/index.js";
import { countSessionPoolSections } from "../session/sessionSummary";
import { getSyntheticDemoCatalog } from "./demoCatalog";
import { buildExportEnvelope, formatExportEnvelopePreview } from "./exportEnvelope";

/**
 * 导入/导出页（组员 A 提供 API 契约，组员 E 实现 UI；docs/08 §5.1）。
 *
 * 定位：内置 Demo 数据加载、JSON 导入（错误逐条定位展示）、少量字段修正、
 *      导出当前 JSON（export.v1 往返一致）。
 * 边界：不索取 zdbk 密码/Cookie/token；不访问 zdbk；不伪装真实推荐。
 */
interface ImportExportPageProps {
  catalog: Catalog | null;
  session: Session | null;
  onLoadDemoCatalog: (catalog: Catalog) => void | Promise<void>;
  onOpenTimetable: () => void;
  onOpenWishPlan: () => void;
}

interface SectionStatus {
  label: string;
  tone: "ok" | "warn";
}

const termLabels: Record<TermSlot["term"], string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

function sectionStatus(section: Section): SectionStatus[] {
  const status: SectionStatus[] = [];
  if (section.examTime === null) {
    status.push({ label: "考试时间缺失", tone: "warn" });
  }
  if (section.credits === null) {
    status.push({ label: "学分缺失", tone: "warn" });
  }
  if (status.length === 0) {
    status.push({ label: "硬字段完整", tone: "ok" });
  }
  return status;
}

function formatSlot(slot: TermSlot): string {
  return `${termLabels[slot.term]} 周${"一二三四五六日"[slot.dayOfWeek - 1]} ${slot.period} 节`;
}

function formatSectionTime(section: Section): string {
  if (section.slots.length === 0) {
    return "时间未知";
  }
  return section.slots.map(formatSlot).join(" / ");
}

function countIncompleteSections(courses: Course[]): number {
  return courses
    .flatMap((course) => course.sections)
    .filter((section) => section.examTime === null || section.credits === null).length;
}

export function ImportExportPage({
  catalog,
  session,
  onLoadDemoCatalog,
  onOpenTimetable,
  onOpenWishPlan,
}: ImportExportPageProps) {
  const sections = catalog?.courses.flatMap((course) => course.sections) ?? [];
  const exportPreview = session ? formatExportEnvelopePreview(buildExportEnvelope(session)) : null;
  const incompleteCount = catalog ? countIncompleteSections(catalog.courses) : 0;

  return (
    <section className="page-shell page-stack" aria-labelledby="import-heading">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 id="import-heading" className="text-2xl font-semibold tracking-[-0.015em] text-ink">
            导入 / 导出
          </h1>
          <p className="mt-2 max-w-[65ch] text-[13.5px] leading-6 text-ink-muted">
            加载合成 Demo 数据，预览 session 草稿和 export.v1。全程不访问 zdbk、chalaoshi 或 LLM。
          </p>
        </div>
        <p className="font-mono text-[12px] text-ink-faint">catalog.v1 · session.v1 · export.v1</p>
      </div>

      <div className="blue-panel grid gap-5 p-5 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <p className="text-[13px] font-semibold text-blue-ink">Demo mainline 入口</p>
          <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.01em] text-ink">
            用合成数据打通展示主线
          </h2>
          <p className="mt-2 max-w-[62ch] text-[13.5px] leading-6 text-blue-ink">
            不访问 zdbk/chalaoshi/LLM，不伪装真实推荐。缺少考试时间或学分的教学班会明确留在待选池。
          </p>
        </div>
        <button
          type="button"
          className="primary-button w-full px-4 py-3 md:w-auto"
          onClick={() => void onLoadDemoCatalog(getSyntheticDemoCatalog())}
        >
          {catalog ? "已加载 · 重新加载合成 Demo 数据" : "加载合成 Demo 数据"}
        </button>
      </div>

      {session ? (
        <div className="panel p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[13px] font-semibold text-blue-strong">当前 session 草稿</p>
              <h3 className="mt-1 text-xl font-semibold tracking-[-0.01em] text-ink">
                {session.name}
              </h3>
              <p className="mt-2 text-[13px] leading-6 text-ink-muted">
                baseline 从本次合成导入创建；当前 plan 为空，等待 selection-model 输出。
              </p>
            </div>
            <span className="pill pill-blue px-3 py-1.5">合成数据</span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[12px] bg-card-alt p-4">
              <p className="text-[11.5px] font-semibold text-ink-faint">待选池课程</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-ink">
                {session.pool.targets.length}
              </p>
            </div>
            <div className="rounded-[12px] bg-card-alt p-4">
              <p className="text-[11.5px] font-semibold text-ink-faint">候选教学班</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-ink">
                {countSessionPoolSections(session)}
              </p>
            </div>
            <div className="rounded-[12px] bg-card-alt p-4">
              <p className="text-[11.5px] font-semibold text-ink-faint">学分上限</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-ink">
                {session.rules.creditLimit ?? "未填写"}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-1 text-[13.5px] text-ink-body">
            <p>
              待选池：{session.pool.targets.length} 门课程 / {countSessionPoolSections(session)}{" "}
              个候选教学班
            </p>
            <p>学分上限：{session.rules.creditLimit ?? "未填写"}</p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className="primary-button px-4 py-2.5" onClick={onOpenWishPlan}>
              进入待筛选志愿
            </button>
            <button
              type="button"
              className="secondary-button px-4 py-2.5"
              onClick={onOpenTimetable}
            >
              查看预期课表
            </button>
          </div>
        </div>
      ) : null}

      {exportPreview ? (
        <div className="panel p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">JSON 导出预览（export.v1）</h3>
              <p className="mt-1 text-[13px] leading-6 text-ink-muted">
                仅展示预览，不提供复制或下载按钮。正式导出/再导入往返由后续 Task 2 接入。
              </p>
            </div>
            <span className="pill pill-neutral px-3 py-1.5 font-mono">preview only</span>
          </div>
          <div className="mt-4 rounded-[12px] border border-blue-soft-border bg-blue-soft p-4 text-[13px] leading-6 text-blue-ink">
            <p className="font-semibold">隐私提示：预览只包含当前 session 规划数据。</p>
            <p className="mt-1">不包含 API key、Cookie、zdbk token 或学号姓名。</p>
            <p className="mt-1">不会上传到服务端，也不会写入 zdbk。</p>
          </div>
          <pre className="mono-preview mt-4 max-h-80 overflow-auto p-4 text-[12px] leading-5">
            {exportPreview}
          </pre>
        </div>
      ) : null}

      {catalog ? (
        <div className="grid gap-4">
          <div className="panel p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[13px] font-semibold text-ok">合成演示数据</p>
                <p className="mt-1 text-[13.5px] leading-6 text-ink-muted">
                  已加载 {catalog.courses.length} 门课程 / {sections.length} 个教学班；生成时间：
                  {catalog.generatedAt}
                </p>
              </div>
              <span className="pill pill-warn px-3 py-1.5">缺失硬字段：{incompleteCount} 个</span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {catalog.courses.map((course) => (
              <article key={course.courseCode} className="panel overflow-hidden p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
                      {course.courseName}
                    </h3>
                    <p className="mt-1 font-mono text-[11.5px] text-ink-faint">
                      {course.courseCode} · {course.college ?? "学院未知"} ·{" "}
                      {course.category ?? "分类未知"}
                    </p>
                  </div>
                  <span className="pill pill-neutral px-2.5 py-1">{course.sections.length} 班</span>
                </div>

                <ul className="mt-4 grid gap-3">
                  {course.sections.map((section) => (
                    <li key={section.sectionId} className="rounded-[12px] bg-paper-deep p-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-ink">
                          {section.sectionId}
                        </span>
                        <span className="text-[13px] font-medium text-ink-body">
                          {section.teachers.join("、")}
                        </span>
                      </div>
                      <p className="mt-2 text-[12.5px] leading-5 text-ink-muted">
                        {formatSectionTime(section)}；学分：{section.credits ?? "未知"}；考试：
                        {section.examTime?.raw ?? "未知"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {sectionStatus(section).map((status) => (
                          <span
                            key={status.label}
                            className={`pill px-2.5 py-1 ${
                              status.tone === "ok" ? "pill-ok" : "pill-warn"
                            }`}
                          >
                            {status.label}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <div className="panel-soft p-5 text-[13.5px] leading-6 text-ink-muted">
          <p className="font-semibold text-ink">尚未加载课程数据</p>
          <p className="mt-1">请先使用合成 Demo 数据，或等待组员 A 的正式导入功能接入。</p>
        </div>
      )}
    </section>
  );
}
