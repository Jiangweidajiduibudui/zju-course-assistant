import type { PointerEvent } from "react";
import { useRef, useState } from "react";
import { Button } from "./ui.js";

type DragState = { pointerId: number; target: number; x: number; y: number };
export function ReorderHandle({
  label,
  rank,
  count,
  disabled,
  move,
}: {
  label: string;
  rank: number;
  count: number;
  disabled: boolean;
  move: (rank: number) => void;
}) {
  const drag = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const update = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    const group = event.currentTarget.closest(".shortlist-course");
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-sort-rank]");
    const targetRank =
      target?.closest(".shortlist-course") === group
        ? Number(target?.dataset.sortRank)
        : -1;
    drag.current = {
      pointerId: event.pointerId,
      target: targetRank,
      x: event.clientX,
      y: event.clientY,
    };
    setPreview(drag.current);
  };
  const cancel = () => {
    drag.current = null;
    setPreview(null);
  };
  return (
    <div className="reorder">
      <Button
        data-tour="reorder"
        className={`drag-handle ${preview ? "dragging" : ""}`}
        aria-label={`拖动排序：${label}`}
        aria-describedby="sort-help"
        title="拖动调整顺序；也可聚焦后按方向键"
        disabled={disabled || count < 2}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            target: rank,
            x: event.clientX,
            y: event.clientY,
          };
          setPreview(drag.current);
        }}
        onPointerMove={update}
        onPointerUp={(event) => {
          update(event);
          const target = drag.current?.target ?? -1;
          cancel();
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          if (target >= 0 && target !== rank) {
            move(target);
            setAnnouncement(`${label}已移至第 ${target + 1} 顺位`);
          }
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            cancel();
            return;
          }
          const target =
            event.key === "ArrowUp"
              ? Math.max(0, rank - 1)
              : event.key === "ArrowDown"
                ? Math.min(count - 1, rank + 1)
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? count - 1
                    : null;
          if (target === null) return;
          event.preventDefault();
          if (target !== rank) {
            move(target);
            setAnnouncement(`${label}已移至第 ${target + 1} 顺位`);
          }
        }}
      >
        <span aria-hidden="true">⠿</span>
      </Button>
      {preview && (
        <span
          className="drag-preview"
          style={{ left: Math.max(8, preview.x - 170), top: preview.y + 16 }}
          aria-hidden="true"
        >
          {label} ·{" "}
          {preview.target < 0 ? "松开取消" : `移到第 ${preview.target + 1} 位`}
        </span>
      )}
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
