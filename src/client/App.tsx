import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import type { SectionData } from "../shared/contracts/catalog.js";
import type { PlanData } from "../shared/contracts/planning.js";
import {
  CourseCard,
  teacherLabel,
  timeLabel,
} from "./components/CourseCard.js";
import { HttpCatalog } from "./components/HttpCatalog.js";
import { LocalData } from "./components/LocalData.js";
import { ModelSettings } from "./components/ModelSettings.js";
import { PlanningAssistant } from "./components/PlanningAssistant.js";
import { ReorderHandle } from "./components/ReorderHandle.js";
import { SchoolConnection } from "./components/SchoolConnection.js";
import { Timetable } from "./components/Timetable.js";
import { Button, Empty, Modal } from "./components/ui.js";
import { Welcome } from "./components/Welcome.js";
import { useWorkspace } from "./data/context.js";
import { HttpWorkspace } from "./data/http.js";
import type { Analysis, Preview, SnapshotView } from "./data/port.js";
import { useUi } from "./ui-store.js";

const tabs = [
  { id: "explore", label: "探索课程", number: "01" },
  { id: "shortlist", label: "候选清单", number: "02" },
  { id: "draft", label: "志愿草稿", number: "03" },
] as const;

export function App() {
  const { api, demo, info, refreshInfo } = useWorkspace();
  const client = useQueryClient();
  const ui = useUi();
  const plans = useQuery({
    queryKey: ["workspace", "plans"],
    queryFn: () => api.listPlans(),
  });
  const [dialog, setDialog] = useState<"new" | "reset" | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const selectedId =
    plans.data?.items.find((plan) => plan.id === ui.planId)?.id ??
    plans.data?.items[0]?.id;
  const action = useMutation({
    mutationFn: (work: () => Promise<void>) => work(),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) => setStatus(error.message),
  });
  const run = (work: () => Promise<void>) => {
    setStatus("");
    action.mutate(work);
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">
        跳到工作区
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ▦
          </span>
          <div>
            <strong>选课工作台</strong>
            <small>COURSE WORKSPACE</small>
          </div>
        </div>
        <div className="semester-label">当前学期</div>
        <div className="semester">
          {info.termLabel}

          {info.terms.length > 1 && (
            <select
              aria-label="切换学期"
              value={info.termId}
              onChange={(event) => {
                const termId = event.currentTarget.value;
                run(async () => {
                  ui.set({ planId: "" });
                  await refreshInfo(termId);
                });
              }}
            >
              {info.terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="sidebar-heading">
          <span>我的计划</span>
          <Button
            aria-label="新建计划"
            disabled={action.isPending || !info.initialSnapshotId}
            onClick={() => {
              setName("");
              setDialog("new");
            }}
          >
            ＋
          </Button>
        </div>
        <nav aria-label="我的计划" className="plan-nav">
          {plans.data?.items.map((plan) => (
            <Button
              key={plan.id}
              className={selectedId === plan.id ? "active-plan" : ""}
              aria-current={selectedId === plan.id ? "page" : undefined}
              disabled={action.isPending}
              onClick={() => {
                ui.set({ planId: plan.id });
                setStatus("");
              }}
            >
              <span aria-hidden="true">▤</span>
              <span>{plan.name}</span>
            </Button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {demo && (
            <details>
              <summary>演示工具</summary>
              <Button
                disabled={action.isPending}
                onClick={() => {
                  setStatus("");
                  demo.failNextLoad();
                  void client
                    .resetQueries({
                      queryKey: ["workspace", "plans"],
                      exact: true,
                    })
                    .catch((error: Error) => setStatus(error.message));
                }}
              >
                模拟加载失败
              </Button>
              <Button
                disabled={action.isPending}
                onClick={() => setDialog("reset")}
              >
                重置演示
              </Button>
            </details>
          )}
          <LocalData />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <SchoolConnection />
          <ModelSettings />
          <span className="topbar-term">{info.termLabel}</span>
          {info.synthetic && <span className="demo-pill">合成数据</span>}
        </header>
        <main id="workspace-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR NEXT SEMESTER</span>
              <h1>ZJU 选课助手</h1>
              <p>探索课程，安排你的新学期。</p>
            </div>
            {demo && (
              <Button
                className="primary-button"
                disabled={action.isPending || !selectedId}
                onClick={() =>
                  run(async () => {
                    await demo.publish();
                    setStatus(
                      "新的演示快照已就绪。计划仍锚定旧快照，请打开对账。",
                    );
                  })
                }
              >
                ↻ 模拟同步更新
              </Button>
            )}
          </div>
          {status && (
            <div role="status" className="notice">
              {status}
            </div>
          )}
          {plans.isPending ? (
            <Empty>
              <span role="status">正在加载本机计划…</span>
            </Empty>
          ) : plans.isError ? (
            <div role="alert" className="notice danger">
              <p>{plans.error.message}</p>
              <Button onClick={() => plans.refetch()}>重试加载</Button>
              <Button onClick={() => setDialog("reset")}>重置演示</Button>
            </div>
          ) : selectedId ? (
            <PlanWorkspace
              key={selectedId}
              planId={selectedId}
              globalBusy={action.isPending}
            />
          ) : (
            <Empty>
              <h2>还没有计划</h2>
              <p>
                {info.initialSnapshotId
                  ? "创建空白计划，从课程探索开始。"
                  : "请先点击顶部「连接教务」登录并同步，或从「本机数据与备份」导入规划归档。"}
              </p>
              <Button
                className="primary-button"
                disabled={!info.initialSnapshotId}
                onClick={() => {
                  setName("");
                  setDialog("new");
                }}
              >
                创建第一个计划
              </Button>
            </Empty>
          )}
        </main>
      </div>
      <Welcome />
      {dialog === "new" && (
        <Modal title="新建计划" close={() => setDialog(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                const result = await api.createPlan({
                  mode: "empty",
                  snapshotId: info.initialSnapshotId ?? "missing",
                  name: name.trim(),
                });
                ui.set({ planId: result.plan.id, tab: "explore" });
                setDialog(null);
              });
            }}
          >
            <label className="form-label">
              计划名称
              <input
                autoComplete="off"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p className="muted">
              使用当前学期快照创建空白计划，已选基线仍会出现在课表中。
            </p>
            <Button
              className="primary-button"
              type="submit"
              disabled={!name.trim() || action.isPending}
            >
              创建计划
            </Button>
            {action.isError && <p role="alert">{action.error.message}</p>}
          </form>
        </Modal>
      )}
      {dialog === "reset" && demo && (
        <Modal title="重置合成演示" close={() => setDialog(null)}>
          <p>仅删除此浏览器中的合成计划，并恢复初始示例。此操作不能撤销。</p>
          <Button
            className="danger-button"
            disabled={action.isPending}
            onClick={() =>
              run(async () => {
                demo.reset();
                ui.set({
                  planId: "plan-main",
                  tab: "explore",
                  query: "",
                  availableOnly: false,
                });
                setDialog(null);
                await client.resetQueries({ queryKey: ["workspace"] });
                setStatus("演示已重置。");
              })
            }
          >
            确认重置演示
          </Button>
          {action.isError && <p role="alert">{action.error.message}</p>}
        </Modal>
      )}
    </div>
  );
}

function PlanWorkspace({
  planId,
  globalBusy,
}: {
  planId: string;
  globalBusy: boolean;
}) {
  const { api, info } = useWorkspace();
  const client = useQueryClient();
  const ui = useUi();
  const view = useQuery({
    queryKey: ["workspace", "plan", planId],
    queryFn: () => api.getPlan(planId),
  });
  const plan = view.data?.plan;
  const snapshot = useQuery({
    queryKey: ["workspace", "snapshot", plan?.snapshotId, plan?.revision],
    placeholderData: (previous) => previous,
    enabled: !!plan,
    queryFn: () => {
      if (!plan) throw new Error("Plan missing");
      return api.getSnapshot(
        plan.snapshotId,
        plan.content.shortlist.map((c) => c.courseId),
      );
    },
  });
  const analysis = useQuery({
    queryKey: ["workspace", "analysis", planId, plan?.revision],
    placeholderData: (previous) => previous,
    enabled: !!plan,
    queryFn: () => {
      if (!plan) throw new Error("Plan missing");
      return api.getAnalysis(plan);
    },
  });
  const [dialog, setDialog] = useState<
    "copy" | "rename" | "delete" | "preferences" | null
  >(null);
  const [text, setText] = useState("");
  const [noteSection, setNoteSection] = useState<SectionData | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: (work: () => Promise<void>) => work(),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const run = (work: () => Promise<void>) => {
    setMessage("");
    mutation.mutate(work);
  };
  const busy =
    globalBusy ||
    mutation.isPending ||
    view.isFetching ||
    snapshot.isFetching ||
    analysis.isFetching;
  const edit = (change: (content: PlanData["content"]) => void) => {
    if (!plan || busy) return;
    const content = structuredClone(plan.content);
    change(content);
    run(async () => {
      await api.updatePlan(plan.id, {
        expectedRevision: plan.revision,
        content,
      });
      setMessage(`修改已保存在${info.storageLabel}。`);
    });
  };
  const problem = view.error ?? snapshot.error ?? analysis.error;
  if (problem)
    return (
      <div className="notice danger" role="alert">
        <p>{problem.message}</p>
        <Button
          onClick={() => client.invalidateQueries({ queryKey: ["workspace"] })}
        >
          重试工作区
        </Button>
      </div>
    );
  if (!plan || !snapshot.data || !analysis.data)
    return (
      <Empty>
        <span role="status">正在加载计划与课表投影…</span>
      </Empty>
    );
  const data = snapshot.data;
  const derived = analysis.data;
  const openNameDialog = (type: "copy" | "rename") => {
    setText(
      type === "copy" ? `${plan.content.name} · 副本` : plan.content.name,
    );
    setDialog(type);
  };
  const sectionNote = (section: SectionData) => {
    setText(
      plan.content.shortlist
        .flatMap((course) => course.items)
        .find((item) => item.sectionId === section.id)?.note ?? "",
    );
    setNoteSection(section);
  };
  return (
    <>
      <section className="plan-toolbar" aria-label="当前计划">
        <div>
          <h2>{plan.content.name}</h2>
          <span
            className="muted"
            data-testid="plan-stamp"
            data-revision={plan.revision}
            data-snapshot={plan.snapshotId}
          >
            更新于{" "}
            {new Date(data.meta.capturedAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </span>
        </div>
        <div className="toolbar-actions">
          <Button disabled={busy} onClick={() => openNameDialog("rename")}>
            重命名
          </Button>
          <Button disabled={busy} onClick={() => openNameDialog("copy")}>
            复制计划
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setText(
                plan.content.preferences.creditLimit === null
                  ? ""
                  : String(plan.content.preferences.creditLimit),
              );
              setDialog("preferences");
            }}
          >
            学分上限
          </Button>
          <Button
            disabled={busy}
            aria-label="删除当前计划"
            onClick={() => setDialog("delete")}
          >
            删除
          </Button>
        </div>
      </section>
      {view.data?.requiresReconciliation && (
        <div className="reconcile-banner">
          <div>
            <strong>有新的快照，计划还没有改变。</strong>
            <p>查看时间、状态与取消项，逐项确认后更新当前计划。</p>
          </div>
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                setPreview(
                  await api.previewReconciliation(plan.id, {
                    expectedRevision: plan.revision,
                    targetSnapshotId:
                      view.data?.latestLiveSnapshotId ??
                      info.nextSnapshotId ??
                      "missing",
                  }),
                );
                setAcknowledged([]);
              })
            }
          >
            查看对账
          </Button>
        </div>
      )}
      {message && (
        <div
          role="status"
          className={`notice ${mutation.isError ? "danger" : ""}`}
        >
          {message}
        </div>
      )}
      <div className="workspace-columns">
        <section className="planning-panel">
          <nav className="tabs" aria-label="规划步骤">
            {tabs.map((tab) => (
              <Button
                key={tab.id}
                aria-current={ui.tab === tab.id ? "step" : undefined}
                className={ui.tab === tab.id ? "active-tab" : ""}
                onClick={() => ui.set({ tab: tab.id })}
              >
                <small>{tab.number}</small>
                {tab.label}
              </Button>
            ))}
          </nav>
          {ui.tab === "explore" && (
            <>
              <div className="search-area">
                <label className="search-box">
                  <span aria-hidden="true">⌕</span>
                  <input
                    aria-label="搜索课程、代码或教师"
                    placeholder="搜索名称、课号或教师…"
                    value={ui.query}
                    onChange={(event) => ui.set({ query: event.target.value })}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={ui.availableOnly}
                    onChange={(event) =>
                      ui.set({ availableOnly: event.target.checked })
                    }
                  />
                  仅显示学校标示可选
                </label>
              </div>
              <Catalog
                snapshot={data}
                plan={plan}
                busy={busy}
                edit={edit}
                note={sectionNote}
              />
            </>
          )}
          <div hidden={ui.tab !== "shortlist"}>
            <Shortlist
              plan={plan}
              snapshot={data}
              busy={busy}
              edit={edit}
              note={sectionNote}
            />
          </div>
          {ui.tab === "draft" && (
            <DraftView snapshot={data} analysis={derived} plan={plan} />
          )}
        </section>
        <Timetable snapshot={data} analysis={derived} />
      </div>
      {(dialog === "copy" ||
        dialog === "rename" ||
        dialog === "preferences") && (
        <Modal
          title={
            dialog === "copy"
              ? "复制当前计划"
              : dialog === "rename"
                ? "重命名计划"
                : "设置学分上限"
          }
          close={() => setDialog(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                if (dialog === "copy") {
                  const copy = await api.createPlan({
                    mode: "copy",
                    source: {
                      planId: plan.id,
                      expectedRevision: plan.revision,
                    },
                    name: text.trim(),
                  });
                  ui.set({ planId: copy.plan.id });
                } else {
                  const content = structuredClone(plan.content);
                  if (dialog === "rename") content.name = text.trim();
                  else
                    content.preferences.creditLimit =
                      text === "" ? null : Number(text);
                  await api.updatePlan(plan.id, {
                    expectedRevision: plan.revision,
                    content,
                  });
                }
                setDialog(null);
              });
            }}
          >
            <label className="form-label">
              {dialog === "preferences"
                ? "学分上限（包含已选基线；留空表示未知）"
                : "计划名称"}
              <input
                type={dialog === "preferences" ? "number" : "text"}
                min={0}
                max={dialog === "preferences" ? 1000 : undefined}
                step={dialog === "preferences" ? "0.5" : undefined}
                maxLength={100}
                required={dialog !== "preferences"}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <Button
              className="primary-button"
              type="submit"
              disabled={busy || (dialog !== "preferences" && !text.trim())}
            >
              保存
            </Button>
            {mutation.isError && <p role="alert">{mutation.error.message}</p>}
          </form>
        </Modal>
      )}
      {dialog === "delete" && (
        <Modal title="删除当前计划" close={() => setDialog(null)}>
          <p>删除「{plan.content.name}」及其演示笔记，其他计划不受影响。</p>
          <Button
            className="danger-button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.deletePlan(plan.id, plan.revision);
                ui.set({ planId: "" });
                setDialog(null);
              })
            }
          >
            确认删除计划
          </Button>
        </Modal>
      )}
      {noteSection && (
        <Modal
          title={`${teacherLabel(noteSection)} · 笔记`}
          close={() => setNoteSection(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const section = noteSection;
              const content = structuredClone(plan.content);
              let course = content.shortlist.find(
                (row) => row.courseId === section.courseId,
              );
              if (!course) {
                course = {
                  courseId: section.courseId,
                  favorite: false,
                  note: "",
                  items: [],
                };
                content.shortlist.push(course);
              }
              const item = course.items.find(
                (row) => row.sectionId === section.id,
              );
              if (item) item.note = text;
              else
                course.items.push({
                  sectionId: section.id,
                  disposition: "reference",
                  favorite: false,
                  note: text,
                });
              run(async () => {
                await api.updatePlan(plan.id, {
                  expectedRevision: plan.revision,
                  content,
                });
                setNoteSection(null);
              });
            }}
          >
            <label className="form-label">
              教学班笔记
              <textarea
                maxLength={4000}
                rows={5}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <p className="muted">
              笔记保存在当前计划。仅写笔记不会自动加入候选。
            </p>
            <Button className="primary-button" type="submit" disabled={busy}>
              保存笔记
            </Button>
            {mutation.isError && <p role="alert">{mutation.error.message}</p>}
          </form>
        </Modal>
      )}
      {preview && (
        <Modal title="逐项确认快照变化" close={() => setPreview(null)}>
          <p>此次对账只更新「{plan.content.name}」。未确认前仍使用旧快照。</p>
          <div className="change-list">
            {preview.changes.map((change) => (
              <label className="change-row" key={change.id}>
                <input
                  type="checkbox"
                  checked={acknowledged.includes(change.id)}
                  onChange={(event) =>
                    setAcknowledged((ids) =>
                      event.target.checked
                        ? [...ids, change.id]
                        : ids.filter((id) => id !== change.id),
                    )
                  }
                />
                <div>
                  <strong>
                    {change.kind === "section_cancelled"
                      ? "教学班取消"
                      : change.kind === "status_changed"
                        ? "容量与状态变更"
                        : "教学时间变更"}
                  </strong>
                  <p className="change-before">{change.before.join(" · ")}</p>
                  <p>{change.after.join(" · ")}</p>
                  {change.suggestedSectionIds.length > 0 && (
                    <small>
                      可查看替代班：{change.suggestedSectionIds.join("、")}
                      （不会自动替换）
                    </small>
                  )}
                </div>
              </label>
            ))}
          </div>
          <Button
            className="primary-button"
            disabled={busy || acknowledged.length !== preview.changes.length}
            onClick={() =>
              run(async () => {
                await api.applyReconciliation(plan.id, preview.id, {
                  expectedRevision: preview.expectedRevision,
                  acknowledgedChangeIds: acknowledged,
                });
                setPreview(null);
                setMessage("已完成对账，取消项及原笔记保留在计划历史中。");
              })
            }
          >
            确认 {acknowledged.length}/{preview.changes.length} 项并更新计划
          </Button>
          {mutation.isError && <p role="alert">{mutation.error.message}</p>}
        </Modal>
      )}
    </>
  );
}

