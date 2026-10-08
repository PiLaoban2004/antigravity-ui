# 远程 API 网关

只把"模型调用"这一件事开放到公网：你自己的设备带 `sk-…` 密钥调用，网关校验、限流、转发到本机 CLIProxyAPI，并记录访问统计。
账号、额度、路由、日志等看板功能**继续只在本机使用**（本机看板里新增了「远程调用」tab 来管理密钥和看统计）。

```
远程客户端 ─https→ Cloudflare ─tunnel→ 网关 :4311 ─→ CLIProxyAPI :8317 ─→ Google（出口仍是这台机器）
                                          │ gateway_key / gateway_log（usage.sqlite，WAL）
本机看板 :4310 ── 「远程调用」tab ── 同一份表（建密钥、看统计）
```

网关是独立进程（`apps/server/src/gateway/`），不用 `--watch`：改看板代码不会打断远程客户端正在进行的流式请求。

## 风险（先读）

- 这就是"对外提供调用"。社区里账号被限制的主要原因是**多人/多客户端经中转共用同一批账号**。网关的限流只能压平突发，**不能消除这个风险**。密钥只发给你自己的设备。
- api 域名**没有 Cloudflare Access 兜底**（程序化客户端过不了邮箱验证），安全完全取决于：密钥强度（256 位随机）+ 失败限流 + 路径白名单。密钥泄露后立刻在 tab 里停用/删除，立即生效。
- 网关不改写任何标识客户端应用的请求头，不轮换账号或 IP，对 Google 可见的流量仍是单一来源。

## 它做什么 / 不做什么

- **只转发**：`POST /v1/chat/completions`、`/v1/completions`、`/v1/responses`、`/v1/messages`（及 `/count_tokens`）、`/v1beta/models/<id>:generateContent|streamGenerateContent|countTokens`，`GET /v1/models`、`/v1beta/models`。其余一律 404（含 `/v0/management`、`/api-call`），且不记日志，扫描器灌不满数据库。
- **认证**：`Authorization: Bearer`、`x-api-key`、`x-goog-api-key` 或 `?key=`。网关按 SHA-256 哈希校验；库里另存一份 AES-256-GCM 加密的副本，所以看板里可以随时点「查看」再次显示完整密钥。主密钥在 `ANTI_UI_GATEWAY_SECRET`（64 位十六进制）或自动生成的 `apps/server/.gateway-secret`（权限 600，已 gitignore），不在数据库里：单独泄露 `usage.sqlite` 或备份拿不到明文。**丢了主密钥文件，已有密钥就看不到了**（仍能正常使用，只是无法再显示）。未知/停用/过期返回同一个 401；同一 IP 连续 10 次错误密钥后返回 429。
- **每密钥限制**：有效期、模型白名单（`gemini-*` 前缀匹配）、每分钟请求数、并发数、每日请求数。
- **全局闸**（所有密钥合计）：每分钟 `ANTI_UI_GATEWAY_GLOBAL_RPM`（默认 120）、并发 `ANTI_UI_GATEWAY_GLOBAL_CONCURRENCY`（默认 4）。这是控制上游访问模式的关键：密钥再多，Google 侧看到的也是有上限的平稳速率。
- **转发**：流式透传；去掉客户端的 `Authorization`/`x-api-key`/cookie 和 `cf-*`/`x-forwarded-*` 后再发给 CLIProxyAPI，其余头原样保留；客户端断开会取消上游请求。请求体上限 8MB。
- **统计**：每次请求一行（密钥、IP、国家、路径、模型、状态、耗时、字节、tokens、拒绝原因），默认保留 90 天。**请求次数/状态/耗时是准确的；tokens 是尽力统计**——只在响应里带了 usage 时才有（OpenAI 流式需要客户端设置 `stream_options.include_usage`），否则显示 `--` 而不是 0。
- 与「模型用量」页互不重复：那一页来自 CLIProxyAPI 的用量队列（按账号/模型），这里只回答"哪个密钥/哪个 IP 调了什么"。

## 部署

1. **启动网关**（`.env` 里已有配置，Bun 会自动读取）：

   ```bash
   cd apps/server && bun run gateway
   ```

   常驻用 launchd（`~/Library/LaunchAgents/com.antigravity-ui.gateway.plist`，`KeepAlive`，命令 `bun src/gateway/index.ts`，工作目录 `apps/server`）。
2. **`.env`**：

   ```bash
   ANTI_UI_GATEWAY_PORT=4311
   ANTI_UI_GATEWAY_TRUSTED_PROXY=1                    # 仅当隧道是唯一入口：用 CF-Connecting-IP / CF-IPCountry
   ANTI_UI_GATEWAY_PUBLIC_URL=https://api.example.com # 接入说明里显示的对外地址
   # 可选
   # ANTI_UI_GATEWAY_GLOBAL_RPM=120
   # ANTI_UI_GATEWAY_GLOBAL_CONCURRENCY=4
   # ANTI_UI_GATEWAY_RETENTION_DAYS=90
   # ANTI_UI_GATEWAY_MAX_BODY_BYTES=8388608
   ```

   网关只允许绑定回环地址。
3. **Cloudflare Tunnel**：在 `~/.cloudflared/config.yml` 的 `ingress` 里加

   ```yaml
   - hostname: api.example.com
     service: http://127.0.0.1:4311
   ```

   然后 `cloudflared tunnel route dns <隧道名> api.example.com` 并重启 cloudflared。**不要给 api 主机名建 Access 应用**。
   建议在 Cloudflare 面板给该主机名加一条 WAF 速率限制规则作为第一道闸。
4. 在本机看板「远程调用 → 密钥」创建密钥（之后可随时点眼睛图标查看/复制），再按「接入说明」里的片段配置客户端。

## 排查

- tab 顶部显示「网关未运行」：看 `~/Library/Logs/antigravity-ui-gateway.err.log`，或手动 `bun run gateway`。
- 客户端 401：密钥写错/已停用/已过期（响应里不区分）；在「访问日志」里看 `密钥无效 / 密钥已停用 / 密钥已过期`。
- 客户端 429：看响应的 `error.code`（`rpm` / `concurrency` / `daily` / `global_*`）和 `Retry-After`。
- 流式请求中途断开：日志里是 `客户端断开` 或 `流中断`，这两种不算上游报错。
