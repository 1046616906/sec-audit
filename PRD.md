# PRD: Sec-Agent-Workspace — 内部 Web 敏感信息扫描与智能审计系统

## 1. 产品概述

**产品名称:** Sec-Agent-Workspace  
**产品类型:** 内部安全工具（Web 应用）  
**核心定位:** 面向内部业务系统的自动化隐私泄漏（PII）扫描与智能审计平台，以自主智能体（Autonomous Agent）形态运行，结合 Playwright 浏览器自动化与大模型 Function Calling，模拟人类安全专家行为，自动发现并判定敏感数据泄漏风险。

---

## 2. 目标用户

- 内部安全工程师
- 渗透测试人员
- 隐私合规审计人员

---

## 3. 核心功能需求

### 3.1 自主智能体扫描引擎

| 功能 | 描述 |
|------|------|
| 双引擎泄漏检测 | Tier 1 高速初筛（Regex）+ Tier 2 AI 语义判定 |
| AI 探索决策 | 读取页面 DOM，通过 Function Calling 自动决定下一步操作 |
| 自动菜单探索 | 识别并展开折叠菜单，遍历所有可访问页面节点 |
| 网络流量拦截 | 静默拦截所有 XHR/JSON 请求，实时分析响应内容 |
| 人机协同认证 | 遇到登录表单时挂起扫描，等待用户输入凭证后自动恢复 |

#### Tier 1 — 高速初筛
- 使用 Playwright `page.on('response')` 常驻拦截所有 XHR/JSON 流量
- 轻量级 Regex 快速捕获带有疑似敏感特征的 JSON 数据包
- 低延迟，不阻塞主扫描流程

#### Tier 2 — AI 智能判定
- 将 Tier 1 筛出的疑似 JSON 片段送入大模型
- AI 结合上下文语义进行真实性判断（剔除误报、识别非结构化隐私）
- 返回结构化漏洞数据，包含：风险等级、字段名、AI 裁决理由、确信度

### 3.2 三栏沉浸式交互界面

#### 左栏（20%）— 任务树与遥测面板
- **Sitemap 树状图:** 动态展示目标站点页面结构，实时勾选 Agent 已探索节点
- **Agent 遥测面板:** 极客风状态指示灯，实时高亮当前 Agent 工作焦点
  - `[AI DOM Parsing]` — AI 正在解析页面结构
  - `[Auto-Login Detection]` — 检测到登录表单
  - `[Deep Intercepting]` — 深度拦截网络流量
  - 高亮时伴随呼吸动画（Framer Motion）

#### 中栏（50%）— Agent 执行时间线
- 纵向 Timeline 展示 Agent 每一步思考与操作日志
- 日志格式：`[时间戳] [动作标签] 操作描述...`（Monospace 字体）
- 新增日志使用 Framer Motion `slide-up` 动画滑入
- 容器支持平滑自动滚动至最新日志
- 异常日志以红色样式展示，不导致系统崩溃

#### 右栏（30%）— AI 风险裁决流
- Terminal 瀑布流风格输出
- 每张风险卡片包含：
  - 风险等级标签（Critical / High / Medium / Low）
  - 拦截的接口 URL
  - AI 确信度进度条
  - AI Reasoning（裁决理由，例如："判定该字段为明文密码，且未脱敏"）
  - 发光边框（Glow Effect），颜色由风险等级决定

#### 悬浮实况窗（全局右下角）
- 基于 Framer Motion `drag` 属性的画中画（PiP）窗口
- 极致毛玻璃效果（`backdrop-blur-xl` + 半透明黑底）
- macOS 风格红黄绿控制按钮（支持折叠/展开）
- 支持屏幕范围内任意拖拽，带惯性回弹
- 内容：Playwright 通过 SSE 周期性传回的实时 Base64 截屏画面帧

### 3.4 验证码处理策略（Captcha Handling）

自动化扫描遭遇验证码时，采用三级分层处理机制：

#### 验证码类型识别

| 类型 | 识别特征 | 处理级别 |
|------|----------|---------|
| 图形验证码（image） | `img[src*="captcha"]`、`canvas` 元素 | Tier A — 自动 |
| 滑块验证码（slider） | `.slide-verify`、`.el-slider` 等滑块容器 | Tier B — 半自动 |
| 短信验证码（sms） | 手机号输入框 + 验证码输入框 | Tier C — 人工 |
| 邮箱验证码（email） | 邮箱输入框 + 验证码输入框 | Tier C — 人工 |
| 未知（unknown） | 存在验证码输入框但无法分类 | Tier C — 人工 |

#### Tier A — 自动处理（图形验证码）

