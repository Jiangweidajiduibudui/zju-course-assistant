import { useEffect } from 'react';
import type { Teacher } from '@shared/contracts';

interface Props {
  teacher: Teacher;
  onClose: () => void;
}

const GRADE_LABELS = ['<60', '60-69', '70-79', '80-89', '90-95', '>95'];

export default function TeacherModal({ teacher, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const maxDist = Math.max(...teacher.gradeDistribution, 1);

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">👨‍🏫 查老师数据</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="teacher-row">
          <div className="teacher-avatar">{teacher.name[0]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{teacher.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{teacher.department}</div>
            <div className="tags-row">
              {teacher.tags.map((tag) => (
                <span key={tag} className="tag">{tag}</span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 14 }}>
          <div className="rating rating-lg">⭐ {teacher.rating} <span style={{ fontSize: 16, color: 'var(--text-muted)', fontWeight: 400 }}>/ 5.0</span></div>
          <div className="stat-row">
            <div className="stat-item">
              <div className="stat-value">{teacher.avgGrade}</div>
              <div className="stat-label">按课均绩</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">{teacher.reviewCount}</div>
              <div className="stat-label">评价数</div>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>📊 成绩分布</div>
          <div className="grade-bars">
            {teacher.gradeDistribution.map((v, i) => {
              const h = Math.max(4, (v / maxDist) * 100);
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div
                    className="grade-bar"
                    style={{
                      height: `${h}%`,
                      background: i >= 3 ? 'var(--success)' : i >= 2 ? 'var(--warning)' : 'var(--danger)',
                    }}
                    title={`${GRADE_LABELS[i]}: ${v}人`}
                  />
                  <span className="grade-bar-label">{GRADE_LABELS[i]}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>💬 近期评价（来自 chalaoshi）</div>
          {teacher.reviews.map((r, i) => (
            <div key={i} className="review-card">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{r.course}</strong>
                <span style={{ color: '#F9A825' }}>{'⭐'.repeat(r.rating)}</span>
              </div>
              <p style={{ margin: '4px 0' }}>{r.text}</p>
              <div className="review-meta">{r.date}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
