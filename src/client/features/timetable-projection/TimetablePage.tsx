import type { Catalog } from "../../../shared/contracts/index.js";

/**
 * 预期课表页（组员 E；docs/08 §8.2 —— zdbk 心智模型）。
 *
 * 定位：投影当前首选方案的预期课表；备选堆叠仅作标记。
 * 边界：不得把互斥备选渲染成"同时上课"；考试/学分未知的教学班显示在
 *      待选池说明区，不进课表（D37、D38）；本页只渲染 selection-model
 *      的 TimetableProjection 输出，不自行计算冲突。
 * 附加：支持"为什么这样排"——展示 LLM 软理由 + deterministic 校验摘要。
 * 成功判据：Task 5 门禁 + Playwright 主流程（docs/05 §5.1）。
 */
interface TimetablePageProps {
  catalog: Catalog | null;
}

export function TimetablePage({ catalog }: TimetablePageProps) {
  return (
    <section className="space-y-4 p-6">
      <h2 className="text-lg font-bold">预期课表（Task 5 交付）</h2>
      <p className="mt-2 text-sm text-gray-500">
        首选投影 / 备选堆叠 / 冲突与未知标记 —— 见 docs/08 §8.2。
      </p>
      {catalog ? (
        <div className="rounded-lg border bg-white p-4">
          <p className="font-semibold">等待 selection-model 输出</p>
          <p className="mt-1 text-sm text-gray-600">
            已加载合成 Demo catalog，但当前还没有合法候选方案和课表投影。Task 1/Task 5
            接入后，本页只渲染 `projectTimetable` 的结果，不自行计算冲突。
          </p>
        </div>
      ) : (
        <p className="rounded-lg border bg-white p-4 text-sm text-gray-600">
          尚未加载课程数据。请先回到“导入/导出”加载合成 Demo 数据。
        </p>
      )}
    </section>
  );
}