function Catalog({
  snapshot,
  ...props
}: {
  snapshot: SnapshotView;
  plan: PlanData;
  busy: boolean;
  edit: (change: (content: PlanData["content"]) => void) => void;
  note: (section: SectionData) => void;
}) {
  const { query, availableOnly } = useUi();
  const { api } = useWorkspace();
  if (api instanceof HttpWorkspace)
    return <HttpCatalog api={api} snapshot={snapshot} {...props} />;
  const term = query.trim().toLocaleLowerCase();
  const courses = snapshot.courses
    .map((course) => ({
      course,
      sections: snapshot.sections.filter(
        (section) =>
          section.courseId === course.id &&
          (!availableOnly || section.officialState === "available"),
      ),
    }))
    .filter(
      ({ course, sections }) =>
        sections.length > 0 &&
        (`${course.title} ${course.code}`.toLocaleLowerCase().includes(term) ||
          sections.some(
            (section) =>
              teacherLabel(section).includes(term) ||
              (section.selectionCode.state === "known" &&
                section.selectionCode.value.toLocaleLowerCase().includes(term)),
          )),
    );
  return (
    <div className="catalog">
      <div className="list-caption">
        {courses.length} 门课程 <span></span>
      </div>
      {courses.length ? (
        courses.map(({ course, sections }) => (
          <CourseCard
            key={course.id}
            course={course}
            sections={sections}
            snapshot={snapshot}
            {...props}
          />
        ))
      ) : (
        <Empty>
          <h3>没有匹配的课程</h3>
          <p>尝试其他关键词，或取消可选状态筛选。</p>
        </Empty>
      )}
    </div>
  );
}

