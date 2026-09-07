import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";
import type { Course, SectionData } from "../../shared/contracts/catalog.js";
import type { PlanData } from "../../shared/contracts/planning.js";
import { useWorkspace } from "../data/context.js";
import { HttpWorkspace } from "../data/http.js";
import type { SnapshotView } from "../data/port.js";
import { DemandRatio } from "./DemandRatio.js";
import { ReviewSummary } from "./ReviewSummary.js";
import { Button, Field } from "./ui.js";

export function teacherLabel(section: SectionData) {
  return section.teachers.state === "known"
    ? section.teachers.value.map((teacher) => teacher.name).join("、") ||
        "教师未提供"
    : "教师未知";
}
export function timeLabel(section: SectionData) {
  return section.meetings.state === "known"
    ? section.meetings.value
        .map(
          ({ slot }) =>
            `周${"一二三四五六日"[slot.weekday - 1]} ${slot.startPeriod}–${slot.endPeriod} 节`,
        )
        .join(" / ") || "无排定时间"
    : "时间未知";
}
type Props = {
  course: z.infer<typeof Course>;
  sections: SectionData[];
  snapshot: SnapshotView;
  plan: PlanData;
  busy: boolean;
  availableOnly?: boolean;
  edit: (change: (content: PlanData["content"]) => void) => void;
  note: (section: SectionData) => void;
};

