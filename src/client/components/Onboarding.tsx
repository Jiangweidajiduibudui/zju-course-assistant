import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspace } from "../data/context.js";
import { HttpWorkspace } from "../data/http.js";
import { useUi } from "../ui-store.js";
import { Button } from "./ui.js";

type Step = {
  id: string;
  title: string;
  text: string;
  targets: string[];
  tab?: "explore" | "shortlist" | "draft";
};
const steps: Step[] = [
  {
    id: "school",
    title: "先连接教务",
    text: "点击这里，在面板里打开学校登录窗口，再同步当前学期。完成后关闭面板，回来继续。也可以先从本机数据与备份导入归档。",
    targets: ['[data-tour="school"]'],
  },
  {
    id: "plan",
    title: "新建一份计划",
    text: "点击这个 ＋，输入计划名称并创建。已有计划也可以直接用它继续，助手不会改变学校选课。",
    targets: ['[data-tour="new-plan"]'],
  },
  {
    id: "search",
    title: "在这里找课程",
    text: "输入课程名、课号或教师，找到想上的课程。下方列表会随搜索更新。",
    targets: ['[data-tour="search"]'],
    tab: "explore",
  },
  {
    id: "section",
    title: "选择具体教学班",
    text: "展开课程，核对教师与上课时间，点击「设为候选」。同一门课可以留多个教学班；是否添加由你决定。",
    targets: [
      '[data-tour="add-candidate"]:not(:disabled)',
      '[data-tour="course-details"]',
      '[data-tour="search"]',
    ],
    tab: "explore",
  },
  {
    id: "order",
    title: "调整你的候选顺序",
    text: "这里是候选清单。拖动手柄或用方向键排序，最前的是首选，其余是互斥备选。还没添加候选，可先回「探索课程」。",
    targets: [
      '[data-tour="reorder"]:not(:disabled)',
      '[data-tour="candidate-order"]',
    ],
    tab: "shortlist",
  },
  {
    id: "timetable",
    title: "对照课表检查安排",
    text: "在这张课表查看首选组合、切换学期段，并按需显示备选。留意冲突和未知时间；备选不代表同时上课。",
    targets: ['[data-tour="timetable"]'],
    tab: "shortlist",
  },
  {
    id: "ai",
    title: "需要时再用 AI",
    text: "点击「我的偏好」填写并确认要求。想生成建议时，先在顶部「模型设置」配置自己的模型，再点「AI 帮我排」；通过校验后另存为备选计划。这一步可跳过。",
    targets: ['[data-tour="preferences"]'],
    tab: "shortlist",
  },
  {
    id: "draft",
    title: "核对后导出填写清单",
    text: "这里导出手工填写清单。按钮不可用时，先处理上方的校验问题。最终回学校页面核对并自行填报，助手不会代为提交。",
    targets: ['[data-tour="export-draft"]'],
    tab: "draft",
  },
  {
    id: "backup",
    title: "在这里备份你的规划",
    text: "展开这里可以导出归档或导入备份。填报前记得同步最新课程并对账；以后可随时从顶部「新手指引」重看。",
    targets: ['[data-tour="local-data"]'],
  },
];
const fixtureSteps = steps.filter(
  (step) => !["school", "backup"].includes(step.id),
);

type Layout = {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  target: string;
  missing: boolean;
};

