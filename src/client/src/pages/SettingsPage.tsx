import { useAppStore } from '../stores/useAppStore';

export default function SettingsPage() {
  const { llmKey, setLLMKey, preferences, setPreferences } = useAppStore();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">⚙️ 设置</h1>
          <p className="page-subtitle">配置 LLM API 和推荐偏好</p>
        </div>
      </div>

      <div className="settings-form">
        {/* LLM Key */}
        <div className="form-group">
          <label className="form-label">🔑 LLM API 密钥</label>
          <p className="form-hint">
            支持任何 OpenAI 兼容接口。密钥仅存储在浏览器本地，不上传至我们的服务器。
          </p>
          <input
            className="form-input"
            type="password"
            placeholder="sk-… 或自定义端点 key"
            value={llmKey}
            onChange={(e) => setLLMKey(e.target.value)}
          />
          <p className="form-hint" style={{ marginTop: 4 }}>
            不填也可以使用基本功能；AI 排序和评价摘要需要 key。
          </p>
        </div>

        {/* Weights */}
        <div className="form-group">
          <label className="form-label">📊 推荐权重</label>
          <p className="form-hint">拖动滑块调整求解器的偏好权重</p>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13 }}>教师评分权重</span>
              <span className="range-value">{preferences.teacherWeight}</span>
            </div>
            <div className="range-row">
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>低</span>
              <input
                type="range" min="0" max="10"
                value={preferences.teacherWeight}
                onChange={(e) => setPreferences({ teacherWeight: Number(e.target.value) })}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>高</span>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13 }}>时间偏好权重</span>
              <span className="range-value">{preferences.timeWeight}</span>
            </div>
            <div className="range-row">
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>低</span>
              <input
                type="range" min="0" max="10"
                value={preferences.timeWeight}
                onChange={(e) => setPreferences({ timeWeight: Number(e.target.value) })}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>高</span>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13 }}>课业均匀分布权重</span>
              <span className="range-value">{preferences.balanceWeight}</span>
            </div>
            <div className="range-row">
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>低</span>
              <input
                type="range" min="0" max="10"
                value={preferences.balanceWeight}
                onChange={(e) => setPreferences({ balanceWeight: Number(e.target.value) })}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>高</span>
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div className="form-group">
          <label className="form-label">🚫 约束选项</label>

          <div className="toggle-row">
            <span className="toggle-label">避开早八（8:00 开始的课）</span>
            <button
              className={`toggle-switch${preferences.avoidEarlyMorning ? ' on' : ''}`}
              onClick={() => setPreferences({ avoidEarlyMorning: !preferences.avoidEarlyMorning })}
              aria-label="Toggle avoid early morning"
            />
          </div>

          <div className="toggle-row">
            <span className="toggle-label">避开晚课（18:30 后的课）</span>
            <button
              className={`toggle-switch${preferences.avoidLateEvening ? ' on' : ''}`}
              onClick={() => setPreferences({ avoidLateEvening: !preferences.avoidLateEvening })}
              aria-label="Toggle avoid late evening"
            />
          </div>

          <div className="toggle-row">
            <span className="toggle-label">偏好天数集中</span>
            <button
              className={`toggle-switch${preferences.preferCompactDays ? ' on' : ''}`}
              onClick={() => setPreferences({ preferCompactDays: !preferences.preferCompactDays })}
              aria-label="Toggle prefer compact days"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
