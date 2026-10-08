# 远程访问看板

> **推荐的远程方式已改为只开放 API 网关**（见 [GATEWAY.md](./GATEWAY.md)）：公网只暴露模型调用入口和访问统计，看板的其余功能留在本机。本文描述的"整个看板远程可用"仍然保留，但默认不建议开启——暴露面更大。

适用拓扑：**IDE、CLIProxyAPI 和本项目都跑在同一台常开机器上**，你从手机/笔记本远程查看和管理。
看板只是"远程查看窗口"：所有对 Google 的请求仍然只由这台机器发出（同一台机器、同一个出口 IP）。

## 为什么必须是这个拓扑

- 额度数据来自本机 Antigravity IDE 的 `language_server`（`ps`/`lsof` 发现，只监听回环地址），看板必须和 IDE 在同一台机器上才读得到。
- 如果把 CLIProxyAPI 或看板搬到别的机器/云服务器，对 Google 可见的来源 IP 就变了。社区里的封号案例主要指向"第三方反代 + 多账号轮换/多客户端中转"，没有证据说明单独换 IP 会触发，但**没有理由主动制造变化**。

## 1. 开启远程模式

`apps/server/.env`：

```bash
ANTI_UI_REMOTE=1
# 至少 24 个字符的随机串，例如：openssl rand -base64 36
ANTI_UI_ADMIN_TOKEN=...
# 可选：只读令牌，发给只想看数据的设备
ANTI_UI_VIEW_TOKEN=...
# 隧道对外的主机名，必须与浏览器地址栏里的 Host 完全一致（Tailscale 的 *.ts.net 名字或 Cloudflare 的域名）
ANTI_UI_ALLOWED_HOSTS=dash.example.com
# 只有当隧道是唯一入口时才开：用 CF-Connecting-IP / X-Forwarded-For 区分客户端（登录限流、审计）
ANTI_UI_TRUSTED_PROXY=1
# 可选：本机脚本（AgentRouter 包装器等）上报用量时用，只对 POST /api/usage/record 有效
ANTI_UI_RECORD_KEY=...
```

然后构建并启动（构建后服务会同源托管前端，不需要再开 Vite）：

```bash
bun run build
cd apps/server && bun src/index.ts   # 必须在 apps/server 目录启动
```

远程模式下：

- **所有** `/api` 请求都要凭证，包括来自 127.0.0.1 的请求（隧道本来就是从回环转发的，回环地址不能当信任依据）。
- `admin` 可以做任何事；`viewer` 只能读（任何非 GET 请求都需要 admin）。
- 令牌换会话 cookie（HttpOnly、SameSite=Strict）；同一 IP 15 分钟内失败 5 次会被锁定，全局 50 次也会锁。
- 写操作和登录尝试记入审计表，设置页可看（只记方法/路径/状态，不记请求体和查询串）。
- 服务默认仍只绑 `127.0.0.1`。`ANTI_UI_BIND_HOST` 设成非回环地址时，如果没开远程模式会直接拒绝启动。

## 2. 选一个隧道

### Tailscale（推荐，只给自己的设备）

```bash
tailscale serve --bg --https=443 http://127.0.0.1:4310
```

浏览器打开 `https://<机器名>.<tailnet>.ts.net`，并把这个主机名写进 `ANTI_UI_ALLOWED_HOSTS`。流量不经过第三方。

### Cloudflare Tunnel + Access（浏览器直接用，不想装客户端）

```bash
cloudflared tunnel --url http://127.0.0.1:4310     # 或在 Zero Trust 面板里配置命名隧道
```

**务必**给这个主机名配一条 Access 策略（邮箱白名单或 SSO），否则它是公网可达的；令牌只是第二道门。

### 不要做的事

- 不要把 4310 / 8317 / 15721 / 7863 做端口映射或绑定 `0.0.0.0` 暴露到公网。
- 不要把 CLIProxyAPI 自己的管理页暴露出去；看板已经代理了需要的那部分。

## 3. 关于"风控"

做了什么：

| 措施 | 目的 |
|---|---|
| Google 侧请求始终来自这台机器 | 不新增来源 IP/设备 |
| `/api/health`、`/api/quota`、`/auth-files` 在服务端合并与缓存（5s / 20s / 2s），SSE 由服务端单个定时器广播 | N 个浏览器不会放大对 CLIProxyAPI 和 language_server 的请求；没人看时不轮询 |
| 浏览器标签页隐藏时暂停轮询，`/api/health` 轮询 5s → 15s | 减少无意义请求 |
| 模型测试、凭证测试仅 admin，并有速率/并发上限（120/分、30/分） | 防止失控循环或被盗会话消耗真实额度 |
| 「测试全部」按钮增加二次确认 | 每次测试都是真实调用 |
| **OAuth 登录只能在本机进行**（远程会话里该入口被禁用，服务端也会拒绝带转发头/非回环 Host 的请求） | 新设备/新 IP 的登录是最典型的异常信号，且远程 OAuth 本来就不可靠 |

没有做、也不会做：伪装指纹、改写 UA/请求头、IP 轮换/代理池、账号自动轮换。

需要知道的事实：社区报告的封号（403 ToS）多与**使用第三方反代本身、多账号轮换、多个客户端同时中转**有关。看板不能消除这个风险，只保证"远程查看"不会让它变得更糟。同一个账号不要同时被多个 CLIProxyAPI/IDE 实例使用；建议不要用主力 Google 账号。

## 4. 排错

| 现象 | 原因 |
|---|---|
| 浏览器 `forbidden host` | `ANTI_UI_ALLOWED_HOSTS` 没写隧道主机名（要与 Host 头完全一致，含端口则带端口） |
| `forbidden origin` | 页面来源不是 `https://<allowed host>`；跨域部署时用 `ANTI_UI_WEB_ORIGINS` 追加 |
| 登录 429 | 失败次数过多，等待 `Retry-After`；所有客户端共用一个 IP 时先开 `ANTI_UI_TRUSTED_PROXY=1` |
| 重启后要重新登录 | 会话只存在内存里（有效期 `ANTI_UI_SESSION_HOURS`，默认 12） |
| 额度页是「缓存数据」 | 本机 IDE 没有登录该账号或已关闭，见 CLAUDE.md 的 Quota 一节 |
| `smoke.ts` 401 | 设置 `ANTI_UI_ADMIN_TOKEN` 环境变量再运行 |
