import { Outlet, NavLink } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import RollbackBar from './RollbackBar';

export default function Layout() {
  const { pool, plan, planLocked, planConflicts } = useAppStore();
  const scheduledCount = plan?.entries.length || 0;
  const conflictCount = planConflicts.length;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <div className="app-logo">Z</div>
          <span className="app-title">ZJU 选课助手</span>
          <span className="app-badge">advise-only</span>
        </div>

        <nav className="app-nav">
          <NavLink to="/pool" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            📚 课程池
          </NavLink>
          <NavLink to="/schedule" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            📅 预期课表
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            ⚙️ 设置
          </NavLink>
        </nav>

        <div className="header-actions">
          <div className="header-stat">📝 候选 <strong>{pool.length}</strong></div>
          <div className="header-stat">📅 已排 <strong>{scheduledCount}</strong></div>
          {planLocked && <div className="header-stat" style={{ color: 'var(--primary)' }}>🔒 已定稿</div>}
          {conflictCount > 0 && (
            <div className="header-stat" style={{ color: 'var(--danger)' }}>
              ⚠️ 冲突 <strong style={{ color: 'var(--danger)' }}>{conflictCount}</strong>
            </div>
          )}
        </div>
      </header>

      <RollbackBar />
      <div className="app-main">
        <Outlet />
      </div>
    </div>
  );
}