1. 截取验证码元素区域截图（`page.locator(selector).screenshot()`）
2. 调用 AI Vision API 识别文字（prompt: "识别图中验证码字符，只返回字符本身"）
3. 自动填入输入框并提交
4. 检测错误提示，失败则重试，最多 3 次

#### Tier B — 半自动（滑块验证码）

- 使用 `page.mouse` 模拟人类拖拽轨迹：
  - 分 10+ 个小步增量移动（非线性速度）
  - 每步随机 ±2px Y 轴抖动
  - 随机微延迟模拟人手抖动
- 成功后自动继续扫描，无需人工介入
- 失败则降级为 Tier C

#### Tier C — 人工介入（短信 / 邮箱 / 未知验证码）

```
Agent 检测到验证码
    → 发布 AUTH_REQUIRED 事件（含 captchaType、captchaImageBase64）
    → 前端 AuthModal 根据 captchaType 显示对应 UI：
        image  → 展示验证码截图 + 手动输入框
        sms    → 提示"请查收短信" + 验证码输入框
        email  → 提示"请查收邮件" + 验证码输入框
        slider → 显示"正在自动处理滑块..."动画（无需输入）
    → 用户提交验证码，POST /api/worker/resume（含 captchaCode）
    → Agent 填入验证码，继续登录流程
```

#### AUTH_REQUIRED 事件扩展

```typescript
type CaptchaType = 'image' | 'slider' | 'sms' | 'email' | 'unknown';

type AuthRequiredEvent = {
  pageUrl: string;
  captchaType: CaptchaType;
  captchaImageBase64?: string; // 图形验证码截图，仅 image 类型携带
};
```

---

### 3.3 人机协同认证流程

```
Agent 检测到登录表单
    → 挂起扫描队列（BullMQ job pause）
    → SSE 推送 AUTH_REQUIRED 事件至前端
    → 中栏飘红提示，中央弹出凭证输入 Modal（shadcn/ui）
    → 用户输入凭证，POST /api/worker/resume
    → Agent 接收凭证，执行 page.fill() 自动登录
    → 恢复扫描状态
```

---

## 4. 技术架构

### 4.1 技术栈

| 层级 | 技术选型 |
|------|---------|
| 框架 | Next.js 14+（App Router）、React 18、TypeScript |
| UI | Tailwind CSS、shadcn/ui、Lucide Icons |
| 动画 | Framer Motion |
| 状态管理 | Zustand |
| 扫描引擎 | Playwright（独立 Node Worker） |
| AI 引擎 | Vercel AI SDK（Function Calling） |
| 任务队列 | BullMQ + ioredis |
| 实时通信 | Server-Sent Events（SSE） |
| 数据库 | Prisma + SQLite |

### 4.2 架构边界（严格约束）

- **前端（Client Components）:** 仅负责动画渲染与用户交互，**严禁** import `playwright`、`bullmq` 等 Node.js 原生模块
- **Server API（Next.js Route Handlers）:** 负责中转 SSE 事件、接收用户指令
- **BullMQ Worker（独立进程）:** 负责运行 Playwright，与 Next.js 主服务完全异步解耦

### 4.3 数据流

```
用户输入目标 URL
    → Next.js API 创建 BullMQ Job
    → Worker 启动 Playwright，开始扫描
    → Worker 通过 Redis Pub/Sub 推送事件
    → SSE API 路由订阅并转发至前端
    → 前端 Zustand store 更新，触发 UI 渲染
```

### 4.4 Zustand Store 状态定义

| 状态字段 | 类型 | 描述 |
|---------|------|------|
| `logs` | `LogEntry[]` | 中栏时间线日志列表 |
| `risks` | `RiskEntry[]` | 右栏风险裁决卡片列表 |
| `liveFrame` | `string` | 悬浮窗 Base64 截图帧 |
| `telemetry_status` | `TelemetryStatus` | 左栏遥测指示灯状态 |
| `sitemapNodes` | `SitemapNode[]` | 左栏 Sitemap 树节点 |
| `scanStatus` | `ScanStatus` | 当前扫描状态（idle/running/paused/done） |

---

## 5. 数据模型（Prisma）

### ScanTask
```
id          String   @id
targetUrl   String
status      String   // idle | running | paused | completed | failed
createdAt   DateTime
updatedAt   DateTime
```

### Vulnerability
```
id          String   @id
taskId      String
url         String
field       String
riskLevel   String   // critical | high | medium | low
reasoning   String
confidence  Float
rawData     String
createdAt   DateTime
```

---

