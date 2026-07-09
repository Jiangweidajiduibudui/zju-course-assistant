import { clearAllLocalData } from "../../app/db";

/**
 * 设置页（组员 E；docs/08 §5.1）。
 *
 * 定位：隐私同意说明、LLM 端点配置（FR-10 向导入口）、学分上限、数据清除。
 * 边界：key 只存客户端（明文风险提示 + 掩码显示 + 一键删除，D11）；
 *      永不持久化到服务端；学分上限是生成推荐的必填前置（D38）。
 * 成功判据：AC-10.x、AC-11.3；E2E key 生命周期用例（docs/05 §5.1）。
 *
 * TODO(Task 5, 组员 E): LLM 端点配置向导（厂商预设 + 能力检测，D10/D22）。
 * TODO(Task 2, 组员 E): 学分上限表单（写入当前 session.rules.creditLimit）。
 */
export function SettingsPage() {
  return (
    <section className="p-6">
      <h2 className="mb-4 text-lg font-bold">设置（Task 2/5 交付）</h2>
      <button
        type="button"
        className="rounded border border-red-600 px-3 py-1 text-red-600"
        onClick={() => void clearAllLocalData()}
      >
        清除全部本地数据（AC-11.3）
      </button>
    </section>
  );
}
