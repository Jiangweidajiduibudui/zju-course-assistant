import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type {
  HardConstraint,
  PlanData,
} from "../../shared/contracts/planning.js";
import { useWorkspace } from "../data/context.js";
import { HttpWorkspace } from "../data/http.js";
import type {
  InterpretationData,
  PlanningJobData,
  SnapshotView,
} from "../data/port.js";
import { useUi } from "../ui-store.js";
import { ReorderHandle } from "./ReorderHandle.js";
import { Timetable } from "./Timetable.js";
import { Button, Modal } from "./ui.js";

const criteria = {
  candidate_order: "候选顺序优先",
  compact_days: "上课日更集中",
  free_mornings: "尽量保留上午",
  campus: "校区偏好",
  review_evidence: "参考可靠评价",
} as const;
type Profile = PlanData["content"]["preferences"];
type Rule = z.infer<typeof HardConstraint>;
const ruleText = (rule: Rule) =>
  rule.kind === "no_teaching_overlap"
    ? "不允许教学时间重叠"
    : rule.kind === "credit_limit"
      ? `总学分不超过 ${rule.maximum}`
      : rule.kind === "campus"
        ? `仅接受校区：${rule.campuses.join("、")}`
        : `${rule.slot.partId} · 第 ${rule.slot.weeks.join("、")} 周 · 周${rule.slot.weekday} ${rule.slot.startPeriod}–${rule.slot.endPeriod} 节不可用`;