## 6. API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/scan/start` | 创建并启动扫描任务 |
| POST | `/api/scan/stop` | 停止当前扫描 |
| POST | `/api/worker/resume` | 提交凭证，恢复挂起的扫描 |
| GET  | `/api/events` | SSE 事件流（日志、截图、风险告警） |
| GET  | `/api/scan/results` | 获取历史扫描结果 |

### SSE 事件类型

| 事件名 | 数据结构 | 描述 |
|--------|---------|------|
| `LOG` | `{ timestamp, level, tag, message }` | 执行日志 |
| `RISK` | `{ url, field, riskLevel, reasoning, confidence }` | 风险告警 |
| `FRAME` | `{ base64 }` | 实时截图帧 |
| `AUTH_REQUIRED` | `{ pageUrl }` | 需要用户登录 |
| `TELEMETRY` | `{ capability, active }` | 遥测状态更新 |
| `SITEMAP` | `{ node, explored }` | Sitemap 节点更新 |
| `SCAN_DONE` | `{ summary }` | 扫描完成 |

---

## 7. UI/UX 设计规范

- **主题:** 全屏深色模式，zinc/slate 色系
- **风格:** Cyber/Hacker 极客美学，macOS 精致感融合
- **玻璃效果:** `backdrop-blur-xl` + 半透明背景，大量使用于卡片、面板、悬浮窗
- **动画:** 所有状态变化使用 Framer Motion，禁止用纯 CSS transition 替代
- **字体:** 日志区域使用 Monospace 字体
- **风险颜色:**
  - Critical: 红色发光 `#ff4444`
  - High: 橙色发光 `#ff8800`
  - Medium: 黄色发光 `#ffcc00`
  - Low: 蓝色发光 `#4488ff`

---

## 8. 实现阶段规划

### Phase 1 — 基础设施与全局状态
- 初始化 Next.js App Router + Tailwind + shadcn/ui
- 配置 Prisma 数据库表结构（ScanTask、Vulnerability）
- 建立 Zustand store，定义所有状态字段与 actions

### Phase 2 — 极客风 UI 骨架
- 实现三栏布局（左 20% / 中 50% / 右 30%）
- 开发 `ExecutionTimeline` 组件（平滑滚动 + slide-up 动画）
- 开发 `DraggableLiveView` 组件（毛玻璃 + 拖拽惯性）
- 开发 `RiskJudgmentFeed` 组件（瀑布流 + 发光卡片）
- 开发 `AgentTelemetry` 组件（呼吸动画指示灯）
- 使用 Mock 数据联调所有动画效果

### Phase 3 — Worker 队列与通信管道
- 配置独立 Node Worker（BullMQ + Redis）
- 实现 SSE API 路由（`/api/events`）
- 打通 Worker → Redis → SSE → 前端 Zustand 的完整数据链路
- 验证日志推送至中栏、截图推送至悬浮窗

### Phase 4 — Agent 探索决策与人机闭环
- 接入 Vercel AI SDK，实现 DOM 读取 + Function Calling
- 实现 `explore_menu` 等 Agent Tools
- 实现完整人机协同认证闭环（挂起 → 弹窗 → 恢复 → 自动登录）
- 联调左栏遥测指示灯与 Agent 能力状态同步

### Phase 6 — 验证码处理

- 创建 `worker/captcha.ts`：验证码检测与分层处理模块（Tier A/B/C）
- 扩展 `AUTH_REQUIRED` 事件：新增 `captchaType`、`captchaImageBase64` 字段
- 扩展 `/api/worker/resume`：支持接收 `captchaCode`
- 扩展前端 `AuthModal`：根据验证码类型渲染对应交互 UI
- 将验证码模块接入 `worker/agent.ts` 的认证流程
- 实现 Playwright `page.on('response')` Tier 1 初筛逻辑
- 实现 Tier 2 大模型语义判定，输出结构化漏洞数据
- 将告警推送至右栏风险裁决流
- 持久化漏洞数据至 Prisma SQLite

---

## 9. 非功能性需求

| 需求 | 要求 |
|------|------|
| 健壮性 | Playwright 和 AI 请求必须包裹 try-catch，异常以红色 Error Log 推送前端，不崩溃 |
| 类型安全 | 严格 TypeScript，禁止使用 `any`，`pnpm check:types` 必须通过 |
| 架构隔离 | 前端 Client Components 严禁引入 Node.js 原生模块 |
| 响应式 | 所有组件支持响应式设计 |
| 代码风格 | 通过 `pnpm lint` 检查 |

---

## 10. 验证命令

```bash
pnpm dev          # 启动前端开发服务器
pnpm check:types  # TypeScript 类型检查（重构后必须执行）
pnpm lint         # ESLint 代码规范检查
pnpx prisma db push  # 推送数据库 Schema
```
