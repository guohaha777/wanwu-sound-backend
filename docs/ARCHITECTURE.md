# 独立后端的边界

前端 React／Vite 留在 [原仓库](https://github.com/guohaha777/voice_atalas_v2)，这里使用 Node 24、Fastify 5、PostgreSQL 17／Drizzle、pg-boss、私有 OSS、FFmpeg 和启用沙箱的 Chromium。

## 请求和文件

浏览器只访问前端同源 `/api/v1`；Netlify 代理到独立 HTTPS 后端。登录身份来自数据库会话和 HttpOnly Cookie，写操作同时校验精确 Origin 和 CSRF，不接受客户端自报账号或角色。

上传／播放先向 API 申请短期授权，再由浏览器直接访问私有 OSS。业务 API 不转发大音频。成品任务异步领取和查询，不能占住 Netlify 代理等 180 秒混音完成。

## 目录与数据

- `apps/api/src/app.ts`：框架设置、会话、所有请求都过的钩子（https、写操作的 Origin + CSRF）和错误体；各领域路由各在自己的模块，这里一行挂载一个。
- `apps/api/src/auth`：注册、登录、退出、改密、重置密码、按用户名限次，会话 Cookie 名与清除。
- `apps/api/src/admin`：邀请码、账号停用、发重置链接；每条路由在服务端校验管理员角色。
- `apps/api/src/cloud`：作品、音源、素材库和发布权限。
- `apps/api/src/db` 与 `migrations`：独立数据库角色、迁移与结构；不用旧 Supabase。
- `apps/api/src/storage`：OSS 受限运行身份；原件键不复用、不授予客户端写权限。
- `apps/worker/src/jobs`：单媒体重任务，源处理优先，成品按快照渲染，幂等条件更新。
- `packages/contracts`：协议类型和校验；不放密码和网络凭据。
- `packages/sound-rules`、`audio-engine`：同一规则／音色，前端试听与后端离线渲染共用。
- `data/catalogue`：独立内置目录；没有对前端源码树的运行依赖。

草稿是可变修订，正式保存／发布读取不可变快照。上传 ready 是技术状态，不是老师的入库确认。个人库与共享库均须老师试听确认；异常停用由管理员执行，不提供付费内容检测的假结果。

匿名分享只返回公开视图和短期成品授权，不返回完整作品、账号或原件。修改草稿不会修改已发布快照；撤销后不再签发新播放授权，但不能收回已经传输的字节。

## 本次拆分做了什么

从单仓库开发快照整理出 API、任务进程和三个共用包；内置示例及测试衍生件迁入本仓库数据目录，更新构建 COPY 与校验路径。没有改变 HTTP 协议、数据库迁移、声音参数或既有页面视觉。

共用包以前端为准，用 `scripts/sync-shared.mjs` 同步到本仓库，逐文件 SHA-256 记在 `handoff/manifest.json`，`npm run check:shared` 随 build 核对。以后任何一端改契约／音乐算法，都需要更新兼容版本并通知另一端；不要仅凭 package.json 仍是 0.1.0 就判断两边一致。

旧 ECS 仍运行拆分前镜像。本仓库新镜像需要重新构建、Linux 隔离测试和发布审批；不能把复制来源已有的容器验证结论挪到新的源码摘要上。
