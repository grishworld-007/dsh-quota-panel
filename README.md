# dsh-quota-panel

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 动态 Cordis 插件：在 Web GUI **右上角悬浮面板**实时展示当前模型设置中各家 provider 的**套餐余额 / 配额剩余**，统一按「剩余百分比」渲染进度条，每 60 秒自动刷新。

![面板示意](https://img.shields.io/badge/panel-quota-10b981) ![刷新](https://img.shields.io/badge/refresh-60s-blue) ![语言](https://img.shields.io/badge/lang-plain_JS-f59e0b)

## 功能

- **四家 provider 一屏看全**，进度条与数字统一表示**剩余百分比**（条满=充足，绿→黄→红随剩余量递减）：
  - **智谱 GLM Coding Plan**（`zai-coding-cn`）：5小时窗口、周配额
  - **火山方舟 Ark**（`ark`）：5小时窗口、周配额、月配额（自动探测 Agent Plan `GetAFPUsage` → Coding Plan `GetCodingPlanUsage`）
  - **MiniMax**（`minimax-cn`）：general 通道的区间剩余、周剩余（自动过滤 video 通道）
  - **DeepSeek**（`deepseek-official`）：账户余额（按币种合计）
- provider / 模型清单从 DSH 设置 `llm-pi-ai` 动态读取，改配置后面板自动跟随
- 当前默认模型所在 provider 以 `●` 标记（读自 `agent-default-model`）
- 手动 `⟳` 刷新、`−` 收起成小胶囊、`＋` 展开；深色模式自适应
- **紧凑窄版**：宽 200px、`max-height:44vh`，内容超出列表内滚动

## 悬停提示（重置倒计时）

| 悬停位置 | 显示 |
|---|---|
| provider 卡片区域（如 GLM 卡） | 该 provider 各窗口的重置倒计时汇总：`zai-coding-cn 重置倒计时 — 5小时窗口：2小时13分后；周配额：1天3小时后` |
| 单条进度行 | 该行倒计时 + 绝对时间：`重置倒计时 2小时13分后（8-28 21:30）` |
| provider 名字 | 该 provider 的模型清单 |
| DeepSeek 余额行 | 各币种赠送 / 充值分项 |

倒计时格式：`X天X小时后` / `X小时X分后` / `X分后` / `已重置`，随 60s 刷新自动更新（宿主下发各窗口的毫秒时间戳 `resetAtMs` / `intervalEndMs` / `weeklyEndMs`，客户端用 `Date.now()` 换算）。

## 数据源与鉴权

| Provider | 接口 | 鉴权 | 需要的凭据 |
|---|---|---|---|
| 智谱 GLM | `GET {base}/api/monitor/usage/quota/limit` | `Authorization: Bearer <key>` | `ZAI_CODING_CN_API_KEY` |
| Ark（火山） | `POST https://open.volcengineapi.com/?Action=...&Region=cn-beijing&Version=2024-01-01` | **火山引擎签名 V4**（HMAC-SHA256，AK/SK） | `VOLC_ACCESSKEY` + `VOLC_SECRETKEY`（或 `ARK_ACCESS_KEY_ID` + `ARK_SECRET_ACCESS_KEY`） |
| MiniMax | `GET https://api.minimaxi.com/v1/token_plan/remains` | `Authorization: Bearer <key>` | `MINIMAX_CN_API_KEY` |
| DeepSeek | `GET https://api.deepseek.com/user/balance` | `Authorization: Bearer <key>` | `DEEPSEEK_API_KEY` |

> **Ark 说明**：用量接口在**控制面 OpenAPI 网关**（`open.volcengineapi.com`），与推理用的 `ARK_API_KEY` 是两套凭据；复用推理 Bearer Key 会被网关以 `400 InvalidAuthorization` 拒绝。因此需要火山账号的 AccessKey ID / Secret（控制台「访问控制 → AccessKey 管理」创建，子用户需有方舟用量查询 OpenAPI 权限）。region 自动从 provider 的 `baseURL` 解析（如 `ark.cn-beijing.volces.com` → `cn-beijing`），识别不到回落 `cn-beijing`。

### 凭据配置

DSH 的 `credentials` 服务按「环境变量名」解析，写入 `~/.dsh/.credentials.yaml`：

```yaml
version: "1"
refs:
  DEEPSEEK_API_KEY: sk-...
  ZAI_CODING_CN_API_KEY: "..."
  MINIMAX_CN_API_KEY: sk-...
  VOLC_ACCESSKEY: AK...      # 火山控制面 AccessKey ID（Ark 用量查询用）
  VOLC_SECRETKEY: "..."      # 火山控制面 Secret Access Key
```

> Ark 是可选的：不配 `VOLC_ACCESSKEY/VOLC_SECRETKEY` 时，Ark 卡片会显示「需配置 AK/SK」的提示，其余 provider 正常工作。

## 技术要点

- DSH 的 `web.fetch` 不支持自定义请求头（无 Authorization），因此所有请求通过 `ctx.shell` 起本地 `curl` 子进程完成；密钥**只注入子进程环境变量**，不写入命令行文本、不进日志、不回传浏览器。
- DSH Host 插件沙箱没有 `crypto` 全局，Ark 的**火山签名 V4**（SHA-256 / HMAC-SHA256 密钥派生链 `kDate→kRegion→kService→kSigning`，固定顺序 canonical headers `host;x-date;x-content-sha256;content-type`，scope 以 `request` 结尾）以**纯 JS 实现**，已用标准测试向量（SHA-256、RFC 4231 HMAC）校验。
- 各接口返回的「已用/剩余」语义不一致：GLM 与 Ark 回**已用百分比**（面板换算为剩余），MiniMax 直接回**剩余百分比**——面板统一按剩余渲染。
- Client 通过 `harness.handle('quota')` / `host.call('quota')` 走 Package 私有 JSON RPC；UI 注册在 `shell.overlay` Slot（`pointer-events:auto`）；`ctx.interval` 60s 自动刷新。

## 使用（在 DSH 会话里加载）

本仓库是**动态 Cordis 插件**的源码：`host.js` / `client.js` 的文件内容分别是 `cordis_define` 的 `code.host` / `code.client` 参数值（纯 JS 函数体，`return { ... }`）。

对 DSH 的模型代理（或具备 `cordis_define` 工具的会话）说：

> 用 cordis 定义一个新插件，idPrefix 用 `quota`，name「模型配额面板」，
> code.host 取本仓库 `host.js` 的内容，code.client 取 `client.js` 的内容，
> 然后运行（run）它并在授权提示里允许。

文件结构：

```
host.js      # Host 半：纯 JS SHA-256/HMAC、火山签名 V4、四家配额查询（含各窗口重置毫秒时间戳）、harness.handle('quota')
client.js    # Client 半：shell.overlay 窄版悬浮面板（统一剩余进度条、悬停重置倒计时、60s 刷新）
plugin.json  # 元数据清单（provider/端点/凭据映射）
```

依赖的 Host 服务：`shell`、`credentials`（必需），`settings`、`llm`、`sandboxPolicy`（可选，缺失时优雅降级）。
Client 依赖：`timer`（inject）、`slots`、`React`、`host`、`styles`。

## 兼容性

- DeepSeek Harness（DSH）带 `cordis_define` / `cordis_run` 动态插件工具的版本
- 本地需有 `curl`（插件通过 shell 服务调用）
- Node 侧无需任何第三方依赖（加密为纯 JS 实现）

## 隐私

所有密钥经 DSH credentials 服务读取，仅注入一次性 curl 子进程的环境变量；面板返回给浏览器的 JSON 中不含任何凭据。

## License

未指定开源许可证（默认保留所有权利）。如需开源，可自行添加 LICENSE 文件。
