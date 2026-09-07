import { useRef, useState } from "react";
import { Onboarding } from "./Onboarding.js";
import { Button, Modal } from "./ui.js";

const NOTICE_KEY = "zju-course-assistant:welcome:v2";
export function Welcome({
  hasSnapshot,
  hasPlan,
}: {
  hasSnapshot: boolean;
  hasPlan: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<"notice" | "guide" | null>(() => {
    try {
      return localStorage.getItem(NOTICE_KEY) === "acknowledged"
        ? null
        : "notice";
    } catch {
      return "notice";
    }
  });
  const finish = () => {
    try {
      localStorage.setItem(NOTICE_KEY, "acknowledged");
    } catch {
      // Storage restrictions must not prevent using the workbench.
    }
    setView(null);
    trigger.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <button
        type="button"
        className="button"
        data-tour="replay"
        ref={trigger}
        onClick={() => setView("guide")}
      >
        新手指引
      </button>
      {view === "notice" && (
        <FirstUseNotice onContinue={() => setView("guide")} />
      )}
      {view === "guide" && (
        <Onboarding
          hasSnapshot={hasSnapshot}
          hasPlan={hasPlan}
          close={finish}
        />
      )}
    </>
  );
}

function FirstUseNotice({ onContinue }: { onContinue: () => void }) {
  return (
    <Modal title="欢迎使用选课工作台" close={() => {}} dismissible={false}>
      <div className="welcome-content">
        <p className="welcome-lede">从探索课程，到确定自己的选择。</p>
        <div>
          <h3>你来决定，也由你填报</h3>
          <p>
            工作台帮助规划、比较与校验。选课、退课和志愿调序需在学校页面自行完成；AI
            建议与校验结果不保证录取，报录比只是报名人数与总余量之比。
          </p>
        </div>
        <div>
          <h3>数据与登录</h3>
          <p>
            规划数据保存在本机。学校登录在独立的官方窗口完成，密码与登录凭据不会交给模型。课程状态以同步时为准，最终填报请核对学校页面。
          </p>
        </div>
        <div>
          <h3>按需使用 AI</h3>
          <p>
            配置并启用模型后，点击 AI
            功能会将所需课程与偏好发送至你选择的服务商。启用外部评价后，工作台会只读查询评价站点；只有点击生成摘要才向模型发送经清理的评论正文。外部评价和模型均可停用。API
            key 只在本次服务运行期间保存，重启后需重新填写。
          </p>
        </div>
        <p className="muted">
          课表汇总学期内的教学安排，备选不计为同时上课。未提供的数据以「—」表示；标有「合成数据」的内容用于演示。
        </p>
        <Button className="primary-button" onClick={onContinue}>
          了解，开始规划
        </Button>
      </div>
    </Modal>
  );
}
