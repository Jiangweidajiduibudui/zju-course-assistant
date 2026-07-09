import type { PlanEntry, ConflictInfo } from '@shared/contracts';

interface TimeBlock {
  id: string;
  label: string;
  time: string;
  startPeriod: number;
  endPeriod: number;
}

const BLOCKS: TimeBlock[] = [
  { id: 'b1', label: '第1-2节', time: '08:00-09:35', startPeriod: 1, endPeriod: 2 },
  { id: 'b2', label: '第3-4-5节', time: '09:50-12:15', startPeriod: 3, endPeriod: 5 },
  { id: 'b3', label: '第6-7节', time: '13:15-14:50', startPeriod: 6, endPeriod: 7 },
  { id: 'b4', label: '第8-9节', time: '14:55-16:40', startPeriod: 8, endPeriod: 9 },
  { id: 'b5', label: '第11-13节', time: '18:30-20:55', startPeriod: 11, endPeriod: 13 },
];

const DAYS = ['周一', '周二', '周三', '周四', '周五'];

interface Props {
  entries: PlanEntry[];
  conflicts: ConflictInfo[];
  onEntryClick?: (entry: PlanEntry) => void;
}

/** 两个区间是否重叠 */
function overlaps(a: { startPeriod: number; endPeriod: number }, b: { startPeriod: number; endPeriod: number }): boolean {
  return a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod;
}

export default function ScheduleGrid({ entries, conflicts, onEntryClick }: Props) {
  // Build index: which entries fall in each (day, block)
  const cellMap = new Map<string, PlanEntry[]>();

  for (const entry of entries) {
    for (const slot of entry.timeSlots) {
      for (const block of BLOCKS) {
        if (overlaps(slot, block)) {
          const key = `${slot.day}-${block.id}`;
          if (!cellMap.has(key)) cellMap.set(key, []);
          cellMap.get(key)!.push(entry);
        }
      }
    }
  }

  // Build conflict map: (day, block) → true if any conflicting courses overlap here
  const conflictKeys = new Set<string>();
  for (const c of conflicts) {
    const [aId, bId] = c.courseIds;
    for (const [key, cellEntries] of cellMap) {
      const ids = cellEntries.map((e) => e.courseId);
      if (ids.includes(aId) && ids.includes(bId)) {
        conflictKeys.add(key);
      }
    }
  }

  const getColorClass = (courseId: string) => {
    let hash = 0;
    for (let i = 0; i < courseId.length; i++) {
      hash = courseId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `cb-${Math.abs(hash) % 10}`;
  };

  return (
    <div className="schedule-wrap">
      <div className="schedule-grid">
        {/* Header row */}
        <div className="schedule-hdr">节次</div>
        {DAYS.map((d) => (
          <div key={d} className="schedule-hdr">{d}</div>
        ))}

        {/* Body */}
        {BLOCKS.map((block) => (
          <>
            <div key={`time-${block.id}`} className="schedule-time">
              {block.label}
              <span className="time-range">{block.time}</span>
            </div>
            {[1, 2, 3, 4, 5].map((day) => {
              const key = `${day}-${block.id}`;
              const cellEntries = cellMap.get(key) || [];
              const isConflict = conflictKeys.has(key);

              return (
                <div
                  key={key}
                  className={`schedule-cell${isConflict ? ' conflict' : ''}${cellEntries.length === 0 ? ' empty' : ''}`}
                >
                  {cellEntries.length === 0 ? (
                    <span>空闲</span>
                  ) : (
                    cellEntries.map((entry) => {
                      const slot = entry.timeSlots.find(
                        (s) => s.day === day && overlaps(s, block)
                      );
                      return (
                        <div
                          key={entry.sectionId}
                          className={`course-block ${getColorClass(entry.courseId)}${entry.locked ? ' locked' : ''}`}
                          onClick={() => onEntryClick?.(entry)}
                          title={`${entry.courseName}\n${entry.teacherName}${entry.teacherRating ? ' ⭐' + entry.teacherRating : ''}\n${slot?.location || ''}\n${slot?.weeks ? '第' + slot.weeks + '周' : ''}${entry.locked ? '\n🔒 已锁定' : ''}`}
                        >
                          <div className="cb-name">
                            {entry.locked && '🔒 '}{entry.courseName}
                          </div>
                          <div className="cb-info">
                            👨‍🏫 {entry.teacherName}
                            {entry.teacherRating && (
                              <span style={{ color: '#F9A825', marginLeft: 4 }}>
                                ⭐{entry.teacherRating}
                              </span>
                            )}
                          </div>
                          <div className="cb-info">📍 {slot?.location || ''}</div>
                          <div className="cb-weeks">📅 第{slot?.weeks || ''}周</div>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}
