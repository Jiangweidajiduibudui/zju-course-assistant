import type { ConflictInfo } from '@shared/contracts';

interface Props {
  conflicts: ConflictInfo[];
  onResolve: () => void;
}

export default function ConflictBadge({ conflicts, onResolve }: Props) {
  if (conflicts.length === 0) return null;

  return (
    <div className="conflict-banner" style={{ display: 'flex' }}>
      <span>⚠️ 检测到 {conflicts.length} 个时间冲突</span>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 400 }}>
        {conflicts.slice(0, 2).map((c) => c.detail).join('；')}
        {conflicts.length > 2 && ` 等${conflicts.length}项`}
      </span>
      <button className="btn btn-outline btn-sm" onClick={onResolve} style={{ borderColor: 'var(--warning)', color: '#925D00' }}>
        逐项解决 →
      </button>
    </div>
  );
}
