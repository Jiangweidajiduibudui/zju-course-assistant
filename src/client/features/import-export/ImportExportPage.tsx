/**
 * 导入/导出页（组员 A 提供 API 契约，组员 E 实现 UI；docs/08 §5.1）。
 *
 * 定位：内置 Demo 数据加载、JSON 导入（错误逐条定位展示）、少量字段修正、
 *      导出当前 JSON（export.v1 往返一致 —— Task 2 门禁）。
 * 边界：首版不支持 Excel、截图 OCR、HTML 粘贴（docs/08 §5.1）；
 *      不索取 zdbk 密码/Cookie/token（AC-2.3）；导入时间必须展示（D20）。
 * 成功判据：导入→修改→导出→再导入一致；缺失硬字段正确留在待选池（Task 2 门禁）。
 */
export function ImportExportPage() {
  return (
    <section className="p-6">
      <h2 className="text-lg font-bold">导入 / 导出（Task 2 交付）</h2>
      <p className="mt-2 text-sm text-gray-500">
        内置 Demo 数据 / JSON 导入与错误定位 / 导出当前 JSON —— 见 docs/08 §5.1。
      </p>
    </section>
  );
}
