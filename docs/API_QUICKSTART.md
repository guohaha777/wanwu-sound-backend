# 接口速查：优先复用前端已有的客户端

前端只请求同源 `/api/v1`。业务范围参考 [v0.6 协议](development/api-contract-v0.6.md)；字段、校验与实际路由一起查 `packages/contracts/src`、`apps/api/src/app.ts`（公共钩子与错误体）、`apps/api/src/auth/routes.ts`、`apps/api/src/admin/routes.ts`、`apps/api/src/cloud/routes.ts`、`apps/api/src/guest/routes.ts`。发现文档／实现冲突就报告，不擅自另做一套协议。

## 会话

`GET /auth/csrf` 获取 CSRF。登录／邀请码注册由服务端设置 `__Host-wanwu` Cookie；前端 JS 不读取 Cookie，不存 localStorage 登录令牌。

`POST /auth/register`、`POST /auth/login`、`POST /auth/logout`、`GET /auth/me`、`POST /auth/change-password`、`POST /auth/reset-password` 已有客户端处理。Origin 必须精确匹配，写请求带 `X-CSRF-Token`。不要自行拼永久账号头。

`If-Account-Match` 只用于识别标签页换账号造成的前提冲突，不是认证手段。管理员身份由服务端决定，公开注册不能指定 admin。

## 业务入口

下表路径都以 `/api/v1` 开头。

| 入口 | 语义 |
| --- | --- |
| `POST /works`、`GET /works?state=draft` | 创建／列出独立草稿，不是账号唯一草稿 |
| `GET /works/:id` | 取作品与 ETag；不能读取其他老师的私有作品 |
| `PUT /works/:id/arrangement`、`/compose-settings`，`PATCH /works/:id` | 元数据／标题修改，带当前 If-Match；冲突保留本地修改 |
| `PUT /works/:id` | 正式保存，冻结快照并返回 202；不等待成品混音 |
| `GET /works/:id/render` | 查异步成品状态；不要每次拖动都提交混音 |
| `PUT /sources/:id`、`POST /sources/:id/complete` | 登记／续签直传意图、上传后固化并处理；不是入库 |
| `GET /sources/:id` | 查技术状态及获授权的临时播放信息 |
| `GET /sources?scope=mine` 或 `teachers` | 个人／老师共享库条目，不能当作所有上传记录列表 |
| `POST /library/entries`、`PATCH/DELETE /library/entries/:id` | 老师试听确认的库条目与可见范围 |
| `POST/GET/DELETE /works/:id/share` | 确认发布、读取或撤销指定快照分享 |
| `GET /shares/:token` | 匿名公开作品视图，不含账号／原件／完整编辑数据 |

完整字段已在前端 `shared/account`、`shared/cloud` 的客户端（由接入补丁合入）和契约里实现，不要求前端重新猜 JSON。

## 错误和状态不能混用

错误响应为 `{status:"error", reason:"...", requestId:"..."}`，HTTP 状态仍表示实际错误。不要把所有 HTTP 200 当业务成功，也不要把 202 当已生成 MP3。

| 现象 | 处理 |
| --- | --- |
| HTML 响应 | 检查 Netlify 代理顺序／实际站点，不去改数据库 |
| `503 not-open` | 后端配置关闭认证；联系后端维护者，不伪造成功 |
| `401 needs-account` | 未登录／会话过期；由客户端回到登录流程 |
| `403 csrf-failed` | 检查同源 Cookie、Origin、CSRF 和代理，不关闭检查 |
| `409 version-conflict` | 保留用户修改，重新加载或另存副本；不得静默覆盖 |
| `409 account-changed` | 标签页账号已变化，停止旧请求，不能继续用旧归属保存 |
| `429` 或 busy | 尊重 Retry-After；不无限重试登录和上传意图 |

生产认证开关也覆盖分享路由；尚未启用服务时，匿名分享并不因此可以绕过 not-open。

## 文件和音频

原始 Blob／File 要保留；不能把重新编码的 WAV 冒充录音原件。普通音源 ≤20 MiB、≤45.5 秒，支持约定的五类真实格式；后端检查字节、指纹与可解码性，不只看扩展名。

上传临时授权约 5 分钟；浏览器使用服务端给出的 URL／请求头直传 OSS，不把文件经 Netlify 转发。播放授权约 60 秒，地址过期时刷新授权，不长期缓存带签名 URL。

服务端标准衍生件为 48 kHz PCM WAV，成品 MP3 128 kbps。前端试听和成品使用同一版本规则／音色；后端重算体检，不信任客户端修改分析结果。

ready 表示技术处理完成，不表示入库或内容审核通过。个人库与共享库都要老师确认；作品发布还要确认指定快照。首版不提供机器内容检测，也不构建逐条人工审核工作台。