// This tour only changes the visible tab. All data-changing actions remain actual user clicks.
export function Onboarding({
  hasSnapshot,
  hasPlan,
  close,
}: {
  hasSnapshot: boolean;
  hasPlan: boolean;
  close: () => void;
}) {
  const { api } = useWorkspace();
  const available = api instanceof HttpWorkspace ? steps : fixtureSteps;
  const [index, setIndex] = useState(0);
  const step = available[index] ?? available[0];
  const [layout, setLayout] = useState<Layout | null>(null);
  const card = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const waiting =
    step?.id === "school"
      ? !hasSnapshot
      : step?.id === "plan"
        ? !hasPlan
        : false;

  useEffect(() => {
    if (step?.tab) useUi.getState().set({ tab: step.tab });
  }, [step]);
  useEffect(() => {
    // If a plan is deleted or the term changes during a tour, return to prerequisites.
    if (step && !["school", "plan"].includes(step.id) && !hasPlan)
      setIndex(
        api instanceof HttpWorkspace && !hasSnapshot
          ? 0
          : available.findIndex((item) => item.id === "plan"),
      );
  }, [hasPlan, hasSnapshot, step, api, available]);
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  useLayoutEffect(() => {
    if (!step) return;
    let frame = 0;
    let previous: HTMLElement | null = null;
    const update = () => {
      frame = 0;
      // Native dialogs own focus and the top layer. Resume when the user closes them.
      if (document.querySelector("dialog[open]")) {
        setLayout(null);
        return;
      }
      let target: HTMLElement | undefined;
      let selector = "";
      for (const candidate of step.targets) {
        target = [...document.querySelectorAll<HTMLElement>(candidate)].find(
          (element) => element.getClientRects().length > 0,
        );
        if (target) {
          selector = candidate;
          break;
        }
      }
      const missing = !target;
      if (!target) {
        selector = '[data-tour="replay"]';
        target = document.querySelector<HTMLElement>(selector) ?? undefined;
      }
      if (!target) {
        setLayout(null);
        return;
      }
      if (previous !== target) {
        previous = target;
        target.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
      }
      const r = target.getBoundingClientRect();
      const width = Math.min(330, window.innerWidth - 24);
      const height = card.current?.offsetHeight ?? 300;
      const gap = 14;
      let left: number;
      let top: number;
      if (window.innerWidth - r.right > width + gap + 12) {
        left = r.right + gap;
        top = r.top;
      } else if (r.left > width + gap + 12) {
        left = r.left - width - gap;
        top = r.top;
      } else {
        left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
        top =
          window.innerHeight - r.bottom >= height + gap + 12
            ? r.bottom + gap
            : r.top - height - gap;
      }
      top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
      const next = {
        x: r.left - 4,
        y: r.top - 4,
        width: r.width + 8,
        height: r.height + 8,
        left,
        top,
        target: selector,
        missing,
      };
      setLayout((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            !(
              record.target instanceof Element &&
              record.target.closest("[data-tour-overlay]")
            ),
        )
      )
        schedule();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open", "hidden", "class", "disabled"],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    if (card.current) resize.observe(card.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [step]);

  const visible = layout !== null;
  // Re-measure the card after it first appears or its copy changes.
  useLayoutEffect(() => {
    if (!visible || !card.current) return;
    const resize = new ResizeObserver(() =>
      window.dispatchEvent(new Event("resize")),
    );
    resize.observe(card.current);
    return () => resize.disconnect();
  }, [visible]);

  if (!step || !layout) return null;
  return createPortal(
    <div data-tour-overlay="true">
      <div
        aria-hidden="true"
        className="tour-spotlight"
        data-tour-highlight={layout.target}
        style={{
          left: layout.x,
          top: layout.y,
          width: layout.width,
          height: layout.height,
        }}
      />
      <section
        ref={card}
        className="tour-card"
        aria-label="新手指引"
        style={{ left: layout.left, top: layout.top }}
      >
        <div aria-live="polite" aria-atomic="true">
          <p className="tour-count">
            第 {index + 1} 步 / {available.length}
          </p>
          <h3>{step.title}</h3>
          <p>
            {layout.missing
              ? "这一步的区域暂未显示。可以返回对应页面继续，或稍后重新查看指引。"
              : step.text}
          </p>
          {layout.missing && step.tab && (
            <Button
              onClick={() => {
                if (step.tab) useUi.getState().set({ tab: step.tab });
              }}
            >
              回到这一步
            </Button>
          )}
          <p className="tour-hint">
            {waiting
              ? step.id === "school"
                ? "等待课程同步或归档导入完成…"
                : "等待你创建或选择一份计划…"
              : "可以直接操作高亮控件，再继续下一步。"}
          </p>
        </div>
        <div className="tour-actions">
          <Button onClick={close}>稍后再看</Button>
          <div>
            <Button disabled={index === 0} onClick={() => setIndex(index - 1)}>
              上一步
            </Button>
            <Button
              className="primary-button"
              disabled={waiting || layout.missing}
              onClick={() =>
                index === available.length - 1 ? close() : setIndex(index + 1)
              }
            >
              {index === available.length - 1 ? "完成指引" : "下一步"}
            </Button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
