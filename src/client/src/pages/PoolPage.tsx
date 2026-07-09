import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import { generatePlan } from '../utils/api';
import CourseCard from '../components/CourseCard';
import TeacherModal from '../components/TeacherModal';
import type { Teacher } from '@shared/contracts';

export default function PoolPage() {
  const navigate = useNavigate();
  const {
    courses, teachers, pool, preferences,
    addToPool, removeFromPool, updatePoolSection,
    setPlan, setPlanConflicts, planLocked, plan, takeSnapshot,
    addToast,
  } = useAppStore();

  const [search, setSearch] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [generating, setGenerating] = useState(false);

  const filteredCourses = useMemo(() => {
    if (!search.trim()) return courses;
    const q = search.toLowerCase();
    return courses.filter((c) => {
      const teacherNames = c.teachingClasses
        .map((tc) => teachers.find((t) => t.id === tc.teacherId)?.name || '')
        .join(' ');
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.category.includes(q) ||
        teacherNames.toLowerCase().includes(q)
      );
    });
  }, [courses, teachers, search]);

  const handleGenerate = async () => {
    if (pool.length === 0) {
      addToast('请先添加课程到候选清单', 'warning');
      return;
    }
    setGenerating(true);
    try {
      const result = await generatePlan(
        pool, plan, planLocked, preferences, courses, teachers
      );
      setPlan(result.plan);
      setPlanConflicts(result.conflicts);
      if (result.conflicts.length > 0) {
        addToast(`已生成方案，但存在 ${result.conflicts.length} 个冲突`, 'warning');
      } else {
        addToast('方案生成成功！', 'success');
      }
      takeSnapshot();
      navigate('/schedule');
    } catch (err) {
      addToast('生成失败，请重试', 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="page" style={{ padding: 0 }}>
      <div className="split-layout">
        {/* Left panel: course list */}
        <div className="panel">
          <div className="panel-header">
            <div className="page-title" style={{ fontSize: 18, marginBottom: 8 }}>
              📚 可选课程
            </div>
            <div className="search-wrap">
              <span className="search-icon">🔍</span>
              <input
                className="search-input"
                placeholder="搜索课程、教师、代码…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              共 {filteredCourses.length} 门课 · 候选池 {pool.length} 门
            </div>
            <div className="btn-group">
              <button
                className="btn btn-primary"
                onClick={handleGenerate}
                disabled={generating || pool.length === 0}
              >
                {generating ? '⏳ 生成中…' : '✨ 智能生成课表'}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => {
                useAppStore.getState().clearPool();
              }}>
                🗑 清空
              </button>
            </div>
          </div>
          <div className="panel-body">
            {filteredCourses.length === 0 ? (
              <div className="empty-state">
                <div className="icon">🔍</div>
                <h3>未找到匹配课程</h3>
                <p>尝试其他关键词</p>
              </div>
            ) : (
              filteredCourses.map((c) => {
                const poolEntry = pool.find((p) => p.courseId === c.id);
                return (
                  <CourseCard
                    key={c.id}
                    course={c}
                    teachers={teachers}
                    isInPool={!!poolEntry}
                    selectedSectionId={poolEntry?.sectionId}
                    onAddToPool={(cid) => addToPool(cid)}
                    onRemoveFromPool={(cid) => removeFromPool(cid)}
                    onSelectSection={(cid, sid) => {
                      if (!poolEntry) {
                        addToPool(cid, sid);
                      } else {
                        updatePoolSection(cid, sid);
                      }
                    }}
                    onShowTeacher={setSelectedTeacher}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Right panel: pool summary + mini schedule preview */}
        <div className="panel" style={{ background: 'var(--bg)' }}>
          <div className="panel-header">
            <div className="page-title" style={{ fontSize: 18 }}>⭐ 候选清单</div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
              {pool.length === 0
                ? '搜索课程并「加入候选」，然后点击「智能生成课表」'
                : `已选 ${pool.length} 门课，点击「智能生成课表」生成推荐方案`}
            </p>
          </div>
          <div className="panel-body">
            {pool.length === 0 ? (
              <div className="empty-state">
                <div className="icon">📝</div>
                <h3>候选清单为空</h3>
                <p>在左侧浏览课程，点击「+ 加入候选」开始构建你的选课方案</p>
              </div>
            ) : (
              pool.map((p) => {
                const course = courses.find((c) => c.id === p.courseId);
                if (!course) return null;
                const tc = course.teachingClasses.find((s) => s.id === p.sectionId);
                const teacher = teachers.find((t) => t.id === tc?.teacherId);
                return (
                  <div key={p.courseId} className="card" style={{ marginBottom: 8, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div>
                        <span style={{ fontWeight: 700 }}>{course.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                          {course.credits}学分
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {course.teachingClasses.length > 1 && (
                          <select
                            style={{
                              fontSize: 11, padding: '2px 4px', borderRadius: 4,
                              border: '1px solid var(--border)', fontFamily: 'inherit',
                            }}
                            value={p.sectionId}
                            onChange={(e) => updatePoolSection(p.courseId, e.target.value)}
                          >
                            {course.teachingClasses.map((s) => {
                              const t = teachers.find((t) => t.id === s.teacherId);
                              return (
                                <option key={s.id} value={s.id}>
                                  {t?.name || '未知'}
                                </option>
                              );
                            })}
                          </select>
                        )}
                        <button
                          style={{
                            width: 22, height: 22, borderRadius: '50%', border: 'none',
                            background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)',
                            fontSize: 14,
                          }}
                          onClick={() => removeFromPool(p.courseId)}
                          title="移除"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      👨‍🏫 {teacher?.name || '未选择'}
                      {teacher && <span style={{ color: '#F9A825', marginLeft: 4 }}>⭐{teacher.rating}</span>}
                    </div>
                    {tc && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {tc.timeSlots.map((s) => `${['', '周一', '周二', '周三', '周四', '周五'][s.day]} ${s.startPeriod}-${s.endPeriod}节`).join(' / ')}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {selectedTeacher && (
        <TeacherModal teacher={selectedTeacher} onClose={() => setSelectedTeacher(null)} />
      )}
    </div>
  );
}