function Shortlist({
  plan,
  snapshot,
  busy,
  edit,
  note,
}: {
  plan: PlanData;
  snapshot: SnapshotView;
  busy: boolean;
  edit: (change: (content: PlanData["content"]) => void) => void;
  note: (section: SectionData) => void;
}) {
  const ui = useUi();
  const baseline =
    snapshot.enrolledSectionIds.state === "known"
      ? snapshot.enrolledSectionIds.value
      : [];
  const reorder = (courseId: string, sectionId: string, targetRank: number) =>
    edit((content) => {
      const course = content.shortlist.find((row) => row.courseId === courseId);
      if (!course) return;
      const indices = course.items.flatMap((item, index) =>
        item.disposition === "candidate" ? [index] : [],
      );
      const current = indices.findIndex(
        (index) => course.items[index]?.sectionId === sectionId,
      );
      if (current < 0 || targetRank < 0 || targetRank >= indices.length) return;
      const ordered = indices
        .map((index) => course.items[index])
        .filter((item) => item !== undefined);
      const [moved] = ordered.splice(current, 1);
      if (!moved) return;
      ordered.splice(targetRank, 0, moved);
      indices.forEach((index, position) => {
        const item = ordered[position];
        if (item) course.items[index] = item;
      });
    });
  return (
    <div className="shortlist">
      <div className="shortlist-intro">
        <h3>排列你的偏好</h3>
        <p id="sort-help">
          拖动手柄或使用方向键排序，排在最前的教学班成为首选。
        </p>
        <PlanningAssistant plan={plan} snapshot={snapshot} busy={busy} />
      </div>
      {baseline.length > 0 && (
        <div className="baseline">
          <strong>已选课程</strong>
          {baseline.map((id) => (
            <p key={id}>
              {
                snapshot.courses.find(
                  (course) =>
                    course.id ===
                    snapshot.sections.find((section) => section.id === id)
                      ?.courseId,
                )?.title
              }{" "}
              · {(() => {
                const section = snapshot.sections.find((row) => row.id === id);
                return section ? teacherLabel(section) : "教学班已失效";
              })()}
            </p>
          ))}
        </div>
      )}
      {plan.content.shortlist.length === 0 && (
        <Empty>
          <h3>从第一个教学班开始</h3>
          <p>候选、排除与笔记都会保存在这份计划中。</p>
          <Button onClick={() => ui.set({ tab: "explore" })}>去探索课程</Button>
        </Empty>
      )}
      {plan.content.shortlist.map((course) => {
        const candidates = course.items.filter(
          (item) => item.disposition === "candidate",
        );
        return (
          <section
            className="shortlist-course"
            key={course.courseId}
            aria-label={
              snapshot.courses.find((row) => row.id === course.courseId)?.title
            }
          >
            <div className="section-heading">
              <h3>
                {snapshot.courses.find((row) => row.id === course.courseId)
                  ?.title ?? "课程已失效"}
              </h3>
              <span className="tag">{candidates.length} 个候选</span>
            </div>
            {course.note && <p className="muted">课程笔记：{course.note}</p>}
            {!candidates.length && (
              <p className="muted">尚未确定候选；排除与参考项仍保留。</p>
            )}
            {course.items.map((item) => {
              const section = snapshot.sections.find(
                (row) => row.id === item.sectionId,
              );
              if (!section) return null;
              const rank = candidates.findIndex(
                (row) => row.sectionId === item.sectionId,
              );
              return (
                <article
                  className={`shortlist-item ${item.disposition !== "candidate" ? "noncandidate" : ""}`}
                  key={item.sectionId}
                  data-sort-rank={rank >= 0 ? rank : undefined}
                  aria-label={`${teacherLabel(section)}候选项`}
                >
                  <span className="rank">{rank >= 0 ? rank + 1 : "–"}</span>
                  <div className="shortlist-info">
                    <strong>
                      {teacherLabel(section)}{" "}
                      {item.favorite && (
                        <span className="favorite-star">★</span>
                      )}
                    </strong>
                    <p>{timeLabel(section)}</p>
                    <small>
                      {item.disposition === "candidate"
                        ? rank === 0
                          ? "首选"
                          : "互斥备选"
                        : item.disposition === "excluded"
                          ? "已排除"
                          : "仅供参考"}
                    </small>
                    {item.note && <p className="note-text">{item.note}</p>}
                    <div className="inline-actions">
                      <Button disabled={busy} onClick={() => note(section)}>
                        笔记
                      </Button>
                      {item.disposition !== "candidate" && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            edit((content) => {
                              const found = content.shortlist
                                .flatMap((row) => row.items)
                                .find(
                                  (row) => row.sectionId === item.sectionId,
                                );
                              if (found) found.disposition = "candidate";
                            })
                          }
                        >
                          恢复候选
                        </Button>
                      )}
                      <Button
                        disabled={busy}
                        onClick={() =>
                          edit((content) => {
                            const group = content.shortlist.find(
                              (row) => row.courseId === course.courseId,
                            );
                            if (group)
                              group.items = group.items.filter(
                                (row) => row.sectionId !== item.sectionId,
                              );
                          })
                        }
                      >
                        移除
                      </Button>
                    </div>
                  </div>
                  {rank >= 0 && (
                    <ReorderHandle
                      label={teacherLabel(section)}
                      rank={rank}
                      count={candidates.length}
                      disabled={busy}
                      move={(target) =>
                        reorder(course.courseId, item.sectionId, target)
                      }
                    />
                  )}
                </article>
              );
            })}
            <Button
              disabled={busy}
              onClick={() =>
                edit((content) => {
                  content.shortlist = content.shortlist.filter(
                    (row) => row.courseId !== course.courseId,
                  );
                  content.preferences.courseOverrides =
                    content.preferences.courseOverrides.filter(
                      (o) => o.courseId !== course.courseId,
                    );
                })
              }
            >
              移除此课程及笔记
            </Button>
          </section>
        );
      })}
      {plan.history.length > 0 && (
        <details className="history">
          <summary>对账历史 · {plan.history.length} 项</summary>
          {plan.history.map((entry) => (
            <div
              key={`${entry.previousSnapshotId}-${entry.courseId}-${entry.previousItem?.sectionId}-${entry.at}`}
            >
              <strong>
                {entry.courseLabel} · {entry.sectionLabel}
              </strong>
              <p>
                教学班取消 · 保留原笔记：{entry.previousItem?.note || "无笔记"}
              </p>
              <p>原课程笔记：{entry.courseNote || "无"}</p>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function DraftView({
  snapshot,
  analysis,
  plan,
}: {
  snapshot: SnapshotView;
  analysis: Analysis;
  plan: PlanData;
}) {
  const { draft } = analysis;
  const { api } = useWorkspace();
  const [exporting, setExporting] = useState(false),
    [message, setMessage] = useState("");
  const canExport =
    api instanceof HttpWorkspace &&
    draft.validation.status === "valid" &&
    snapshot.meta.provenance.origin === "live" &&
    !snapshot.meta.provenance.synthetic &&
    snapshot.meta.coverage === "complete";

  const ui = useUi();
  const issues = draft.validation.issues;
  const labels: Record<string, ReactNode> = {
    error: "需处理",
    unknown: "待核验",
    warning: "提醒",
  };
  return (
    <div className="draft">
      <div className="draft-heading">
        <span className="eyebrow">REVIEW BEFORE ACTION</span>
        <h3>志愿草稿</h3>
        <p>确认填报顺序，处理需要调整的项目。</p>
      </div>
      <div
        className={`notice ${draft.validation.status === "valid" ? "" : "warning"}`}
      >
        <strong>
          {draft.validation.status === "invalid"
            ? "有阻断问题"
            : draft.validation.status === "valid"
              ? "志愿草稿校验通过"
              : "暂不能判定可执行"}
        </strong>
      </div>
      {draft.entries.length === 0 ? (
        <Empty>尚无候选，请先建立清单。</Empty>
      ) : (
        <div className="draft-table-wrap">
          <table>
            <caption className="sr-only">志愿草稿</caption>
            <thead>
              <tr>
                <th>课程 / 教学班</th>
                <th>本课程志愿顺序</th>
                <th>时间上限校验</th>
              </tr>
            </thead>
            <tbody>
              {draft.entries.map((entry) => (
                <tr key={entry.sectionId}>
                  <td>
                    <strong>
                      {
                        snapshot.courses.find(
                          (course) => course.id === entry.courseId,
                        )?.title
                      }
                    </strong>
                    <small>
                      {(() => {
                        const code = snapshot.sections.find(
                          (s) => s.id === entry.sectionId,
                        )?.selectionCode;
                        return code?.state === "known"
                          ? code.value
                          : "课程序号未知";
                      })()}
                    </small>
                  </td>
                  <td>
                    <span className="rank">{entry.priority}</span>
                  </td>
                  <td>
                    {entry.timeGroupIds.state === "known"
                      ? "按重叠节次校验"
                      : "上课时间待补充"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {issues.length > 0 && <h4>待处理与提醒 · {issues.length} 项</h4>}
      <ul className="issue-list">
        {issues.map((issue) => (
          <li key={issue.id} className={`issue ${issue.severity}`}>
            <span className="tag">{labels[issue.severity]}</span>
            <div>
              <p>{issue.message}</p>
              {issue.sectionIds.length > 0 && (
                <small>
                  {issue.sectionIds
                    .map((id) => {
                      const section = snapshot.sections.find(
                        (row) => row.id === id,
                      );
                      return section
                        ? `${snapshot.courses.find((row) => row.id === section.courseId)?.title ?? "课程"} · ${teacherLabel(section)}`
                        : "教学班已失效";
                    })
                    .join("、")}
                </small>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="draft-actions">
        <Button onClick={() => ui.set({ tab: "shortlist" })}>
          返回候选清单调整
        </Button>
        <Button
          disabled={!canExport || exporting}
          title={
            canExport
              ? "导出前由服务端重新校验"
              : "需真实完整快照、已核验规则与有效草稿；请先处理上方问题"
          }
          onClick={() => {
            if (!(api instanceof HttpWorkspace)) return;
            setExporting(true);
            setMessage("");
            void api
              .request(
                "exportChecklist",
                { planId: plan.id },
                {},
                {
                  expectedRevision: plan.revision,
                  acknowledgedExcludedSectionIds: [],
                },
              )
              .then((result) => {
                const url = URL.createObjectURL(
                  new Blob([result.text], { type: "text/plain;charset=utf-8" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = "zju-manual-checklist.txt";
                link.click();
                URL.revokeObjectURL(url);
                setMessage("填写清单已下载，请回到学校页面自行核对并填写。");
              })
              .catch((e: Error) => setMessage(e.message))
              .finally(() => setExporting(false));
          }}
        >
          导出填写清单
        </Button>
      </div>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </div>
  );
}