export function PlanningAssistant({
  plan,
  snapshot,
  busy,
}: {
  plan: PlanData;
  snapshot: SnapshotView;
  busy: boolean;
}) {
  const { api } = useWorkspace();
  const client = useQueryClient();
  const ui = useUi();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>(
    structuredClone(plan.content.preferences),
  );
  const [scope, setScope] = useState("plan");
  const [interpretation, setInterpretation] =
    useState<InterpretationData | null>(null);
  const [job, setJob] = useState<PlanningJobData | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [ack, setAck] = useState(false);
  const [part, setPart] = useState(snapshot.term.parts[0]?.id ?? "");
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(2);
  const [firstWeek, setFirstWeek] = useState(1);
  const [lastWeek, setLastWeek] = useState(8);
  const [campus, setCampus] = useState("");
  const editRevision = useRef(plan.revision);
  const generationEpoch = useRef(0);
  const adoptionKey = useRef(crypto.randomUUID());
  const requestKey = useRef<{ revision: number; key: string } | null>(null);
  const operation = async (work: () => Promise<void>) => {
    setWorking(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      setWorking(false);
    }
  };
  useEffect(() => {
    if (
      job &&
      job.status !== "stale" &&
      job.stamp.planRevision !== plan.revision
    ) {
      generationEpoch.current++;
      setJob({
        ...job,
        status: "stale",
        proposals: [],
        finishedAt: new Date().toISOString(),
      });
    }
  }, [plan.revision, job]);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let active = true;
    const timer = setTimeout(() => {
      void api
        .getPlanningJob(job.id)
        .then((next) => {
          if (active) setJob(next);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, job]);
  const change = (fn: (next: Profile) => void) => {
    setProfile((previous) => {
      const next = structuredClone(previous);
      fn(next);
      return next;
    });
    setAck(false);
  };
  const scoped = (next: Profile) => {
    if (scope === "plan") return next;
    let override = next.courseOverrides.find((o) => o.courseId === scope);
    if (!override) {
      override = { courseId: scope, orderedCriteria: [], hardConstraints: [] };
      next.courseOverrides.push(override);
    }
    return override;
  };
  const current: Pick<Profile, "orderedCriteria" | "hardConstraints"> =
    scope === "plan"
      ? profile
      : (profile.courseOverrides.find((o) => o.courseId === scope) ?? {
          orderedCriteria: [],
          hardConstraints: [],
        });
  const save = async (confirm: boolean) => {
    const preferences = structuredClone(profile);
    if (confirm) {
      if (preferences.unresolvedClauses.length)
        throw new Error("请先解决或明确移除未决条款。");
      preferences.textConfirmed = true;
    } else {
      // Saving text for interpretation must not activate unconfirmed editor rules.
      preferences.hardConstraints = structuredClone(
        plan.content.preferences.hardConstraints,
      );
      preferences.courseOverrides = preferences.courseOverrides.map((o) => ({
        ...o,
        hardConstraints: structuredClone(
          plan.content.preferences.courseOverrides.find(
            (old) => old.courseId === o.courseId,
          )?.hardConstraints ?? [],
        ),
      }));
    }
    const view = await api.updatePlan(plan.id, {
      expectedRevision: editRevision.current,
      content: { ...plan.content, preferences },
    });
    editRevision.current = view.plan.revision;
    if (confirm) setProfile(view.plan.content.preferences);
    await client.invalidateQueries({ queryKey: ["workspace"] });
    return view.plan;
  };
  const generate = () =>
    operation(async () => {
      if (api instanceof HttpWorkspace && !api.modelConfigured) {
        useUi.getState().set({ modelSettingsOpen: true });
        return;
      }
      const epoch = ++generationEpoch.current;
      setJob(null);
      adoptionKey.current = crypto.randomUUID();
      if (requestKey.current?.revision !== plan.revision)
        requestKey.current = {
          revision: plan.revision,
          key: crypto.randomUUID(),
        };
      const next = await api.generateTimetable(
        {
          plan: { planId: plan.id, expectedRevision: plan.revision },
          endpointId:
            api instanceof HttpWorkspace ? api.modelEndpointId : "default",
        },
        requestKey.current.key,
      );
      requestKey.current = null;
      if (epoch === generationEpoch.current) setJob(next);
      else await api.cancelPlanningJob(next.id);
    });
  const proposal = job?.proposals[0];
  return (
    <section className="planning-assistant" aria-label="AI 排课助手">
      <div className="toolbar-actions">
        <Button
          data-tour="preferences"
          disabled={busy || working}
          onClick={() => {
            editRevision.current = plan.revision;
            setProfile(structuredClone(plan.content.preferences));
            setInterpretation(null);
            setError("");
            setAck(false);
            setOpen(true);
          }}
        >
          我的偏好
        </Button>
        <Button
          className="primary-button"
          disabled={
            busy ||
            working ||
            (!!job && ["queued", "running"].includes(job.status))
          }
          onClick={() => void generate()}
        >
          AI 帮我排
        </Button>
      </div>
      {error && (
        <p role="alert" className="notice danger">
          {error}
        </p>
      )}
      {job && (
        <div className="proposal-preview" aria-live="polite">
          {["queued", "running"].includes(job.status) && (
            <>
              <p role="status">正在生成课表建议…</p>
              <Button
                onClick={() =>
                  void operation(async () => {
                    generationEpoch.current++;
                    setJob(await api.cancelPlanningJob(job.id));
                  })
                }
              >
                取消排课
              </Button>
            </>
          )}
          {job.status === "cancelled" && <p>排课已取消，原计划未改变。</p>}
          {job.status === "stale" && (
            <p>计划或快照已变化，旧方案已失效，请重新生成。</p>
          )}
          {job.status === "failed" && (
            <p>{job.error?.message ?? "生成失败，请重试。"}</p>
          )}
          {["cancelled", "stale", "failed"].includes(job.status) && (
            <Button disabled={working || busy} onClick={() => void generate()}>
              重试排课
            </Button>
          )}
          {proposal && (
            <>
              <h4>{proposal.synthetic ? "合成方案预览" : "课表方案预览"}</h4>
              <p>{proposal.output.explanation}</p>
              <ul>
                {proposal.output.selections.map((s) => (
                  <li key={s.sectionId}>
                    <strong>
                      {snapshot.courses.find((c) => c.id === s.courseId)
                        ?.title ?? s.courseId}
                    </strong>{" "}
                    · {(() => {
                      const section = snapshot.sections.find(
                        (row) => row.id === s.sectionId,
                      );
                      return section?.teachers.state === "known"
                        ? section.teachers.value
                            .map((teacher) => teacher.name)
                            .join("、")
                        : "教师待定";
                    })()}
                    <p className="muted">{s.reason}</p>
                  </li>
                ))}
              </ul>
              <p>
                首选课表校验：
                {proposal.validation.status === "valid"
                  ? "通过"
                  : proposal.validation.status === "invalid"
                    ? "未通过"
                    : "信息不足，不能确认"}
              </p>
              {proposal.analysis && (
                <details>
                  <summary>展开建议课表与完整草稿校验</summary>
                  <Timetable snapshot={snapshot} analysis={proposal.analysis} />
                  <p>
                    完整志愿草稿：
                    {proposal.analysis.draft.validation.status === "valid"
                      ? "通过"
                      : "仍有需处理或待核验问题"}
                  </p>
                  <ul>
                    {proposal.analysis.draft.validation.issues.map((i) => (
                      <li key={i.id}>{i.message}</li>
                    ))}
                  </ul>
                </details>
              )}
              <ul className="issue-list">
                {proposal.validation.issues.map((i) => (
                  <li key={i.id}>{i.message}</li>
                ))}
              </ul>
              <Button
                disabled={
                  working ||
                  busy ||
                  proposal.validation.status !== "valid" ||
                  job.stamp.planRevision !== plan.revision
                }
                onClick={() =>
                  void operation(async () => {
                    const result = await api.adoptPlanningProposal(
                      proposal.id,
                      {
                        plan: {
                          planId: plan.id,
                          expectedRevision: plan.revision,
                        },
                        name: `${plan.content.name.slice(0, 80)} · AI 备选`,
                      },
                      adoptionKey.current,
                    );
                    await client.invalidateQueries({ queryKey: ["workspace"] });
                    ui.set({ planId: result.plan.id, tab: "shortlist" });
                  })
                }
              >
                另存为 AI 备选计划
              </Button>
            </>
          )}
        </div>
      )}
      {open && (
        <Modal
          title="我的偏好"
          close={() => {
            if (!working) setOpen(false);
          }}
        >
          <p>排列偏好，补充你的排课要求。</p>
          <label className="form-label">
            规则范围
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="plan">整个计划</option>
              {plan.content.shortlist.map((c) => (
                <option key={c.courseId} value={c.courseId}>
                  {snapshot.courses.find((x) => x.id === c.courseId)?.title ??
                    c.courseId}
                </option>
              ))}
            </select>
          </label>
          <h3>偏好顺序</h3>
          <div className="shortlist-course preference-order">
            {current.orderedCriteria.map((key, index) => (
              <div key={key} data-sort-rank={index} className="preference-row">
                <span>
                  {index + 1}. {criteria[key]}
                </span>
                <ReorderHandle
                  label={criteria[key]}
                  rank={index}
                  count={current.orderedCriteria.length}
                  disabled={working}
                  move={(target) =>
                    change((next) => {
                      const row = scoped(next);
                      const [item] = row.orderedCriteria.splice(index, 1);
                      if (item) row.orderedCriteria.splice(target, 0, item);
                    })
                  }
                />
                <Button
                  aria-label={`移除偏好：${criteria[key]}`}
                  onClick={() =>
                    change((next) => {
                      scoped(next).orderedCriteria = scoped(
                        next,
                      ).orderedCriteria.filter((k) => k !== key);
                    })
                  }
                >
                  移除
                </Button>
              </div>
            ))}
          </div>
          <div className="toolbar-actions">
            {(Object.keys(criteria) as Array<keyof typeof criteria>)
              .filter((k) => !current.orderedCriteria.includes(k))
              .map((key) => (
                <Button
                  key={key}
                  disabled={working}
                  title={
                    key === "review_evidence"
                      ? "使用当前候选已加载且有效的评价和已有摘要；缺少证据时会提示，不会自动抓取或生成摘要"
                      : undefined
                  }
                  onClick={() =>
                    change((next) => scoped(next).orderedCriteria.push(key))
                  }
                >
                  ＋ {criteria[key]}
                </Button>
              ))}
          </div>
          <label className="form-label">
            偏好校区（全局软偏好，用逗号分隔）
            <input
              value={profile.preferredCampuses.join("，")}
              onChange={(e) =>
                change((next) => {
                  next.preferredCampuses = [
                    ...new Set(
                      e.target.value
                        .split(/[,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ),
                  ];
                })
              }
            />
          </label>
          <h3>硬约束</h3>
          <p className="muted">课程专属规则与全局硬约束共同生效。</p>
          {current.hardConstraints.map((rule) => (
            <div key={rule.id} className="preference-row">
              <span>{ruleText(rule)}</span>
              <Button
                aria-label={`移除约束：${ruleText(rule)}`}
                onClick={() =>
                  change((next) => {
                    scoped(next).hardConstraints = scoped(
                      next,
                    ).hardConstraints.filter((r) => r.id !== rule.id);
                  })
                }
              >
                移除
              </Button>
            </div>
          ))}
          <Button
            onClick={() =>
              change((next) => {
                if (
                  !scoped(next).hardConstraints.some(
                    (r) => r.kind === "no_teaching_overlap",
                  )
                )
                  scoped(next).hardConstraints.push({
                    id: `rule-${crypto.randomUUID()}`,
                    kind: "no_teaching_overlap",
                  });
              })
            }
          >
            添加：不允许上课重叠
          </Button>
          <label className="form-label">
            硬性校区（多个用逗号分隔）
            <input value={campus} onChange={(e) => setCampus(e.target.value)} />
          </label>
          <Button
            disabled={!campus.trim()}
            onClick={() =>
              change((next) =>
                scoped(next).hardConstraints.push({
                  id: `rule-${crypto.randomUUID()}`,
                  kind: "campus",
                  campuses: [
                    ...new Set(
                      campus
                        .split(/[,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ),
                  ],
                }),
              )
            }
          >
            添加校区约束
          </Button>
          <details>
            <summary>添加不可用时段</summary>
            <div className="time-rule-grid">
              <label>
                学期段
                <select value={part} onChange={(e) => setPart(e.target.value)}>
                  {snapshot.term.parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                星期
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                />
              </label>
              <label>
                开始节次
                <input
                  type="number"
                  min={1}
                  max={13}
                  value={start}
                  onChange={(e) => setStart(Number(e.target.value))}
                />
              </label>
              <label>
                结束节次
                <input
                  type="number"
                  min={1}
                  max={13}
                  value={end}
                  onChange={(e) => setEnd(Number(e.target.value))}
                />
              </label>
              <label>
                开始周
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={firstWeek}
                  onChange={(e) => setFirstWeek(Number(e.target.value))}
                />
              </label>
              <label>
                结束周
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={lastWeek}
                  onChange={(e) => setLastWeek(Number(e.target.value))}
                />
              </label>
            </div>
            <Button
              disabled={
                !part ||
                weekday < 1 ||
                weekday > 7 ||
                start < 1 ||
                end > 13 ||
                end < start ||
                firstWeek < 1 ||
                lastWeek > 60 ||
                lastWeek < firstWeek
              }
              onClick={() =>
                change((next) =>
                  scoped(next).hardConstraints.push({
                    id: `rule-${crypto.randomUUID()}`,
                    kind: "blocked_time",
                    slot: {
                      partId: part,
                      weekday,
                      startPeriod: start,
                      endPeriod: end,
                      weeks: Array.from(
                        { length: lastWeek - firstWeek + 1 },
                        (_, i) => i + firstWeek,
                      ),
                    },
                  }),
                )
              }
            >
              添加时段约束
            </Button>
          </details>
          <label className="form-label">
            自然语言偏好
            <textarea
              aria-label="自然语言偏好"
              maxLength={4000}
              rows={4}
              value={profile.note}
              placeholder="例如：尽量不要早八；周三下午必须空出。"
              onChange={(e) => {
                change((next) => {
                  next.note = e.target.value;
                  next.textConfirmed = false;
                });
                setInterpretation(null);
              }}
            />
          </label>
          <Button
            disabled={working || !profile.note.trim()}
            onClick={() =>
              void operation(async () => {
                if (api instanceof HttpWorkspace && !api.modelConfigured) {
                  useUi.getState().set({ modelSettingsOpen: true });
                  return;
                }
                const saved = await save(false);
                const interpreted = await api.interpretPreferences({
                  plan: { planId: saved.id, expectedRevision: saved.revision },
                  endpointId:
                    api instanceof HttpWorkspace
                      ? api.modelEndpointId
                      : "default",
                });
                setInterpretation(interpreted);
                if (interpreted.output.unresolvedClauses.length)
                  change((next) => {
                    next.unresolvedClauses =
                      interpreted.output.unresolvedClauses;
                  });
              })
            }
          >
            解析偏好
          </Button>
          {interpretation && (
            <div className="notice">
              <p>{interpretation.output.explanation}</p>
              <p>建议仅供编辑；添加到上方后才会随确认保存。</p>
              {interpretation.output.suggestedHardConstraints.map((rule) => (
                <Button
                  key={rule.id}
                  onClick={() =>
                    change((next) => {
                      if (!next.hardConstraints.some((r) => r.id === rule.id))
                        next.hardConstraints.push(rule);
                    })
                  }
                >
                  添加建议：{ruleText(rule)}
                </Button>
              ))}
              {interpretation.output.suggestedCriteria.map((key) => (
                <Button
                  key={key}
                  onClick={() =>
                    change((next) => {
                      if (!next.orderedCriteria.includes(key))
                        next.orderedCriteria.push(key);
                    })
                  }
                >
                  添加软偏好：{criteria[key]}
                </Button>
              ))}
              {interpretation.output.unresolvedClauses.length > 0 && (
                <Button
                  onClick={() =>
                    change((next) => {
                      next.unresolvedClauses =
                        interpretation.output.unresolvedClauses;
                    })
                  }
                >
                  保留未决条款待处理
                </Button>
              )}
            </div>
          )}
          <label className="form-label">
            未决条款（每行一条；解决后移除）
            <textarea
              aria-label="未决条款"
              value={profile.unresolvedClauses.join("\n")}
              onChange={(e) =>
                change((next) => {
                  next.unresolvedClauses = e.target.value
                    .split("\n")
                    .filter((s) => s.trim());
                })
              }
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            我已确认上方硬约束与偏好；其余原文只作为软偏好，不隐含硬性筛选。
          </label>
          <div className="toolbar-actions">
            <Button
              className="primary-button"
              disabled={working || !ack || profile.unresolvedClauses.length > 0}
              onClick={() =>
                void operation(async () => {
                  await save(true);
                  setOpen(false);
                })
              }
            >
              确认并保存偏好
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </section>
  );
}
