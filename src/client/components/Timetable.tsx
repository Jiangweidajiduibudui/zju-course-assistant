import { useState } from "react";
import { calendarOverlap } from "../../domain/planning.js";
import type { Analysis, SnapshotView } from "../data/port.js";
import { useUi } from "../ui-store.js";
import { layoutEntries, weekLabel } from "./timetable-layout.js";
import { Button, Empty } from "./ui.js";

const periods = Array.from({ length: 13 }, (_, index) => index + 1);
const entryKey = (entry: Analysis["projection"]["entries"][number]) =>
  `${entry.sectionId}-${entry.slot.partId}-${entry.slot.weekday}-${entry.slot.startPeriod}-${entry.slot.endPeriod}-${entry.slot.weeks.join(".")}`;
const days = ["一", "二", "三", "四", "五", "六", "日"];
export function Timetable({
  snapshot,
  analysis,
}: {
  snapshot: SnapshotView;
  analysis: Analysis;
}) {
  const ui = useUi();
  const partId = snapshot.term.parts.some((p) => p.id === ui.partId)
    ? ui.partId
    : snapshot.term.parts[0]?.id;
  const [showReasons, setShowReasons] = useState(false);
  const [week, setWeek] = useState("all");
  const { projection } = analysis;
  const entries = projection.entries.filter(
    (entry) =>
      entry.slot.partId === partId &&
      (week === "all" || entry.slot.weeks.includes(Number(week))) &&
      (ui.alternatives || entry.role !== "alternative"),
  );
  const layout = layoutEntries(entries);
  const conflicts = (entry: (typeof entries)[number]) =>
    projection.entries.filter(
      (other) =>
        entry.role !== "alternative" &&
        other.role !== "alternative" &&
        entry.courseId !== other.courseId &&
        calendarOverlap(
          snapshot,
          week === "all"
            ? entry.slot
            : { ...entry.slot, weeks: [Number(week)] },
          other.slot,
        ) === true &&
        (week === "all" ||
          other.slot.partId !== partId ||
          other.slot.weeks.includes(Number(week))),
    );
  const overlapIssues = [
    ...new Map(
      entries.flatMap((entry) =>
        conflicts(entry).map((other) => {
          const id = [entryKey(entry), entryKey(other)].sort().join("|");
          const title = (courseId: string) =>
            snapshot.courses.find((c) => c.id === courseId)?.title ?? courseId;
          return [
            id,
            {
              id,
              message: `${title(entry.courseId)} 与 ${title(other.courseId)}：周${days[entry.slot.weekday - 1]}第 ${Math.max(entry.slot.startPeriod, other.slot.startPeriod)}–${Math.min(entry.slot.endPeriod, other.slot.endPeriod)} 节重叠；${week === "all" ? `本项安排 ${weekLabel(entry.slot.weeks)}` : `第 ${week} 周`}。`,
            },
          ] as const;
        }),
      ),
    ).values(),
  ];
  const credit = projection.credits;
  return (
    <aside className="panel timetable-panel" aria-label="课表投影">
      <div className="panel-title" data-tour="timetable">
        <div>
          <span className="eyebrow">PROJECTION</span>
          <h2>课表投影</h2>
        </div>
        <span className="tag">首选组合</span>
      </div>
      <div className="calendar-controls">
        <label>
          学期段
          <select
            aria-label="学期段"
            value={partId}
            onChange={(event) => {
              ui.set({ partId: event.target.value });
              setWeek("all");
            }}
          >
            {snapshot.term.parts.map((part) => (
              <option key={part.id} value={part.id}>
                {part.label}季
              </option>
            ))}
          </select>
        </label>
        <label>
          周次
          <select
            aria-label="周次"
            value={week}
            onChange={(event) => setWeek(event.target.value)}
          >
            <option value="all">全部周次</option>
            {[
              ...new Set(
                projection.entries
                  .filter((e) => e.slot.partId === partId)
                  .flatMap((e) => e.slot.weeks),
              ),
            ]
              .sort((a, b) => a - b)
              .map((w) => (
                <option key={w} value={w}>
                  第 {w} 周
                </option>
              ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={ui.alternatives}
            onChange={(event) => ui.set({ alternatives: event.target.checked })}
          />
          显示备选
        </label>
      </div>
      <div className="legend">
        <span>
          <i className="swatch primary-swatch" />
          首选
        </span>
        <span>
          <i className="swatch baseline-swatch" />
          已选 · 锁定
        </span>
        <span>
          <i className="swatch alternative-swatch" />
          互斥备选
        </span>
      </div>
      <div className="calendar-scroll">
        <div
          className="calendar"
          role="img"
          aria-label={`${snapshot.term.parts.find((part) => part.id === partId)?.label ?? "当前"}季课表汇总。详细教学班列于课表下方。`}
        >
          <div className="calendar-corner">节次</div>
          {days.map((day, i) => (
            <div className="day" key={day} style={{ gridColumn: i + 2 }}>
              周{day}
            </div>
          ))}
          {periods.map((period) => (
            <div
              className="period"
              key={period}
              style={{ gridRow: period + 1 }}
            >
              {period}
            </div>
          ))}
          {days.flatMap((day, dayIndex) =>
            periods.map((period) => (
              <div
                className="calendar-cell"
                key={`${day}-${period}`}
                style={{ gridColumn: dayIndex + 2, gridRow: period + 1 }}
              />
            )),
          )}
          {entries.map((entry) => {
            const course = snapshot.courses.find(
              (row) => row.id === entry.courseId,
            );
            const conflict = conflicts(entry).length > 0;
            const position = layout.get(entry) ?? { lane: 0, lanes: 1 };
            return (
              <div
                key={entryKey(entry)}
                title={`${course?.title} · ${weekLabel(entry.slot.weeks)}${conflict ? " · 时间冲突" : ""}`}
                className={`calendar-event ${entry.role} ${conflict ? "overlap" : ""}`}
                style={{
                  gridColumn: entry.slot.weekday + 1,
                  width: `calc(${100 / position.lanes}% - 4px)`,
                  marginLeft: `calc(${(100 * position.lane) / position.lanes}% + 2px)`,
                  justifySelf: "start",
                  gridRow: `${entry.slot.startPeriod + 1} / ${entry.slot.endPeriod + 2}`,
                }}
              >
                <strong>{course?.title}</strong>
                <small>{weekLabel(entry.slot.weeks)}</small>
                <small>
                  {entry.role === "alternative"
                    ? "互斥备选"
                    : entry.role === "baseline"
                      ? "已选 · 锁定"
                      : "首选"}
                  {conflict ? " · 重叠" : ""}
                </small>
              </div>
            );
          })}
        </div>
      </div>
      {entries.length === 0 ? (
        <Empty>当前学期段没有课表项。</Empty>
      ) : (
        <details className="calendar-details">
          <summary>查看 {entries.length} 个教学时间项</summary>
          <ul>
            {entries.map((entry) => (
              <li key={entryKey(entry)}>
                {
                  snapshot.courses.find(
                    (course) => course.id === entry.courseId,
                  )?.title
                }{" "}
                · 周{days[entry.slot.weekday - 1]} {entry.slot.startPeriod}–
                {entry.slot.endPeriod} 节 · {weekLabel(entry.slot.weeks)} ·{" "}
                {entry.role === "alternative"
                  ? "互斥备选，不计入同时上课"
                  : entry.role === "baseline"
                    ? "已选锁定"
                    : "首选"}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="credit-summary">
        <div>
          <span>本计划学分</span>
          <strong>
            {credit.knownTotal}
            <small> / {credit.limit ?? "未设置"}</small>
          </strong>
        </div>
        {credit.missingCourseIds.length > 0 && (
          <p>部分课程缺少学分，暂计已知学分。</p>
        )}
      </div>
      {overlapIssues.length > 0 && (
        <>
          <Button
            className="warning-button"
            aria-expanded={showReasons}
            onClick={() => setShowReasons(!showReasons)}
          >
            ⚠ {overlapIssues.length} 处首选时间重叠 · 查看原因
          </Button>
          {showReasons && (
            <div className="notice warning">
              {overlapIssues.map((issue) => (
                <p key={issue.id}>{issue.message}</p>
              ))}
            </div>
          )}
        </>
      )}
      <Button disabled title="即将支持">
        AI 解释课表 · 即将支持
      </Button>
    </aside>
  );
}
