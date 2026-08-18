<div align="center">

# 🚀 Antigravity UI

**A Modern Multi-Account Management Dashboard for Google Antigravity / Gemini Reverse Proxies**

**English** | [简体中文](./README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun%20%E2%89%A51.3-orange.svg)](https://bun.sh)
[![React](https://img.shields.io/badge/Frontend-React%2019-61dafb.svg)](https://react.dev/)
[![Hono](https://img.shields.io/badge/Backend-Hono%20v4-E36002.svg)](https://hono.dev/)
[![TailwindCSS](https://img.shields.io/badge/Styling-Tailwind%20CSS%20v4-38bdf8.svg)](https://tailwindcss.com/)

</div>

---

## 📖 Overview

**Antigravity UI** is a lightweight, responsive, and developer-friendly local web management dashboard built specifically for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) and Google Antigravity reverse proxy gateways.

Say goodbye to manually editing complex YAML / JSON configuration files and maintaining CLI processes. Antigravity UI provides out-of-the-box multi-account pool management, one-click OAuth authorization, model alias mapping, weighted dynamic routing, live token & cost analytics, and seamless client integration.

---

## ✨ Key Features

- 👥 **Multi-Account Visual Management**: One-click Google OAuth authorization to add new accounts, real-time enable/disable toggles, deletion, and quota error reset.
- 🔄 **Smart Model Alias Mapping**: Graphically configure model aliases across `claude`, `codex`, `openai`, and `gemini` channels to route client calls directly to upstream Gemini models (e.g., `gemini-3.7-flash-high`).
- 🔀 **Dynamic Multi-Strategy Routing**: Support for **Round-Robin**, **Weighted Round-Robin**, and **Fill-First** routing with interactive weight sliders for each account.
- ⚡ **Availability & Credential Probing**:
  - **Account-Level Probing**: Verify OAuth token validity, scopes, and expiration dates independently per account.
  - **Model-Level Probing**: Send real test payloads through the proxy to inspect round-trip latency, status codes, and outputs.
- 📊 **Relay-Style Usage & Cost Analytics**:
  - Automatically consumes upstream usage queues into local SQLite storage.
  - Interactive cost distribution pie charts and request count bar charts via Recharts.
  - Pre-configured with official **Gemini 3-series API pricing** (e.g., $0.75/$3.75 per 1M tokens) for real-time USD cost estimation.
- 📋 **One-Click Client Configurations**: Instantly copy ready-to-use configuration snippets for **Claude Code**, **Codex CLI**, **DeepSeek Harness (DSH)**, **Pi Agent (pi.dev)**, **OpenCode**, and standard **OpenAI SDKs**.
- 📡 **Live Real-time SSE Stream**: Real-time account status and usage metrics delivered via Server-Sent Events.
- 🎨 **Sleek Dark Theme**: Built on Tailwind CSS v4 + Lucide Icons for a fast, responsive, native dark-mode developer experience.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│             React 19 Web UI (localhost:4321)             │
│   Dashboard · Accounts · Aliases · Routing · Usage · UI  │
└────────────────────────────┬─────────────────────────────┘
                             │ HTTP REST / SSE Events
┌────────────────────────────▼─────────────────────────────┐
│               Bun + Hono Backend (localhost:4310)        │
│   - Secret Key Security Boundary (Hidden from browser)   │
│   - SQLite Usage Storage & Cost Calculation Engine       │
│   - OAuth Orchestration & Polling Flow                   │
│   - CLIProxyAPI Management API Secure Gateway            │
└────────────────────────────┬─────────────────────────────┘
                             │ Management API (Bearer Token)
┌────────────────────────────▼─────────────────────────────┐
│          CLIProxyAPI Gateway (127.0.0.1:8317)            │
│   - Protocol Converter (OpenAI / Anthropic / Codex)      │
│   - Credential Pool (auth-dir) with Auto-Renewal         │
└────────────────────────────┬─────────────────────────────┘
                             │ Google Cloud Code API (OAuth2)
┌────────────────────────────▼─────────────────────────────┐
│           Google Antigravity / Gemini Cloud Services     │
└──────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Runtime** | [Bun](https://bun.sh/) $\ge 1.3$ | Ultra-fast JavaScript/TypeScript runtime & package manager |
| **Backend** | [Hono](https://hono.dev/) v4 | Ultra-lightweight, high-performance web framework |
| **Storage** | `bun:sqlite` | Native zero-dependency SQLite engine for local metrics |
| **Frontend** | [React](https://react.dev/) 19 + [Vite](https://vitejs.dev/) 6 | Modern Single-Page Application (SPA) architecture |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) v4 | CSS-first modern utility engine |
| **Charts** | [Recharts](https://recharts.org/) v3 | Responsive SVG visualizations (Donut & Bar charts) |
| **Icons & Routing** | React Router v7 + Lucide React | Modern sidebar navigation and developer icons |

---

## 🚀 Quick Start

### 1. Prerequisites

- A running [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) instance (default: `http://127.0.0.1:8317`).
- **Bun** installed on your machine (`curl -fsSL https://bun.sh/install | bash`).

### 2. Clone & Setup

```bash
git clone https://github.com/PiLaoban2004/antigravity-ui.git
cd antigravity-ui

# Install monorepo workspace dependencies
bun install

# Setup backend environment file
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env` with your CLIProxyAPI management secret key:

```ini
ANTI_UI_MGMT_KEY=your_management_secret_key_here
ANTI_UI_PROXY_URL=http://127.0.0.1:8317
ANTI_UI_PORT=4310
ANTI_UI_WEB_ORIGIN=http://127.0.0.1:4321
```

### 3. Launch

```bash
chmod +x start.sh
./start.sh
```

Open your browser and visit: 👉 **http://127.0.0.1:4321**

---

## 📱 Page Overview

| Page | Path | Key Functionalities |
| :--- | :--- | :--- |
| **📊 Dashboard** | `/` | Real-time proxy health, active/error account counts, and model inventory. |
| **👥 Accounts** | `/accounts` | Interactive list, OAuth login initiation, enable/disable switches, quota reset. |
| **🔄 Model Mapping** | `/models` | Channel-based alias configuration for `claude`, `codex`, `openai`, `gemini`. |
| **🔀 Routing Strategy** | `/routing` | Toggle between Round-Robin, Weighted Round-Robin, and Fill-First with weight sliders. |
| **⚡ Availability** | `/availability` | Test specific OAuth token validity and run real chat completion probes. |
| **📈 Model Usage** | `/usage` | Relay-style token breakdown, cost pie chart, request ranking bar chart. |
| **📋 Client Configs** | `/clients` | One-click ready configuration generator for major AI coding tools. |
| **📜 Live Logs** | `/logs` | Real-time gateway access logs and error traces. |
| **⚙️ Settings** | `/settings` | Read-only configuration review and security recommendations. |

---

## 🔌 Client Integration Guide

Antigravity UI bridges Antigravity Gemini models to standard protocols. Connect your agent tools directly:

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

## ❓ FAQ

<details>
<summary><b>Q: Newly added Google account returns 403 PERMISSION_DENIED / "Verify your account"?</b></summary>
This is standard Google risk control for newly created accounts. Simply log into <a href="https://developers.google.com/gemini-code-assist">Google Gemini Code Assist</a> or open the Antigravity IDE once with that account to complete verification.
</details>

<details>
<summary><b>Q: Encountering 429 RESOURCE_EXHAUSTED or frequent cooling down?</b></summary>
Free-tier Google accounts have strict request-per-minute limits. We recommend using accounts with a Pro subscription or adding 2–3 accounts to the pool to balance the load.
</details>

<details>
<summary><b>Q: How do I customize model pricing?</b></summary>
Adjust the <code>MODEL_PRICES</code> map inside <code>apps/server/src/index.ts</code> directly with your desired rates (USD per 1M tokens).
</details>

---

## 🔒 Security & Disclaimer

1. **Local-Only**: Binds to `127.0.0.1` by default. Secret management keys remain on the local machine and are never transmitted to browsers. Do not expose this interface to public networks.
2. **Disclaimer**: This tool is developed strictly for personal, educational, and research purposes. Please adhere to Google's Terms of Service and refrain from abusive rate limits or commercial resale.

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).
