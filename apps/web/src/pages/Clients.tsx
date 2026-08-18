import { useState } from 'react';
import { Copy, Check, Terminal, MessageSquare, Boxes, Bot, Code2, Braces } from 'lucide-react';

const BASE = 'http://127.0.0.1:8317';

interface ClientDef {
  id: string;
  name: string;
  icon: any;
  desc: string;
  generate: () => string;
}

const clients: ClientDef[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: MessageSquare,
    desc: 'Anthropic 协议（经 alias 路由到 gemini）',
    generate: () =>
      JSON.stringify(
        {
          env: {
            ANTHROPIC_AUTH_TOKEN: 'PROXY_MANAGED',
            ANTHROPIC_BASE_URL: BASE,
            ANTHROPIC_MODEL: 'claude-sonnet-4-6',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6',
            CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
            CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
            API_TIMEOUT_MS: '600000',
          },
        },
        null,
        2,
      ),
  },
  {
    id: 'codex',
    name: 'Codex',
    icon: Terminal,
    desc: 'Responses 协议（ChatGPT App 内置 codex）',
    generate: () => `model = "gemini-3.7-flash-high"
model_provider = "cliproxyapi"
model_reasoning_effort = "high"

[model_providers.cliproxyapi]
name = "Antigravity Gemini"
base_url = "${BASE}/v1"
wire_api = "responses"
requires_openai_auth = false
experimental_bearer_token = "PROXY_MANAGED"`,
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    icon: Bot,
    desc: 'settings.yaml 的 llm-pi-ai provider',
    generate: () => `llm-pi-ai:
  providers:
    antigravity:
      displayName: Antigravity Gemini (proxy)
      apiKeyEnv: ANTIGRAVITY_PROXY_KEY
      api: openai-completions
      baseURL: ${BASE}/v1
      models:
        - id: gemini-3.7-flash-high
          name: Gemini 3.7 Flash High
          input: ["text", "image"]
          contextWindow: 1048576`,
  },
  {
    id: 'pi',
    name: 'Pi',
    icon: Code2,
    desc: '~/.pi/agent/models.json',
    generate: () => JSON.stringify(
      {
        providers: {
          antigravity: {
            baseUrl: `${BASE}/v1`,
            api: 'openai-completions',
            apiKey: 'PROXY_MANAGED',
            models: [{ id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High', input: ['text', 'image'], contextWindow: 1048576 }],
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: Boxes,
    desc: '~/.config/opencode/opencode.json',
    generate: () => JSON.stringify(
      {
        provider: {
          antigravity: {
            options: { baseURL: `${BASE}/v1`, apiKey: 'PROXY_MANAGED' },
            models: {
              'gemini-3.7-flash-high': { name: 'Gemini 3.7 Flash High', options: { store: false } },
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'openai',
    name: '通用 OpenAI 兼容',
    icon: Braces,
    desc: '任意 OpenAI SDK / 应用',
    generate: () => `base_url = "${BASE}/v1"
api_key = "PROXY_MANAGED"
model = "gemini-3.7-flash-high"`,
  },
];

export default function Clients() {
  const [selected, setSelected] = useState(clients[0]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(selected.generate());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-1">客户端配置</h1>
      <p className="text-zinc-400 text-sm mb-6">一键生成各客户端的接入配置，复制即用</p>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {clients.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c)}
            className={`p-4 rounded-xl border text-left transition-colors ${
              selected.id === c.id ? 'border-emerald-600 bg-emerald-950/40' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <c.icon className="w-4 h-4 text-emerald-400" />
              <span className="font-medium">{c.name}</span>
            </div>
            <div className="text-xs text-zinc-500">{c.desc}</div>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
          <span className="text-sm text-zinc-400">{selected.name} 配置</span>
          <button onClick={copy} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700">
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        <pre className="p-4 text-sm text-zinc-200 overflow-x-auto font-mono whitespace-pre">{selected.generate()}</pre>
      </div>
    </div>
  );
}
