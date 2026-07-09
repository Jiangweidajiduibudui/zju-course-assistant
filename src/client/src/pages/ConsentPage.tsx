import { useAppStore } from '../stores/useAppStore';

export default function ConsentPage() {
  const { giveConsent } = useAppStore();

  return (
    <div className="consent-overlay">
      <div className="consent-card">
        <h1>🎓 ZJU 选课助手</h1>
        <p className="subtitle">advise-only · 只建议，不写入 zdbk</p>

        <div className="consent-section">
          <h3>📌 我们做什么</h3>
          <p>
            读取你的课程和志愿数据，结合查老师评价和你的偏好，
            用确定性规则检查时间冲突、学分上限，AI 辅助排序，给出一份
            <strong>推荐方案和预期课表</strong>。
          </p>
        </div>

        <div className="consent-section">
          <h3>🚫 我们绝不做什么</h3>
          <p>
            ❌ 不调用选课、退选、调序等任何写接口<br />
            ❌ 不处理你的 zdbk 密码、Cookie 或 token<br />
            ❌ 不宣称能评估录取概率（一律显示"暂不可评估"）
          </p>
        </div>

        <div className="consent-section">
          <h3>🔐 隐私与数据</h3>
          <p>
            你的课程数据存储在浏览器本地。如果你配置了 LLM key，
            课表和偏好会发送到你指定的 API 端点，<strong>绝不包含</strong>
            姓名、学号、Cookie 等个人身份信息。
          </p>
        </div>

        <div className="consent-section">
          <h3>⚠️ 免责声明</h3>
          <p style={{ fontSize: 13 }}>
            本工具仅供辅助参考，推荐方案不代表官方选课结果。
            所有选课操作请手动在
            <a href="https://zdbk.zju.edu.cn" target="_blank" rel="noopener noreferrer">zdbk.zju.edu.cn</a>
            {' '}完成。使用本工具即表示你已阅读并同意以上条款。
          </p>
        </div>

        <div className="consent-actions">
          <button className="btn btn-primary btn-lg" onClick={giveConsent}>
            同意并开始使用 →
          </button>
          <button className="btn btn-outline btn-lg" onClick={() => {
            window.location.href = 'https://zdbk.zju.edu.cn';
          }}>
            返回 zdbk
          </button>
        </div>
      </div>
    </div>
  );
}
