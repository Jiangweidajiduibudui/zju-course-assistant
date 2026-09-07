import { useRef, useState } from "react";
import type { z } from "zod";
import type { SectionData } from "../../shared/contracts/catalog.js";
import type { SummaryRecord } from "../../shared/contracts/llm.js";
import type { Settings } from "../../shared/contracts/operations.js";
import type {
  Comment,
  Review,
  TeacherMatch,
} from "../../shared/contracts/reviews.js";
import { useWorkspace } from "../data/context.js";
import { HttpError, HttpWorkspace } from "../data/http.js";
import { useUi } from "../ui-store.js";
import { Button, Modal } from "./ui.js";

type Match = z.infer<typeof TeacherMatch>;
type ReviewData = z.infer<typeof Review>;
export function ReviewSummary({
  section,
  snapshotId,
}: {
  section: SectionData;
  snapshotId: string;
}) {
  const { api } = useWorkspace();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        disabled={!(api instanceof HttpWorkspace)}
        title={api instanceof HttpWorkspace ? undefined : "请在本机服务中使用"}
        onClick={() => setOpen(true)}
      >
        AI 评价摘要
      </Button>
      {open && api instanceof HttpWorkspace && (
        <ReviewDialog
          api={api}
          section={section}
          snapshotId={snapshotId}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ReviewDialog({
  api,
  section,
  snapshotId,
  close,
}: {
  api: HttpWorkspace;
  section: SectionData;
  snapshotId: string;
  close: () => void;
}) {
  const ui = useUi();
  const teachers =
    section.teachers.state === "known" ? section.teachers.value : [];
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? "");
  const [sourceId, setSourceId] = useState<"primary" | "fallback">("primary");
  const [settings, setSettings] = useState<z.infer<typeof Settings> | null>(
    null,
  );
  const [match, setMatch] = useState<Match | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [summary, setSummary] = useState<z.infer<typeof SummaryRecord> | null>(
    null,
  );
  const courseGrade =
    review?.courseGradeMatch.status === "matched"
      ? review.courseGrades.find(
          (grade) =>
            review.courseGradeMatch.status === "matched" &&
            grade.id === review.courseGradeMatch.externalCourseId,
        )
      : undefined;
  const [comments, setComments] = useState<z.infer<typeof Comment>[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [switchRequired, setSwitchRequired] = useState(false);
  const epoch = useRef(0);
  const summaryKey = useRef({ fingerprint: "", value: crypto.randomUUID() });
  const run = async (work: (generation: number) => Promise<void>) => {
    const generation = ++epoch.current;
    setBusy(true);
    setMessage("");
    setSwitchRequired(false);
    try {
      await work(generation);
    } catch (e) {
      if (epoch.current === generation) {
        setMessage(e instanceof Error ? e.message : "加载失败，请重试。");
        if (
          e instanceof HttpError &&
          [
            "UPSTREAM_UNAVAILABLE",
            "UPSTREAM_SCHEMA_CHANGED",
            "ENDPOINT_REJECTED",
          ].includes(e.code)
        )
          setSwitchRequired(true);
      }
    } finally {
      if (epoch.current === generation) setBusy(false);
    }
  };
  const showReview = async (
    data: ReviewData,
    config: z.infer<typeof Settings>,
    generation: number,
  ) => {
    if (epoch.current !== generation) return;
    setReview(data);
    setSummary(null);
    setComments([]);
    setCursor(null);
    setShowComments(false);
    const endpoint = config.content.endpoints[0];
    if (!endpoint) return;
    try {
      const cached = await api.request(
        "getSummary",
        { reviewId: data.id },
        { expectedRevision: String(data.revision), endpointId: endpoint.id },
      );
      if (epoch.current === generation) setSummary(cached);
    } catch (e) {
      if (!(e instanceof HttpError && e.code === "NOT_FOUND")) throw e;
    }
  };
  const fetchReview = async (
    selected: Match,
    config: z.infer<typeof Settings>,
    refresh: boolean,
    generation: number,
  ) => {
    const result = await api.request(
      "fetchReview",
      {},
      {},
      {
        snapshotId,
        courseId: section.courseId,
        matchId: selected.id,
        matchRevision: selected.revision,
        sourceId: selected.sourceId,
        refresh,
      },
    );
    if (epoch.current !== generation) return;
    if (result.status === "available")
      await showReview(result.review, config, generation);
    else if (result.status === "source_switch_required") {
      if (result.cachedReview)
        await showReview(result.cachedReview, config, generation);
      setMessage(result.cause.message);
      setSwitchRequired(true);
    } else setMessage("这位教师暂无评价。");
  };
  const load = (source = sourceId, teacher = teacherId) =>
    run(async (generation) => {
      setReview(null);
      setMatch(null);
      setSummary(null);
      setComments([]);
      setShowComments(false);
      const config = await api.request("getSettings");
      setSettings(config);
      if (!config.content.reviewsEnabled || !teacher) return;
      const result = await api.request(
        "lookupReviewMatch",
        {},
        {},
        { snapshotId, teacherId: teacher, sourceId: source },
      );
      if (epoch.current !== generation) return;
      setMatch(result);
      if (result.state.status === "matched")
        await fetchReview(result, config, false, generation);
    });
  // Each opening starts one explicit read; React effects are intentionally not
  // used to charge for a model call. Model generation exists only in its button.
  const initialized = useRef(false);
  const initialize = () => {
    if (initialized.current) return;
    initialized.current = true;
    void load();
  };
  const closeDialog = () => {
    epoch.current++;
    close();
  };
  return (
    <Modal title="教师评价与摘要" close={closeDialog} onOpen={initialize}>
      <div className="review-controls">
        <label className="form-label">
          授课教师
          <select
            aria-label="评价教师"
            value={teacherId}
            disabled={busy}
            onChange={(e) => {
              setTeacherId(e.target.value);
              void load(sourceId, e.target.value);
            }}
          >
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          评价来源
          <select
            aria-label="评价来源"
            value={sourceId}
            disabled={busy}
            onChange={(e) => {
              const source =
                e.target.value === "fallback" ? "fallback" : "primary";
              setSourceId(source);
              void load(source);
            }}
          >
            <option value="primary">主站</option>
            <option value="fallback">备用站</option>
          </select>
        </label>
      </div>
      {!teachers.length && <p>尚无授课教师信息。</p>}
      {settings && !settings.content.reviewsEnabled && (
        <div className="review-empty">
          <p>连接查老师，查看授课评价。</p>
          <Button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const current = await api.request("getSettings");
                await api.request(
                  "updateSettings",
                  {},
                  {},
                  {
                    expectedRevision: current.revision,
                    content: {
                      ...current.content,
                      reviewsEnabled: true,
                      endpoints: current.content.endpoints.map(
                        ({ id, label, baseUrl, model }) => ({
                          id,
                          label,
                          baseUrl,
                          model,
                        }),
                      ),
                    },
                  },
                );
                await load();
              })
            }
          >
            启用外部评价
          </Button>
        </div>
      )}
      {settings?.content.reviewsEnabled && (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async (generation) => {
              const current = await api.request("getSettings");
              const next = await api.request(
                "updateSettings",
                {},
                {},
                {
                  expectedRevision: current.revision,
                  content: {
                    ...current.content,
                    reviewsEnabled: false,
                    endpoints: current.content.endpoints.map(
                      ({ id, label, baseUrl, model }) => ({
                        id,
                        label,
                        baseUrl,
                        model,
                      }),
                    ),
                  },
                },
              );
              if (epoch.current === generation) {
                setSettings(next);
                setReview(null);
                setMatch(null);
                setSummary(null);
                setComments([]);
              }
            })
          }
        >
          停用外部评价
        </Button>
      )}
      {busy && (
        <p role="status" className="muted">
          正在处理…
        </p>
      )}
      {message && (
        <div role="status" className="notice">
          <p>{message}</p>
          <div className="toolbar-actions">
            <Button disabled={busy} onClick={() => void load()}>
              重试加载
            </Button>
            {switchRequired && (
              <Button
                disabled={busy}
                onClick={() => {
                  const next = sourceId === "primary" ? "fallback" : "primary";
                  setSourceId(next);
                  void load(next);
                }}
              >
                切换至{sourceId === "primary" ? "备用站" : "主站"}
              </Button>
            )}
          </div>
        </div>
      )}
      {match?.state.status === "unmatched" && <p>{match.state.reason}</p>}
      {match?.state.status === "needs_confirmation" && (
        <div className="review-matches">
          <h3>确认对应教师</h3>
          {match.state.candidates.map((candidate) => (
            <div key={candidate.id} className="review-match">
              <div>
                <strong>{candidate.name}</strong>
                <p className="muted">
                  {candidate.college.state === "known"
                    ? candidate.college.value
                    : "学院未提供"}
                </p>
                <a href={candidate.source.url} target="_blank" rel="noreferrer">
                  查看教师原页 ↗
                </a>
              </div>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async (generation) => {
                    if (!settings) return;
                    const confirmed = await api.request(
                      "confirmReviewMatch",
                      { matchId: match.id },
                      {},
                      {
                        expectedRevision: match.revision,
                        externalTeacherId: candidate.id,
                      },
                    );
                    if (epoch.current !== generation) return;
                    setMatch(confirmed);
                    await fetchReview(confirmed, settings, false, generation);
                  })
                }
              >
                选择这位教师
              </Button>
            </div>
          ))}
        </div>
      )}
      {review && (
        <div className="review-content">
          <div className="review-source">
            <a href={review.source.url} target="_blank" rel="noreferrer">
              查看原页 ↗
            </a>
            <span>
              {review.sourceId === "primary" ? "主站" : "备用站"} ·{" "}
              {new Date(review.fetchedAt).toLocaleDateString("zh-CN")}
              {review.cacheState === "stale" ? " · 缓存" : ""}
              {review.synthetic ? " · 合成数据" : ""}
            </span>
          </div>
          {review.teacherRating.state === "known" ? (
            <p>
              教师评分 {review.teacherRating.value.value} /{" "}
              {review.teacherRating.value.maximum}
            </p>
          ) : review.teacherRating.state === "unknown" &&
            review.teacherRating.displayText ? (
            <p>原站评分 {review.teacherRating.displayText}</p>
          ) : null}
          <p>
            {courseGrade
              ? `本课程均绩：${courseGrade.average.state === "known" ? courseGrade.average.value.value : courseGrade.average.state === "unknown" ? (courseGrade.average.displayText ?? "暂未提供") : "不适用"}`
              : "暂无可靠匹配的本课程均绩"}
          </p>
          <div className="toolbar-actions">
            <Button
              className="primary-button"
              disabled={
                busy ||
                Boolean(summary) ||
                (review.availableCommentCount.state === "known" &&
                  review.availableCommentCount.value === 0)
              }
              onClick={() =>
                void run(async (generation) => {
                  const current = await api.request("getSettings");
                  setSettings(current);
                  const endpoint = current.content.endpoints[0];
                  if (
                    !current.content.llmEnabled ||
                    !endpoint ||
                    !(
                      await api.request("getCredentialStatus", {
                        endpointId: endpoint.id,
                      })
                    ).configured
                  ) {
                    closeDialog();
                    ui.set({ modelSettingsOpen: true });
                    return;
                  }
                  const body = {
                    reviewId: review.id,
                    expectedReviewRevision: review.revision,
                    endpointId: endpoint.id,
                  };
                  const fingerprint = JSON.stringify({
                    body,
                    endpointRevision: endpoint.revision,
                  });
                  if (summaryKey.current.fingerprint !== fingerprint)
                    summaryKey.current = {
                      fingerprint,
                      value: crypto.randomUUID(),
                    };
                  const result = await api.request(
                    "summarizeComments",
                    {},
                    {},
                    body,
                    summaryKey.current.value,
                  );
                  if (epoch.current === generation) setSummary(result);
                })
              }
            >
              {summary ? "已生成摘要" : "生成 AI 摘要"}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async (generation) => {
                  if (match && settings)
                    await fetchReview(match, settings, true, generation);
                })
              }
            >
              刷新评价
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async (generation) => {
                  const data = await api.request(
                    "listComments",
                    { reviewId: review.id },
                    { expectedRevision: String(review.revision), limit: "20" },
                  );
                  if (epoch.current === generation) {
                    setComments(data.items);
                    setCursor(data.nextCursor);
                    setShowComments(true);
                  }
                })
              }
            >
              查看评论
              {review.availableCommentCount.state === "known"
                ? ` · ${review.availableCommentCount.value}`
                : ""}
            </Button>
          </div>
          {review.availableCommentCount.state === "known" &&
            review.availableCommentCount.value === 0 && (
              <p className="muted">暂无评论可供摘要。</p>
            )}
          {summary && (
            <section className="ai-review-summary" aria-label="AI 评价摘要结果">
              <div className="section-heading">
                <h3>评价摘要</h3>
                <span className="tag">
                  {summary.output.sampleSize} 条评论
                  {summary.output.lowSample ? " · 样本较少" : ""}
                </span>
              </div>
              <div className="review-summary-grid">
                <div>
                  <h4>评价中的优点</h4>
                  {summary.output.pros.length ? (
                    <ul>
                      {[...new Set(summary.output.pros)].map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>暂无明确描述。</p>
                  )}
                </div>
                <div>
                  <h4>评价中的不足</h4>
                  {summary.output.cons.length ? (
                    <ul>
                      {[...new Set(summary.output.cons)].map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>暂无明确描述。</p>
                  )}
                </div>
              </div>
              <h4>点名与出勤</h4>
              <p>{summary.output.attendance.text}</p>
            </section>
          )}
          {showComments && (
            <section className="review-comments" aria-label="教师评论">
              {comments.map((comment) => (
                <p key={comment.id}>{comment.text}</p>
              ))}
              {cursor && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async (generation) => {
                      const data = await api.request(
                        "listComments",
                        { reviewId: review.id },
                        {
                          expectedRevision: String(review.revision),
                          limit: "20",
                          cursor,
                        },
                      );
                      if (epoch.current === generation) {
                        setComments((old) => [...old, ...data.items]);
                        setCursor(data.nextCursor);
                      }
                    })
                  }
                >
                  更多评论
                </Button>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