export function CourseCard({
  course,
  sections: initialSections,
  availableOnly = false,
  snapshot,
  plan,
  busy,
  edit,
  note,
}: Props) {
  const { api } = useWorkspace();
  const [expanded, setExpanded] = useState(
    course.id === "math" || course.id === "code",
  );
  const loaded = useQuery({
    queryKey: ["catalog-sections", snapshot.meta.id, course.id],
    enabled: expanded && api instanceof HttpWorkspace,
    queryFn: async () => {
      if (!(api instanceof HttpWorkspace)) return initialSections;
      const result: SectionData[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.request(
          "listSections",
          { courseId: course.id },
          {
            snapshotId: snapshot.meta.id,
            limit: "100",
            ...(cursor ? { cursor } : {}),
          },
        );
        result.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return result;
    },
  });
  const sections = (loaded.data ?? initialSections).filter(
    (s) => !availableOnly || s.officialState === "available",
  );
  const hasLoaded =
    !(api instanceof HttpWorkspace) ||
    !!loaded.data ||
    snapshot.loadedCourseIds.includes(course.id);
  const row = plan.content.shortlist.find(
    (item) => item.courseId === course.id,
  );
  const update = (
    section: SectionData,
    disposition?: "candidate" | "excluded",
  ) =>
    edit((content) => {
      let entry = content.shortlist.find((item) => item.courseId === course.id);
      if (!entry) {
        entry = { courseId: course.id, favorite: false, note: "", items: [] };
        content.shortlist.push(entry);
      }
      const item = entry.items.find((item) => item.sectionId === section.id);
      if (item && disposition) item.disposition = disposition;
      else if (item) item.favorite = !item.favorite;
      else
        entry.items.push({
          sectionId: section.id,
          disposition: disposition ?? "reference",
          favorite: !disposition,
          note: "",
        });
    });
  return (
    <details
      className="course-card"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary data-tour="course-details">
        <div>
          <div className="course-kicker">
            {course.code}{" "}
            <span>
              ·{" "}
              {course.category.state === "known"
                ? course.category.value.label
                : "—"}
            </span>
          </div>
          <h3>
            {course.title}
            <span className="credits">
              <Field value={course.credits} /> 学分
            </span>
          </h3>
          <div className="muted">
            {row?.items.filter((item) => item.disposition === "candidate")
              .length ?? 0}{" "}
            个候选 ·{" "}
            {hasLoaded ? `${sections.length} 个教学班` : "展开加载教学班"}
            {course.hasPrerequisite.state === "known" &&
              course.hasPrerequisite.value &&
              " · 有预修要求"}
          </div>
        </div>
        <span className="expand-marker" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="section-list">
        {loaded.isFetching && !hasLoaded && (
          <p role="status">正在加载教学班…</p>
        )}
        {loaded.error && (
          <p role="alert">
            {loaded.error.message}
            <Button onClick={() => loaded.refetch()}>重试</Button>
          </p>
        )}
        {sections.map((section) => {
          const item = row?.items.find((item) => item.sectionId === section.id);
          const locked =
            snapshot.enrolledSectionIds.state === "known" &&
            snapshot.enrolledSectionIds.value.includes(section.id);
          return (
            <article
              className={`section-card ${item?.disposition === "candidate" ? "selected" : ""}`}
              key={section.id}
              aria-label={`${course.title} ${teacherLabel(section)}`}
            >
              <div className="section-heading">
                <strong>{teacherLabel(section)}</strong>
                <span
                  className={`tag ${section.officialState === "unavailable" ? "danger-tag" : ""}`}
                >
                  {locked
                    ? "已选"
                    : section.officialState === "available"
                      ? "学校标示可选"
                      : section.officialState === "unavailable"
                        ? "学校标示不可选"
                        : "状态未知"}
                </span>
              </div>
              <p className="section-code">
                课程序号 <Field value={section.selectionCode} />
              </p>
              <div className="section-grid">
                <div>
                  <span>上课时间</span>
                  <strong>{timeLabel(section)}</strong>
                </div>
                <div>
                  <span>地点</span>
                  <strong>
                    {section.meetings.state === "known" &&
                    section.meetings.value[0] ? (
                      <Field value={section.meetings.value[0].location} />
                    ) : (
                      "—"
                    )}
                  </strong>
                </div>
                <div>
                  <span>考试</span>
                  <strong>
                    {section.exams.state === "known"
                      ? (section.exams.value[0]?.startsAt
                          .slice(5, 16)
                          .replace("T", " ") ?? "无考试")
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>总余量 / 容量</span>
                  <strong>
                    <Field value={section.quotas.overall.remaining} /> /{" "}
                    <Field value={section.quotas.overall.capacity} />
                  </strong>
                </div>
                <DemandRatio section={section} />
              </div>
              <div className="section-actions">
                <Button
                  data-tour="add-candidate"
                  className={
                    item?.disposition === "candidate"
                      ? "chosen"
                      : "primary-button"
                  }
                  disabled={busy || locked || item?.disposition === "candidate"}
                  onClick={() => update(section, "candidate")}
                >
                  {item?.disposition === "candidate"
                    ? "✓ 已在候选"
                    : "＋ 设为候选"}
                </Button>
                <Button
                  disabled={busy || locked || item?.disposition === "excluded"}
                  onClick={() => update(section, "excluded")}
                >
                  {item?.disposition === "excluded" ? "已排除" : "排除"}
                </Button>
                <Button
                  aria-label={`${teacherLabel(section)}${item?.favorite ? "取消收藏" : "收藏"}`}
                  disabled={busy || locked}
                  onClick={() => update(section)}
                >
                  {item?.favorite ? "★" : "☆"}
                </Button>
                <Button disabled={busy || locked} onClick={() => note(section)}>
                  笔记{item?.note ? " · 已写" : ""}
                </Button>
              </div>
              {section.targetAudience.state === "known" && (
                <details className="section-details">
                  <summary>教学班详情</summary>
                  <dl>
                    <div>
                      <dt>面向对象</dt>
                      <dd>
                        <Field value={section.targetAudience} />
                      </dd>
                    </div>
                  </dl>
                </details>
              )}
              <div className="section-details">
                <ReviewSummary
                  section={section}
                  snapshotId={snapshot.meta.id}
                />
              </div>
            </article>
          );
        })}
      </div>
    </details>
  );
}
