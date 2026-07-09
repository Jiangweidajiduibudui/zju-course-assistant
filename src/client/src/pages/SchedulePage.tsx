import { useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { reoptimizePlan, detectConflicts } from '../utils/api';
import { validateCredits } from '../utils/validation';
import ScheduleGrid from '../components/ScheduleGrid';
import ConflictBadge from '../components/ConflictBadge';
import ExportMenu from '../components/ExportMenu';
import TeacherModal from '../components/TeacherModal';
import type { Teacher, PlanEntry } from '@shared/contracts';

export default function SchedulePage() {
  const {
    plan, planLocked, planConflicts, pool,
    courses, teachers, preferences,
    setPlan, setPlanConflicts, lockPlan, unlockPlan,
    toggleEntryLock, addToast, takeSnapshot,
  } = useAppStore();

  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [reoptimizing, setReoptimizing] = useState(false);
  const [diff, setDiff] = useState<string[]>([]);

  const entries = plan?.entries || [];
  const creditResult = validateCredits(entries);
  const totalCredits = creditResult.total;

  const handleReoptimize = async () => {
    if (!plan || pool.length === 0) return;
    setReoptimizing(true);
    try {
      const result = await reoptimizePlan(
        pool, plan, preferences, courses, teachers
      );

      // 如果已定稿，验证锁定条目未被改动
      if (planLocked) {
        const lockedEntries = plan.entries.filter((e) => e.locked);
        const newLockedEntries = result.plan.entries.filter(
          (e) => lockedEntries.some((le) => le.courseId === e.courseId)
        );
        let lockViolation = false;
        for (const le of lockedEntries) {
          const ne = newLockedEntries.find((e) => e.courseId === le.courseId);
          if (!ne || ne.sectionId !== le.sectionId) {
            lockViolation = true;
            break;
          }
        }
        if (lockViolation) {
          addToast('❌ 错误：已锁定条目的教学班被改动，已阻止', 'error');
          setReoptimizing(false);
          return;
        }
        if (result.diff.length === 0) {
          addToast('✅ 方案已定稿，无需重新优化', 'info');
        } else {
          addToast(`✅ 仅调整了 ${result.diff.length} 项非锁定条目`, 'success');
        }
      }

      setPlan(result.plan);
      setPlanConflicts(detectConflicts(result.plan.entries));
      setDiff(result.diff);
      addToast('方案已重新优化', 'success');
    } catch (err) {
      addToast('重新优化失败', 'error');
    } finally {
      setReoptimizing(false);
    }
  };

  const handleResolveConflicts = () => {
    if (!plan || planConflicts.length === 0) {
      addToast('当前没有冲突', 'info');
      return;
    }

    takeSnapshot();
    // 自动解决：保留评分更高的教师，移除冲突的其他条目
    const toRemove = new Set<string>();
    for (const c of planConflicts) {
      if (c.type !== 'time') continue;
      const [aId, bId] = c.courseIds;
      const a = plan.entries.find((e) => e.courseId === aId);
      const b = plan.entries.find((e) => e.courseId === bId);
      if (!a || !b) continue;
      // 不删除已锁定的条目
      if (a.locked && !b.locked) toRemove.add(bId);
      else if (b.locked && !a.locked) toRemove.add(aId);
      else if (!a.locked && !b.locked) {
        // 保留评分更高的
        const aRating = a.teacherRating || 0;
        const bRating = b.teacherRating || 0;
        toRemove.add(aRating >= bRating ? bId : aId);
      }
    }

    if (toRemove.size === 0) {
      addToast('冲突涉及已锁定条目，无法自动解决。请手动调整候选池。', 'warning');
      return;
    }

    const newEntries = plan.entries.filter((e) => !toRemove.has(e.courseId));
    const newPlan = { ...plan, entries: newEntries };
    const newConflicts = detectConflicts(newEntries);

    setPlan(newPlan);
    setPlanConflicts(newConflicts);
    addToast(`已自动解决 ${toRemove.size} 个冲突（保留评分更高的教师）`, 'success');
  };

  const handleEntryClick = (entry: PlanEntry) => {
    const teacher = teachers.find((t) => t.id === entry.teacherId);
    if (teacher) setSelectedTeacher(teacher);
  };

  const handleLockPlan = () => {
    if (!plan) return;
    lockPlan();
    addToast('🔒 方案已定稿——锁定的条目在重新优化时不会被改动', 'success');
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">📅 预期课表</h1>
          <p className="page-subtitle">
            {planLocked
              ? '🔒 方案已定稿 · 锁定条目不受重新优化影响'
              : '点击课程块可查看教师详情 · 锁定单条可防止被改动'}
          </p>
        </div>
        <div className="btn-group">
          <ExportMenu entries={entries} disabled={entries.length === 0} />
          <button
            className="btn btn-outline btn-sm"
            onClick={handleReoptimize}
            disabled={reoptimizing || pool.length === 0}
          >
            {reoptimizing ? '⏳ 优化中…' : '🔄 重新优化'}
          </button>
          {!planLocked ? (
            <button className="btn btn-success btn-sm" onClick={handleLockPlan} disabled={!plan}>
              🔒 定稿
            </button>
          ) : (
            <button className="btn btn-outline btn-sm" onClick={() => { unlockPlan(); addToast('方案已解锁', 'info'); }}>
              🔓 解锁
            </button>
          )}
        </div>
      </div>

      {/* Summary row */}
      <div className="summary-row">
        <div className={`summary-item${!creditResult.valid ? ' danger' : ''}`}>
          <span>📐</span>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>学分合计</div>
            <span className="si-value">{totalCredits}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> / 30</span>
          </div>
        </div>
        <div className="summary-item">
          <span>📚</span>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>课程数</div>
            <span className="si-value">{entries.length}</span>
          </div>
        </div>
        <div className={`summary-item${planConflicts.length > 0 ? ' warn' : ''}`}>
          <span>⚠️</span>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>冲突</div>
            <span className="si-value">{planConflicts.length}</span>
          </div>
        </div>
        <div className="summary-item">
          <span>🔒</span>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>已锁定</div>
            <span className="si-value">{entries.filter((e) => e.locked).length}</span>
          </div>
        </div>
      </div>

      {/* Conflict banner */}
      <ConflictBadge conflicts={planConflicts} onResolve={handleResolveConflicts} />

      {/* Diff display */}
      {diff.length > 0 && (
        <div className="conflict-banner" style={{ background: 'var(--primary-light)', border: '1px solid var(--primary)', color: 'var(--primary)' }}>
          <span>🔄 变更摘要：</span>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 400 }}>
            {diff.join(' · ')}
          </span>
          <button className="btn btn-sm btn-outline" onClick={() => setDiff([])}>✕</button>
        </div>
      )}

      {/* Schedule grid */}
      {entries.length === 0 ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="icon">📅</div>
          <h3>暂无课表</h3>
          <p>前往「课程池」添加候选课程，然后点击「智能生成课表」</p>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ marginBottom: 8, display: 'flex', gap: 12 }}>
            {[...new Set(entries.map((e) => e.courseId))].map((cid, i) => {
              const entry = entries.find((e) => e.courseId === cid);
              if (!entry) return null;
              return (
                <div key={cid} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <div style={{
                    width: 12, height: 12, borderRadius: 3,
                    background: ['#E3F2FD', '#FFF3E0', '#E8F5E9', '#FCE4EC', '#F3E5F5',
                      '#E0F7FA', '#FFF8E1', '#EDE7F6', '#E8EAF6', '#F1F8E9'][i % 10],
                    borderLeft: `3px solid ${['#1E88E5', '#FB8C00', '#43A047', '#E53935', '#8E24AA',
                      '#00ACC1', '#FDD835', '#5C6BC0', '#3949AB', '#7CB342'][i % 10]}`,
                  }} />
                  <span
                    style={{ cursor: 'pointer', fontWeight: entry.locked ? 700 : 400 }}
                    onClick={() => {
                      if (!planLocked) toggleEntryLock(cid);
                    }}
                    title={entry.locked ? '🔒 已锁定 (点击解锁)' : '点击锁定此课程'}
                  >
                    {entry.locked ? '🔒 ' : ''}{entry.courseName}
                  </span>
                </div>
              );
            })}
          </div>

          <ScheduleGrid
            entries={entries}
            conflicts={planConflicts}
            onEntryClick={handleEntryClick}
          />
        </div>
      )}

      {selectedTeacher && (
        <TeacherModal teacher={selectedTeacher} onClose={() => setSelectedTeacher(null)} />
      )}
    </div>
  );
}
