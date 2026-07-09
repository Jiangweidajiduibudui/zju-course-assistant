import { useState, useRef, useEffect } from 'react';
import type { PlanEntry } from '@shared/contracts';

interface Props {
  entries: PlanEntry[];
  disabled?: boolean;
}

const DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default function ExportMenu({ entries, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const buildText = (): string => {
    const lines = ['📅 预期课表 · ZJU 选课助手', '='.repeat(36), ''];
    const sorted = [...entries].sort((a, b) => {
      const aStart = a.timeSlots[0]?.startPeriod ?? 99;
      const bStart = b.timeSlots[0]?.startPeriod ?? 99;
      return aStart - bStart || a.timeSlots[0]?.day - b.timeSlots[0]?.day;
    });
    for (const e of sorted) {
      const slots = e.timeSlots
        .map((s) => `${DAYS[s.day]} ${s.startPeriod}-${s.endPeriod}节 @ ${s.location}`)
        .join(' | ');
      lines.push(
        `${e.locked ? '🔒 ' : '  '}${e.courseName}（${e.credits}学分）`
      );
      lines.push(`   👨‍🏫 ${e.teacherName}${e.teacherRating ? ' ⭐' + e.teacherRating : ''}`);
      lines.push(`   📍 ${slots}`);
      lines.push(`   📅 第${e.timeSlots[0]?.weeks || '?'}周`);
      lines.push('');
    }
    lines.push(`合计：${entries.reduce((s, e) => s + e.credits, 0)} 学分 · ${entries.length} 门课`);
    return lines.join('\n');
  };

  const buildJSON = (): string => {
    return JSON.stringify(
      entries.map((e) => ({
        courseName: e.courseName,
        teacher: e.teacherName,
        rating: e.teacherRating,
        credits: e.credits,
        timeSlots: e.timeSlots.map((s) => ({
          day: s.day,
          periods: `${s.startPeriod}-${s.endPeriod}`,
          weeks: s.weeks,
          location: s.location,
        })),
        locked: e.locked,
      })),
      null,
      2
    );
  };

  const copyText = async () => {
    await navigator.clipboard.writeText(buildText());
    setOpen(false);
  };

  const copyJSON = async () => {
    await navigator.clipboard.writeText(buildJSON());
    setOpen(false);
  };

  const downloadJSON = () => {
    const blob = new Blob([buildJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zju-schedule-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  return (
    <div className="export-menu" ref={menuRef}>
      <button className="btn btn-outline btn-sm" disabled={disabled || entries.length === 0} onClick={() => setOpen(!open)}>
        📋 导出
      </button>
      {open && (
        <div className="export-dropdown">
          <button className="export-item" onClick={copyText}>📝 复制为文本</button>
          <button className="export-item" onClick={copyJSON}>📋 复制为 JSON</button>
          <button className="export-item" onClick={downloadJSON}>💾 下载 JSON 文件</button>
        </div>
      )}
    </div>
  );
}
