import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { SectionData } from "../../shared/contracts/catalog.js";
import type { PlanData } from "../../shared/contracts/planning.js";
import type { HttpWorkspace } from "../data/http.js";
import type { SnapshotView } from "../data/port.js";
import { useUi } from "../ui-store.js";
import { CourseCard } from "./CourseCard.js";
import { Button, Empty } from "./ui.js";
export function HttpCatalog({
  api,
  snapshot,
  ...props
}: {
  api: HttpWorkspace;
  snapshot: SnapshotView;
  plan: PlanData;
  busy: boolean;
  edit: (change: (content: PlanData["content"]) => void) => void;
  note: (section: SectionData) => void;
}) {
  const { query, availableOnly } = useUi();
  const filter = `${snapshot.meta.id}:${query}:${availableOnly}`;
  const [paging, setPaging] = useState({
    filter,
    cursor: "",
    history: [] as string[],
  });
  const cursor = paging.filter === filter ? paging.cursor : "";
  const rows = useQuery({
    queryKey: ["catalog", filter, cursor],
    queryFn: () =>
      api.request(
        "listCourses",
        {},
        {
          snapshotId: snapshot.meta.id,
          limit: "20",
          ...(query.trim() ? { q: query.trim() } : {}),
          ...(availableOnly ? { availableOnly: "true" } : {}),
          ...(cursor ? { cursor } : {}),
        },
      ),
  });
  return (
    <div className="catalog">
      <div className="list-caption">
        目录共 {snapshot.meta.courseCount} 门课程
        {rows.data && <span>本页 {rows.data.items.length} 门</span>}
      </div>
      {rows.isPending ? (
        <Empty>正在查询课程…</Empty>
      ) : rows.isError ? (
        <div role="alert">
          <p>{rows.error.message}</p>
          <Button
            onClick={() => {
              setPaging({ filter, cursor: "", history: [] });
              void rows.refetch();
            }}
          >
            重新查询
          </Button>
        </div>
      ) : (
        <>
          {rows.data.items.length ? (
            rows.data.items.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                sections={snapshot.sections.filter(
                  (s) => s.courseId === course.id,
                )}
                snapshot={snapshot}
                availableOnly={availableOnly}
                {...props}
              />
            ))
          ) : (
            <Empty>未找到匹配的课程，请调整关键词或筛选条件。</Empty>
          )}
          <div className="toolbar-actions">
            <Button
              disabled={!cursor || rows.isFetching}
              onClick={() =>
                setPaging((current) => ({
                  filter,
                  cursor: current.history.at(-1) ?? "",
                  history: current.history.slice(0, -1),
                }))
              }
            >
              上一页
            </Button>
            <Button
              disabled={!rows.data.nextCursor || rows.isFetching}
              onClick={() =>
                setPaging((current) => ({
                  filter,
                  cursor: rows.data.nextCursor ?? "",
                  history: [
                    ...(current.filter === filter ? current.history : []),
                    cursor,
                  ],
                }))
              }
            >
              下一页
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
