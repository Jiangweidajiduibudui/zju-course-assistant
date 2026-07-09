import type { Catalog, Section, Session } from "../../../shared/contracts/index.js";
import { countSessionPoolSections } from "../session/sessionSummary";
import { getSyntheticDemoCatalog } from "./demoCatalog";
import { buildExportEnvelope, formatExportEnvelopePreview } from "./exportEnvelope";

/**
 * 导入/导出页（组员 A 提供 API 契约，组员 E 实现 UI；docs/08 §5.1）。
 *
 * 定位：内置 Demo 数据加载、JSON 导入（错误逐条定位展示）、少量字段修正、
 *      导出当前 JSON（export.v1 往返一致 —— Task 2 门禁）。
 * 边界：首版不支持 Excel、截图 OCR、HTML 粘贴（docs/08 §5.1）；
 *      不索取 zdbk 密码/Cookie/token（AC-2.3）；导入时间必须展示（D20）。
 * 成功判据：导入→修改→导出→再导入一致；缺失硬字段正确留在待选池（Task 2 门禁）。
 */
interface ImportExportPageProps {
  catalog: Catalog | null;
  session: Session | null;
  onLoadDemoCatalog: (catalog: Catalog) => void | Promise<void>;
  onOpenTimetable: () => void;
  onOpenWishPlan: () => void;
}

function sectionStatus(section: Section): string[] {
  const status: string[] = [];
  if (section.examTime === null) {
    status.push("考试时间缺失");
  }
  if (section.credits === null) {
    status.push("学分缺失");
  }
  if (status.length === 0) {
    status.push("硬字段完整");
  }
  return status;
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

  return (
    <section className="space-y-5 p-6">
      <h2 className="text-lg font-bold">导入 / 导出（Task 2 交付）</h2>
      <p className="mt-2 text-sm text-gray-500">
        内置 Demo 数据 / JSON 导入与错误定位 / 导出当前 JSON —— 见 docs/08 §5.1。
      </p>

      <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50 p-4">
        <h3 className="font-semibold text-blue-950">Demo mainline 入口</h3>
        <p className="mt-1 text-sm text-blue-900">
          这里先只加载仓库内的合成 fixture，用来打通演示主线；不会访问 zdbk、chalaoshi 或
          LLM，也不会伪装成真实推荐。
        </p>
        <button
          type="button"
          className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
          onClick={() => void onLoadDemoCatalog(getSyntheticDemoCatalog())}
        >
          加载合成 Demo 数据
        </button>
      </div>

      {session ? (
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm font-semibold text-indigo-700">当前 session 草稿</p>
          <h3 className="mt-1 font-semibold">{session.name}</h3>
          <p className="mt-1 text-sm text-gray-600">
            待选池：{session.pool.targets.length} 门课程 / {countSessionPoolSections(session)}{" "}
            个候选教学班
          </p>
          <p className="mt-1 text-sm text-gray-600">
            学分上限：{session.rules.creditLimit ?? "未填写"}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            baseline 从本次合成导入创建；当前 plan 为空，等待 selection-model 输出。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-gray-900 px-3 py-2 text-sm text-white"
              onClick={onOpenWishPlan}
            >
              进入待筛选志愿
            </button>
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-2 text-sm"
              onClick={onOpenTimetable}
            >
              查看预期课表
            </button>
          </div>
        </div>
      ) : null}

      {exportPreview ? (
        <div className="rounded-lg border bg-white p-4">
          <h3 className="font-semibold">JSON 导出预览（export.v1）</h3>
          <p className="mt-1 text-sm text-gray-600">
            仅展示预览，不提供复制或下载按钮。正式导出/再导入往返由后续 Task 2 接入。
          </p>
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">隐私提示：预览只包含当前 session 规划数据。</p>
            <p className="mt-1">不包含 API key、Cookie、zdbk token 或学号姓名。</p>
            <p className="mt-1">不会上传到服务端，也不会写入 zdbk。</p>
          </div>
          <pre className="mt-3 max-h-80 overflow-auto rounded bg-gray-950 p-3 text-xs text-gray-100">
            {exportPreview}
          </pre>
        </div>
      ) : null}

      {catalog ? (
        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm font-semibold text-emerald-700">合成演示数据</p>
            <p className="mt-1 text-sm text-gray-600">
              已加载 {catalog.courses.length} 门课程 / {sections.length} 个教学班；生成时间：
              {catalog.generatedAt}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {catalog.courses.map((course) => (
              <article key={course.courseCode} className="rounded-lg border bg-white p-4">
                <h3 className="font-semibold">{course.courseName}</h3>
                <p className="mt-1 text-xs text-gray-500">
                  {course.courseCode} · {course.college ?? "学院未知"} ·{" "}
                  {course.category ?? "分类未知"}
                </p>
                <ul className="mt-3 space-y-2">
                  {course.sections.map((section) => (
                    <li key={section.sectionId} className="rounded bg-gray-50 p-3 text-sm">
                      <div className="font-medium">
                        {section.sectionId} · {section.teachers.join("、")}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        学分：{section.credits ?? "未知"} · 考试：
                        {section.examTime?.raw ?? "未知"}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {sectionStatus(section).map((status) => (
                          <span
                            key={status}
                            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900"
                          >
                            {status}
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
        <p className="rounded-lg border bg-white p-4 text-sm text-gray-600">
          尚未加载课程数据。请先使用合成 Demo 数据或等待组员 A 的正式导入功能接入。
        </p>
      )}
    </section>
  );
}
