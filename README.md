<div align="center">

# 🚀 Antigravity UI

**面向 Google Antigravity / Gemini 反向代理的现代化多账号可视化控制台**

[English](./README_EN.md) | **简体中文**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun%20%E2%89%A51.3-orange.svg)](https://bun.sh)
[![React](https://img.shields.io/badge/Frontend-React%2019-61dafb.svg)](https://react.dev/)
[![Hono](https://img.shields.io/badge/Backend-Hono%20v4-E36002.svg)](https://hono.dev/)
[![TailwindCSS](https://img.shields.io/badge/Styling-Tailwind%20CSS%20v4-38bdf8.svg)](https://tailwindcss.com/)

</div>

---

## 📖 项目简介

**Antigravity UI** 是专为 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) / Google Antigravity 反代网关打造的轻量级、响应式本地 Web 可视化管理面板。

彻底告别手动修改复杂 YAML / JSON 配置与命令行维护的繁琐流程，提供开箱即用的多账号池化管理、OAuth 授权、模型别名映射、请求路由加权、可用性健康检测以及类似 API 中转站的 Token 消耗与美元成本可视化图表。

---

## ✨ 核心特性

- 👥 **多账号可视化管理**：一键发起 Google OAuth 授权添加新账号，支持账号热启用/禁用、永久删除与配额状态重置。
- 🔄 **智能模型映射 (Alias)**：图形化编辑 `claude` / `codex` / `openai` / `gemini` 多通道模型别名，无缝将客户端请求映射到底层真实的 Gemini 上游模型（如 `gemini-3.7-flash-high`）。
- 🔀 **多策略动态路由与加权**：支持**轮询 (Round-Robin)**、**加权轮询 (Weighted)** 和**主备填充 (Fill-First)**，可视化滑块调节每个账号的权重分配。
- ⚡ **可用性与凭证健康探测**：
  - **账号凭证级探测**：精准检测指定账号的 OAuth Token 有效期与 Google 认证状态；
  - **模型级全链路测试**：向反代网关发送真实探针请求，实时返回耗时、状态与回复内容。
- 📊 **中转站风格用量与成本图表**：
  - 基于 SQLite 持续消费用量队列，持久化记录每次调用的输入/输出/推理 Token 及耗时；
  - 环形分布图（模型成本占比）、柱状图（模型调用次数排行）与明细表格；
  - 内置最新 **Gemini 3 系列官方定价**（支持 $0.75/$3.75 换算），实时估算美元消耗。
- 📋 **客户端配置一键生成**：一键复制适配 **Claude Code**、**Codex CLI**、**DeepSeek Harness (DSH)**、**Pi Agent (pi.dev)**、**OpenCode.app** 及标准 **OpenAI 兼容 SDK** 的接入配置。
- 📡 **SSE 实时状态推送**：基于 Server-Sent Events 实现账号状态与用量快照自动刷新。
- 🎨 **极简深色主题**：基于 Tailwind CSS v4 + Lucide Icons 构建，原生暗黑风格，极速响应。

---

## 🏗️ 系统架构

```
┌──────────────────────────────────────────────────────────┐
│             React 19 Web UI (localhost:4321)             │
│   总览 · 账号管理 · 模型映射 · 路由策略 · 可用性 · 用量 · 客户端   │
└────────────────────────────┬─────────────────────────────┘
                             │ HTTP REST / SSE Events
┌────────────────────────────▼─────────────────────────────┐
│               Bun + Hono 后端 (localhost:4310)            │
│   - 管理密钥安全隔离（不泄露到前端）                         │
│   - SQLite 本地用量统计与成本计算引擎                      │
│   - OAuth 授权流程编排与状态轮询                            │
│   - CLIProxyAPI Management API 安全代理                  │
└────────────────────────────┬─────────────────────────────┘
                             │ Management API (Bearer Token)
┌────────────────────────────▼─────────────────────────────┐
│          CLIProxyAPI 反代网关 (127.0.0.1:8317)            │
│   - OpenAI / Anthropic / Codex / Gemini 协议转换         │
│   - 多账号凭据池 (auth-dir) 自动续期与请求路由               │
└────────────────────────────┬─────────────────────────────┘
                             │ Google Cloud Code API (OAuth2)
┌────────────────────────────▼─────────────────────────────┐
│           Google Antigravity / Gemini 云端服务           │
└──────────────────────────────────────────────────────────┘
```

---

## 🛠️ 技术栈

| 模块 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **运行时** | [Bun](https://bun.sh/) $\ge 1.3$ | 极速 JavaScript/TypeScript 运行时与包管理器 |
| **后端框架** | [Hono](https://hono.dev/) v4 | 轻量、高性能 Web 框架，支持 SSE 与 CORS |
| **嵌入式存储** | `bun:sqlite` | 原生零依赖 SQLite 存储，记录调用历史与用量指标 |
| **前端框架** | [React](https://react.dev/) 19 + [Vite](https://vitejs.dev/) 6 | 现代化 SPA 单页架构 |
| **样式方案** | [Tailwind CSS](https://tailwindcss.com/) v4 | 全新纯 CSS 驱动样式引擎 |
| **数据可视化** | [Recharts](https://recharts.org/) v3 | 响应式 SVG 图表（环形图、柱状图） |
| **路由与图标** | React Router v7 + Lucide React | 经典侧边栏布局与现代化图标库 |

---

## 🚀 快速开始

### 1. 前置准备

- 已安装并启动 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 网关（默认监听 `http://127.0.0.1:8317`）。
- 已安装 **Bun**（若未安装，运行 `curl -fsSL https://bun.sh/install | bash`）。

### 2. 克隆仓库与配置

```bash
git clone https://github.com/PiLaoban2004/antigravity-ui.git
cd antigravity-ui

# 安装项目所有 Workspace 依赖
bun install

# 配置后端环境变量
cp apps/server/.env.example apps/server/.env
```

编辑 `apps/server/.env`，填入你的 CLIProxyAPI 管理密钥：

```ini
ANTI_UI_MGMT_KEY=your_management_secret_key_here
ANTI_UI_PROXY_URL=http://127.0.0.1:8317
ANTI_UI_PORT=4310
ANTI_UI_WEB_ORIGIN=http://127.0.0.1:4321
```

### 3. 一键启动

```bash
chmod +x start.sh
./start.sh
```

启动完成后，打开浏览器访问：👉 **http://127.0.0.1:4321**

---

## 📱 核心功能与页面预览

| 页面 | 路由 | 功能亮点 |
| :--- | :--- | :--- |
| **📊 总览** | `/` | 实时网关健康状态、账号总数、活跃/异常统计、可用模型数及当前路由策略。 |
| **👥 账号管理** | `/accounts` | 账号列表、一键发起 Google OAuth 授权、账号启用/禁用切换、删除及配额状态重置。 |
| **🔄 模型映射** | `/models` | `claude` / `codex` / `openai` / `gemini` 别名映射可视化增删改查。 |
| **🔀 路由策略** | `/routing` | 轮询 / 加权轮询 / 主备填充单选切换，实时调整各账号分配权重。 |
| **⚡ 可用性测试** | `/availability` | 账号 OAuth 凭证有效性独立探测，各模型全链路真实可用性与耗时探针。 |
| **📈 模型用量** | `/usage` | 类似中转站的 Token 统计、成本分布饼图、调用次数排行与调用历史日志。 |
| **📋 客户端配置** | `/clients` | Claude Code / Codex / DSH / Pi / OpenCode / 通用 OpenAI 配置一键复制。 |
| **📜 日志流** | `/logs` | 网关实时请求日志流与错误日志查看。 |
| **⚙️ 设置** | `/settings` | 运行时配置只读查看与安全性提醒。 |

---

## 🔌 客户端快速接入

Antigravity UI 会将 Antigravity 模型包装为标准接口，你可直接将各大 Agent 工具指向本地代理：

### Claude Code (`~/.claude/settings.json`)
```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "PROXY_MANAGED",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8317",
    "ANTHROPIC_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-sonnet-4-6",
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY": "1",
    "API_TIMEOUT_MS": "600000"
  }
}
```

### Pi Agent (`~/.pi/agent/models.json`)
```json
{
  "providers": {
    "antigravity": {
      "baseUrl": "http://127.0.0.1:8317/v1",
      "api": "openai-completions",
      "apiKey": "PROXY_MANAGED",
      "models": [
        {
          "id": "gemini-3.7-flash-high",
          "name": "Gemini 3.7 Flash High",
          "input": ["text", "image"],
          "contextWindow": 1048576
        }
      ]
    }
  }
}
```

### DeepSeek Harness (`~/.dsh/settings.yaml`)
```yaml
llm-pi-ai:
  providers:
    antigravity:
      displayName: Antigravity Gemini
      apiKeyEnv: ANTIGRAVITY_PROXY_KEY
      api: openai-completions
      baseURL: http://127.0.0.1:8317/v1
      models:
        - id: gemini-3.7-flash-high
          name: Gemini 3.7 Flash High
          input: ["text", "image"]
          contextWindow: 1048576
```

---

## ❓ 常见问题 (FAQ)

<details>
<summary><b>Q: 新添加的 Google 账号出现 403 PERMISSION_DENIED / "Verify your account"？</b></summary>
这是 Google 对全新或未激活账号的常见风控保护。请使用该账号登录一次 <a href="https://developers.google.com/gemini-code-assist">Google Gemini Code Assist</a> 或登录 Antigravity IDE 完成首次验证，验证通过后即可恢复正常。
</details>

<details>
<summary><b>Q: 频繁调用出现 429 RESOURCE_EXHAUSTED 或 cooling down？</b></summary>
Google 对免费层账号存在较严格的分钟级与日级配额限制，连续高并发探测会触发网关保护性冷却。建议使用带 Pro 订阅的账号，或在多账号池中添加 2~3 个账号进行轮询分流。
</details>

<details>
<summary><b>Q: 如何修改模型定价换算规则？</b></summary>
可直接在 <code>apps/server/src/index.ts</code> 中的 <code>MODEL_PRICES</code> 字典修改各模型的输入/输出价格（单位：美元 / 1M Tokens）。
</details>

---

## 🔒 安全与免责声明

1. **仅限本地使用**：默认绑定 `127.0.0.1`，管理密钥仅在后端内存与本地 `.env` 中使用，切勿暴露公网。
2. **免责声明**：本项目仅供个人开发、学习与学术研究使用。请严格遵守 Google 官方相关服务条款（Terms of Service），请勿用于高频爬取或商业性滥用。

---

## 📄 开源许可证

本项目基于 [MIT License](./LICENSE) 协议开源。
