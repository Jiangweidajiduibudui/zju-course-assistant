# ZJU Course Assistant

本机运行的浙大选课规划工作台：查看课程、整理教学班候选、投影课表、校验志愿草稿，并可使用自己配置的模型生成评价摘要和课表建议。实际选课、退课与志愿调序需在学校页面自行完成。

## 两个独立运行包

[下载 v0.1.0-rc.2 预发布包](https://github.com/Jiangweidajiduibudui/zju-course-assistant/releases/tag/v0.1.0-rc.2)。在 Assets 中选择下列对应平台的运行包；Source code 为源码，不是可直接运行的程序。

- **纯 Windows x64**：解压 ZIP，双击 **Start.cmd**。不需要 WSL。
- **WSL2 x64**：在 WSL2 内解压 tar.gz，执行 **`./start.sh`**；在 Windows 浏览器查看页面，学校登录窗口使用 WSLg。

两个包各自附带 Node.js、Chromium 和运行依赖，不需要 Conda 或开发工具。运行中的窗口或终端需保持开启；程序只监听 `127.0.0.1:4317`。

首次启动为空白工作区，确认使用说明后会逐步高亮页面上的按钮与区域，提示实际操作；可跳过，并随时从顶部「新手指引」重新查看。通过“连接教务”完成学校登录和同步，再新建计划；需要 AI 时在“模型设置”填写自己的端点、模型与 API key。外部评价需主动启用，摘要只在手动点击生成时调用模型。

Windows 数据存放在 `%LOCALAPPDATA%\ZJUCourseAssistant`，WSL2 数据存放在 `~/.local/share/zju-course-assistant/data`，均与程序目录分开。API key 只在进程内存中保存，重启后需重新填写。备份、导入和清理入口位于“本机数据与备份”。详见包内使用说明。

## 功能与边界

- 多计划、候选顺序、课表投影、志愿校验和手工填写清单。
- 独立 CAS 登录窗口、学校只读同步、更新对账与本机备份。
- 外部教师评价、同名确认、按课程匹配均绩，以及手动 AI 摘要和缓存。
- AI 在用户候选范围内提出教学班方案；通过确定性校验后可另存为独立计划。
- 未提供的时间、状态等保持未知；数据不足可能阻止采用方案。录取概率不可评估，产品不保证录取。

## 从源码开发

固定 Node **22.23.2**、pnpm **10.33.2**：

```sh
pnpm install --frozen-lockfile
pnpm browser:install
pnpm build
pnpm start
```

原 WSL 开发环境使用 `scripts/in-env pnpm <command>`。完整环境、架构约束、回归检查及发布步骤见 [MAINTAINING.md](MAINTAINING.md)。源码保留可维护的合成测试；发布运行包不含测试、演示数据或开发过程文档。

当前版本 **0.1.0-rc.2**，以预发布包提供。原始项目代码尚未授予开源许可。
