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
export function WishPlanPage() {
  return (
    <section className="p-6">
      <h2 className="text-lg font-bold">待筛选志愿（Task 5 交付）</h2>
      <p className="mt-2 text-sm text-gray-500">
        课程志愿组 / 时间槽志愿组 / 顺位调整 / 失效原因说明 —— 见 docs/08 §8.1。
      </p>
    </section>
  );
}
