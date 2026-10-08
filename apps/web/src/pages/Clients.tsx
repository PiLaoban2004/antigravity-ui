import { useState } from 'react';
import {
  Copy,
  Check,
  Terminal,
  MessageSquare,
  Boxes,
  Bot,
  Code2,
  Braces,
  Zap,
  Flame,
} from 'lucide-react';
import type { ModelGroup, ProviderGroup } from '@antigravity-ui/shared';

const ANTI_BASE = 'http://127.0.0.1:8317';
const AR_BASE = 'http://127.0.0.1:15721';
// 密钥不写进前端源码：生成的配置里引用环境变量，使用前先 export AGENTROUTER_API_KEY=...
const AR_KEY = '${AGENTROUTER_API_KEY}';
// WorkBuddy 的密钥不写进前端源码，统一用环境变量引用（见 ~/workbuddy2api/config.json）
const WB_BASE = 'http://127.0.0.1:7863';

interface ClientDef {
  id: string;
  group: ProviderGroup;
  name: string;
  icon: any;
  desc: string;
  generate: () => string;
}

const clients: ClientDef[] = [
  // ---- AgentRouter 分组客户端 ----
  {
    id: 'ar-claude-code-racing',
    group: 'agentrouter',
    name: 'Claude Code CLI (5模型竞速极速代理)',
    icon: Flame,
    desc: '走本地 15721 网关，5 模型毫秒级竞速防超时',
    generate: () =>
      `# 在终端中执行以下环境变量后启动 Claude Code\nexport ANTHROPIC_BASE_URL="${AR_BASE}"\nexport ANTHROPIC_AUTH_TOKEN="${AR_KEY}"\nexport ANTHROPIC_MODEL="agentrouter-race"\n\n# 启动 Claude Code\nclaude`,
  },
  {
    id: 'ar-claude-code-direct',
    group: 'agentrouter',
    name: 'Claude Code CLI (直连 AgentRouter)',
    icon: MessageSquare,
    desc: '直连官方 https://agentrouter.org，Anthropic 兼容协议',
    generate: () =>
      `# 官方直连模式\nexport ANTHROPIC_BASE_URL="https://agentrouter.org"\nexport ANTHROPIC_AUTH_TOKEN="${AR_KEY}"\nexport ANTHROPIC_MODEL="claude-opus-4-8"\n\n# 启动 Claude Code\nclaude`,
  },
  {
    id: 'ar-dsh',
    group: 'agentrouter',
    name: 'DeepSeek Harness (AgentRouter 竞速)',
    icon: Bot,
    desc: '~/.dsh/settings.yaml 的 agentrouter provider',
    generate: () =>
      `llm-pi-ai:\n  providers:\n    agentrouter:\n      displayName: AgentRouter (Racing Proxy)\n      apiKeyEnv: AGENTROUTER_API_KEY\n      api: openai-completions\n      baseURL: ${AR_BASE}/v1\n      models:\n        - id: agentrouter-race\n          name: AgentRouter 4-Model Racing (极速竞速)\n          input: ["text", "image"]\n          contextWindow: 1048576\n        - id: claude-opus-4-8\n          name: Claude Opus 4.8\n          input: ["text", "image"]\n          contextWindow: 200000\n        - id: deepseek-v4-flash\n          name: DeepSeek V4 Flash\n          input: ["text", "image"]\n          contextWindow: 131072\n        - id: gpt-5.6-sol\n          name: GPT-5.6 Sol\n          input: ["text", "image"]\n          contextWindow: 1048576`,
  },
  {
    id: 'ar-pi',
    group: 'agentrouter',
    name: 'Pi Agent CLI (AgentRouter)',
    icon: Code2,
    desc: '~/.pi/agent/models.json 配置',
    generate: () =>
      JSON.stringify(
        {
          providers: {
            agentrouter: {
              baseUrl: `${AR_BASE}/v1`,
              api: 'openai-completions',
              apiKey: AR_KEY,
              models: [
                { id: 'agentrouter-race', name: 'AgentRouter 4-Model Racing', reasoning: true, contextWindow: 1048576 },
                { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', reasoning: true, contextWindow: 200000 },
                { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: true, contextWindow: 131072 },
                { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', reasoning: true, contextWindow: 1048576 },
              ],
            },
          },
        },
        null,
        2
      ),
  },
  {
    id: 'ar-curl',
    group: 'agentrouter',
    name: '通用 cURL / Python (AgentRouter 竞速)',
    icon: Braces,
    desc: 'OpenAI 格式竞速请求',
    generate: () =>
      `curl -X POST ${AR_BASE}/v1/chat/completions \\\n  -H "Authorization: Bearer ${AR_KEY}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "agentrouter-race",\n    "messages": [{"role": "user", "content": "Hello!"}],\n    "stream": true\n  }'`,
  },

  // ---- Antigravity 分组客户端 ----
  {
    id: 'anti-claude-code',
    group: 'antigravity',
    name: 'Claude Code (Antigravity 路由)',
    icon: MessageSquare,
    desc: 'Anthropic 协议（映射到 Google Gemini 3.7）',
    generate: () =>
      JSON.stringify(
        {
          env: {
            ANTHROPIC_AUTH_TOKEN: 'PROXY_MANAGED',
            ANTHROPIC_BASE_URL: ANTI_BASE,
            ANTHROPIC_MODEL: 'claude-sonnet-4-6',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6',
            CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
            CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
            API_TIMEOUT_MS: '600000',
          },
        },
        null,
        2
      ),
  },
  {
    id: 'anti-dsh',
    group: 'antigravity',
    name: 'DeepSeek Harness (Antigravity Gemini)',
    icon: Bot,
    desc: '~/.dsh/settings.yaml 的 antigravity provider',
    generate: () =>
      `llm-pi-ai:\n  providers:\n    antigravity:\n      displayName: Antigravity Gemini (proxy)\n      apiKeyEnv: ANTIGRAVITY_PROXY_KEY\n      api: openai-completions\n      baseURL: ${ANTI_BASE}/v1\n      reasoning: high\n      models:\n        - id: gemini-3.8-flash-high\n          name: Gemini 3.8 Flash High\n          input: ["text", "image"]\n          contextWindow: 1048576\n          reasoningEfforts:\n            high: high\n        - id: gemini-3.7-flash-high\n          name: Gemini 3.7 Flash High\n          input: ["text", "image"]\n          contextWindow: 1048576\n          reasoningEfforts:\n            high: high\n        - id: gemini-3.1-pro-low\n          name: Gemini 3.1 Pro Low\n          input: ["text", "image"]\n          contextWindow: 1048576\n          reasoningEfforts:\n            high: high`,
  },
  {
    id: 'anti-pi',
    group: 'antigravity',
    name: 'Pi Agent CLI (Antigravity)',
    icon: Code2,
    desc: '~/.pi/agent/models.json',
    generate: () =>
      JSON.stringify(
        {
          providers: {
            antigravity: {
              baseUrl: `${ANTI_BASE}/v1`,
              api: 'openai-completions',
              apiKey: 'PROXY_MANAGED',
              models: [
                { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', reasoning: true, reasoningEffort: 'high', contextWindow: 1048576 },
                { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High', reasoning: true, reasoningEffort: 'high', contextWindow: 1048576 },
                { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro Low', reasoning: true, reasoningEffort: 'high', contextWindow: 1048576 },
              ],
            },
          },
        },
        null,
        2
      ),
  },
  {
    id: 'anti-codex',
    group: 'antigravity',
    name: 'Codex (ChatGPT App)',
    icon: Terminal,
    desc: 'Responses 协议（ChatGPT App 内置 codex）',
    generate: () =>
      `model = "gemini-3.7-flash-high"\nmodel_provider = "cliproxyapi"\nmodel_reasoning_effort = "high"\n\n[model_providers.cliproxyapi]\nname = "Antigravity Gemini"\nbase_url = "${ANTI_BASE}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nexperimental_bearer_token = "PROXY_MANAGED"`,
  },
  {
    id: 'anti-opencode',
    group: 'antigravity',
    name: 'OpenCode',
    icon: Boxes,
    desc: '~/.config/opencode/opencode.json',
    generate: () =>
      JSON.stringify(
        {
          provider: {
            antigravity: {
              options: { baseURL: `${ANTI_BASE}/v1`, apiKey: 'PROXY_MANAGED' },
              models: {
                'gemini-3.7-flash-high': { name: 'Gemini 3.7 Flash High', options: { store: false } },
              },
            },
          },
        },
        null,
        2
      ),
  },
  // ---- WorkBuddy 分组客户端 (OpenAI 兼容, 积分制) ----
  {
    id: 'wb-dsh',
    group: 'workbuddy',
    name: 'DeepSeek Harness (WorkBuddy 积分)',
    icon: Bot,
    desc: '~/.dsh/settings.yaml 的 workbuddy provider',
    generate: () =>
      `llm-pi-ai:\n  providers:\n    workbuddy:\n      displayName: WorkBuddy (积分制)\n      apiKeyEnv: WORKBUDDY_API_KEY\n      api: openai-completions\n      baseURL: ${WB_BASE}/v1\n      models:\n        - id: global:deepseek-v4.1-flash\n          name: WorkBuddy 全球 DeepSeek V4.1 Flash\n          input: ["text", "image"]\n          contextWindow: 256000\n        - id: cn:auto\n          name: WorkBuddy 国内 Auto (自动选模)\n          input: ["text", "image"]\n          contextWindow: 256000`,
  },
  {
    id: 'wb-pi',
    group: 'workbuddy',
    name: 'Pi Agent CLI (WorkBuddy)',
    icon: Code2,
    desc: '~/.pi/agent/models.json 配置',
    generate: () =>
      JSON.stringify(
        {
          providers: {
            workbuddy: {
              baseUrl: `${WB_BASE}/v1`,
              api: 'openai-completions',
              apiKey: '${WORKBUDDY_API_KEY}',
              models: [
                { id: 'global:deepseek-v4.1-flash', name: 'WorkBuddy DeepSeek V4.1 Flash', reasoning: true, contextWindow: 256000 },
                { id: 'cn:auto', name: 'WorkBuddy Auto', reasoning: true, contextWindow: 256000 },
              ],
            },
          },
        },
        null,
        2
      ),
  },
  {
    id: 'wb-opencode',
    group: 'workbuddy',
    name: 'OpenCode (WorkBuddy)',
    icon: Boxes,
    desc: '~/.config/opencode/opencode.json',
    generate: () =>
      JSON.stringify(
        {
          provider: {
            workbuddy: {
              options: { baseURL: `${WB_BASE}/v1`, apiKey: '${WORKBUDDY_API_KEY}' },
              models: {
                'global:deepseek-v4.1-flash': { name: 'WorkBuddy DeepSeek V4.1 Flash', options: { store: false } },
              },
            },
          },
        },
        null,
        2
      ),
  },
  {
    id: 'wb-curl',
    group: 'workbuddy',
    name: '通用 cURL / Python (WorkBuddy)',
    icon: Braces,
    desc: 'OpenAI 格式，积分制计费（无美元成本）',
    generate: () =>
      `curl -X POST ${WB_BASE}/v1/chat/completions \\\n  -H "Authorization: Bearer $WORKBUDDY_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "global:deepseek-v4.1-flash",\n    "messages": [{"role": "user", "content": "Hello!"}],\n    "stream": true\n  }'`,
  },
];

export default function Clients() {
  const [activeGroup, setActiveGroup] = useState<ModelGroup>('all');
  const filteredClients = clients.filter(
    (c) => activeGroup === 'all' || c.group === activeGroup
  );
  const [selected, setSelected] = useState<ClientDef>(filteredClients[0] || clients[0]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(selected.generate());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">客户端配置</h1>
          <p className="text-zinc-400 text-sm mt-1">
            一键生成各应用客户端的接入参数与环境变量，复制即用
          </p>
        </div>

        {/* 分组切换 */}
        <div className="flex p-1 bg-zinc-900 border border-zinc-800 rounded-xl max-w-full min-w-0 overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap">
          <button
            onClick={() => {
              setActiveGroup('all');
              setSelected(clients[0]);
            }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeGroup === 'all' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            全部客户端
          </button>
          <button
            onClick={() => {
              setActiveGroup('agentrouter');
              setSelected(clients.find((c) => c.group === 'agentrouter') || clients[0]);
            }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeGroup === 'agentrouter'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            AgentRouter (竞速网关)
          </button>
          <button
            onClick={() => {
              setActiveGroup('antigravity');
              setSelected(clients.find((c) => c.group === 'antigravity') || clients[0]);
            }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeGroup === 'antigravity'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Antigravity (Gemini)
          </button>
          <button
            onClick={() => {
              setActiveGroup('workbuddy');
              setSelected(clients.find((c) => c.group === 'workbuddy') || clients[0]);
            }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeGroup === 'workbuddy'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
            WorkBuddy (积分)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredClients.map((c) => {
          const isSelected = selected.id === c.id;
          const isAR = c.group === 'agentrouter';
          const isWB = c.group === 'workbuddy';

          return (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`p-4 rounded-xl border text-left transition-all relative overflow-hidden ${
                isSelected
                  ? isAR
                    ? 'border-amber-500/80 bg-amber-950/20 shadow-md shadow-amber-500/5'
                    : isWB
                    ? 'border-sky-500/80 bg-sky-950/20 shadow-md shadow-sky-500/5'
                    : 'border-emerald-500/80 bg-emerald-950/20 shadow-md shadow-emerald-500/5'
                  : 'border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900/90'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <c.icon
                    className={`w-4 h-4 ${
                      isAR ? 'text-amber-400' : isWB ? 'text-sky-400' : 'text-emerald-400'
                    }`}
                  />
                  <span className="font-semibold text-sm text-zinc-100">{c.name}</span>
                </div>
                <span
                  className={`shrink-0 whitespace-nowrap text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    isAR
                      ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                      : isWB
                      ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20'
                      : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                  }`}
                >
                  {isAR ? '15721 竞速' : isWB ? '7863 积分' : '8317 反代'}
                </span>
              </div>
              <div className="text-xs text-zinc-400 line-clamp-1">{c.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950 overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-zinc-200">{selected.name}</span>
            <span className="text-xs text-zinc-500">· {selected.desc}</span>
          </div>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? '已复制到剪贴板' : '复制配置'}
          </button>
        </div>
        <pre className="p-5 text-xs text-zinc-300 overflow-x-auto font-mono whitespace-pre leading-relaxed bg-black/40">
          {selected.generate()}
        </pre>
      </div>
    </div>
  );
}
