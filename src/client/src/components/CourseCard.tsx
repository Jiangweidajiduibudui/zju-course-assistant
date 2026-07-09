import type { Course, Teacher } from '@shared/contracts';

const DAY_MAP = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const BLOCK_MAP: Record<number, string> = {
  1: '1-2节', 2: '1-2节', 3: '3-5节', 4: '3-5节', 5: '3-5节',
  6: '6-7节', 7: '6-7节', 8: '8-9节', 9: '8-9节',
  11: '11-13节', 12: '11-13节', 13: '11-13节',
};

function describeTime(tc: Course['teachingClasses'][0]): string {
  return tc.timeSlots
    .map((s) => `${DAY_MAP[s.day]} ${BLOCK_MAP[s.startPeriod] || `${s.startPeriod}-${s.endPeriod}节`}`)
    .join(' / ');
}

interface Props {
  course: Course;
  teachers: Teacher[];
  isInPool: boolean;
  selectedSectionId?: string;
  onAddToPool: (courseId: string) => void;
  onRemoveFromPool: (courseId: string) => void;
  onSelectSection: (courseId: string, sectionId: string) => void;
  onShowTeacher: (teacher: Teacher) => void;
}

export default function CourseCard({
  course, teachers, isInPool,
  selectedSectionId, onAddToPool, onRemoveFromPool,
  onSelectSection, onShowTeacher,
}: Props) {
  return (
    <div className={`card${isInPool ? ' selected' : ''}`} style={{ marginBottom: 10 }}>
      <div className="card-header">
        <div>
          <div className="card-title">{course.name}</div>
          <div className="card-subtitle">{course.code} · {course.credits}学分 · {course.category}</div>
        </div>
        {(() => {
          const mainT = teachers.find((t) => t.id === course.teachingClasses[0]?.teacherId);
          if (!mainT) return null;
          return (
            <span className="rating" style={{ cursor: 'pointer' }} onClick={() => onShowTeacher(mainT)}>
              ⭐{mainT.rating}
            </span>
          );
        })()}
      </div>

      {/* 教学班列表 */}
      <div className="chip-group">
        {course.teachingClasses.map((tc) => {
          const t = teachers.find((t) => t.id === tc.teacherId);
          const isActive = selectedSectionId === tc.id;
          return (
            <span
              key={tc.id}
              className={`chip${isActive ? ' active' : ''}`}
              onClick={() => onSelectSection(course.id, tc.id)}
              title={`${t?.name || '未知'} · ${describeTime(tc)} · ${tc.timeSlots[0]?.location || ''}`}
            >
              {t?.name || '未知'} · {describeTime(tc)}
            </span>
          );
        })}
      </div>

      <div className="card-meta" style={{ marginTop: 8 }}>
        {course.teachingClasses.map((tc) => {
          const t = teachers.find((t) => t.id === tc.teacherId);
          return (
            <span key={tc.id} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {t?.name}: {tc.enrolled}/{tc.capacity}
              {t && (
                <span style={{ color: '#F9A825', marginLeft: 4, cursor: 'pointer' }} onClick={() => onShowTeacher(t)}>
                  ⭐{t.rating}
                </span>
              )}
            </span>
          );
        })}
      </div>

      <div className="card-actions">
        {isInPool ? (
          <button className="btn btn-outline btn-sm" onClick={() => onRemoveFromPool(course.id)}>
            ✓ 已加入候选（点击移除）
          </button>
        ) : (
          <button className="btn btn-outline btn-sm" onClick={() => onAddToPool(course.id)}>
            + 加入候选
          </button>
        )}
        {(() => {
          const mainT = teachers.find((t) => t.id === course.teachingClasses[0]?.teacherId);
          if (!mainT) return null;
          return (
            <button className="btn btn-outline btn-sm" onClick={() => onShowTeacher(mainT)}>
              📊 查老师
            </button>
          );
        })()}
      </div>
    </div>
  );
}
