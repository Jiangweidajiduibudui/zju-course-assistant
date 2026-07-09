import type { TermSlot } from "../../../shared/contracts/index.js";

/**
 * 课表网格组件（组员 E）
 *
 * 渲染一个 周一~周五 × 5个时段 的课程表网格。
 * 当前使用原始 termSlots 数据；selection-model 就绪后应改用
 * TimetableProjection 的 planGrid / stackGrid。
 */

const DAYS = ["周一", "周二", "周三", "周四", "周五"] as const;
const DAY_INDEXES = [1, 2, 3, 4, 5];

interface TimeBlock {
  label: string;
  timeRange: string;
  periods: number[];
}

const BLOCKS: TimeBlock[] = [
  { label: "第1-2节", timeRange: "08:00-09:35", periods: [1, 2] },
  { label: "第3-5节", timeRange: "09:50-12:15", periods: [3, 4, 5] },
  { label: "第6-7节", timeRange: "13:15-14:50", periods: [6, 7] },
  { label: "第8-9节", timeRange: "14:55-16:40", periods: [8, 9] },
  { label: "第11-13节", timeRange: "18:30-20:55", periods: [11, 12, 13] },
];

export interface GridEntry {
  sectionId: string;
  courseName: string;
  courseCode: string;
  slots: TermSlot[];
  teacherName?: string;
  location?: string;
}

interface TimetableGridProps {
  entries: GridEntry[];
}

/** 给每个 courseCode 分配一个稳定的色号 (0-9) */
function colorIndex(code: string): number {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = code.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 10;
}

const BG_CLASSES = [
  "bg-blue-50 border-l-blue-500",
  "bg-amber-50 border-l-amber-500",
  "bg-emerald-50 border-l-emerald-500",
  "bg-red-50 border-l-red-500",
  "bg-purple-50 border-l-purple-500",
  "bg-cyan-50 border-l-cyan-500",
  "bg-yellow-50 border-l-yellow-500",
  "bg-indigo-50 border-l-indigo-500",
  "bg-gray-100 border-l-gray-500",
  "bg-lime-50 border-l-lime-500",
];

function getBlockForPeriod(period: number): TimeBlock | undefined {
  return BLOCKS.find((b) => b.periods.includes(period));
}

function getUniqueLocations(slots: TermSlot[]): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of slots) {
    // 当前 termSlot 不含 location 字段，用教学班 ID 代替
    const key = `周${s.dayOfWeek}第${s.period}节(${s.term})`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result.length > 2 ? `${result.slice(0, 2).join(" / ")} …` : result.join(" / ");
}

export function TimetableGrid({ entries }: TimetableGridProps) {
  if (entries.length === 0) {
    return (
      <div className="flex min-h-[300px] items-center justify-center rounded-lg border bg-white text-sm text-gray-400">
        暂无课表数据——请先生成推荐方案
      </div>
    );
  }

  // Build grid: Map<`${day}-${blockLabel}`, GridEntry[]>
  const grid = new Map<string, GridEntry[]>();
  for (const entry of entries) {
    for (const slot of entry.slots) {
      const block = getBlockForPeriod(slot.period);
      if (!block) continue;
      const key = `${slot.dayOfWeek}-${block.label}`;
      const list = grid.get(key) ?? [];
      list.push(entry);
      grid.set(key, list);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="min-w-full border-collapse">
        <thead>
          <tr>
            <th className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 px-2 py-2 text-center text-xs font-bold text-gray-500">
              节次
            </th>
            {DAYS.map((d) => (
              <th
                key={d}
                className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 px-2 py-2 text-center text-xs font-bold text-gray-500"
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BLOCKS.map((block) => (
            <tr key={block.label}>
              <td className="border-b border-gray-100 bg-gray-50 px-2 py-2 text-center text-xs text-gray-500">
                <div>{block.label}</div>
                <div className="text-[10px] text-gray-400">{block.timeRange}</div>
              </td>
              {DAY_INDEXES.map((day) => {
                const key = `${day}-${block.label}`;
                const cellEntries = grid.get(key) ?? [];
                return (
                  <td
                    key={key}
                    className="min-h-[80px] border-b border-l border-gray-100 p-1 align-top"
                    style={{ minWidth: 120, height: 80 }}
                  >
                    {cellEntries.map((entry) => {
                      const ci = colorIndex(entry.courseCode);
                      return (
                        <div
                          key={entry.sectionId}
                          className={`mb-1 rounded border-l-4 px-2 py-1 text-xs ${BG_CLASSES[ci]}`}
                          title={`${entry.courseName} (${entry.courseCode})\n${entry.teacherName ?? ""}\n${getUniqueLocations(entry.slots)}`}
                        >
                          <div className="font-semibold truncate">{entry.courseName}</div>
                          {entry.teacherName && (
                            <div className="text-[11px] text-gray-500 truncate">
                              {entry.teacherName}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {cellEntries.length === 0 && (
                      <div className="py-6 text-center text-[11px] text-gray-300">空闲</div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
