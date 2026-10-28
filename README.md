# 万物声谱 · 后端与前端接入交接

这是后端维护仓库，不是新的前端站点。前端由原作者维护，后端由 wudaizii 维护。

- 前端仓库：[guohaha777/voice_atalas_v2](https://github.com/guohaha777/voice_atalas_v2)
- 前端目标站点：[voiceatalass.netlify.app](https://voiceatalass.netlify.app)
- 后端接口入口：[wanwu-api.proterm.ink/api/v1/health](https://wanwu-api.proterm.ink/api/v1/health)
- 本仓库：[wudaizii/wanwu-sound-backend](https://github.com/wudaizii/wanwu-sound-backend)

## 明天接手先看这里

1. 人先读 [交接总览](handoff/START_HERE.md)，分清谁负责哪些配置。
2. 负责前端的 Claude Code 使用 [这份启动提示词](handoff/CLAUDE_CODE_PROMPT.md)，按 [前端接入步骤](handoff/FRONTEND.md) 执行。
3. 负责后端的开发者读 [配置表](docs/CONFIGURATION.md)、[运维边界](docs/OPERATIONS.md)、[验收状态](docs/STATUS.md)。

需要查接口时先读 [接口速查](docs/API_QUICKSTART.md)，再按链接查完整协议与实际契约。

根目录 `CLAUDE.md` 是 AI 入口，`AGENTS.md` 是项目边界。补丁、指纹、命令和验收标准都在仓库内；不依赖聊天记录或这台 Mac 的私密配置。

## 现在做到哪了

截至 2026-10-29：核心业务代码已有，原单仓库的本机前后端闭环曾验证通过；ECS 已运行此前构建的 API、独立 PostgreSQL 和音频任务，真实 OSS 音源处理、单次备份／恢复也有记录。

**真实 Netlify 全链路联调还没完成，生产登录仍关闭。** 本次独立仓库的容器镜像尚未部署到 ECS。推送本仓库不等于上线，也不会自动更新原前端站点。当前回归结果和未验证项见 [验收状态](docs/STATUS.md)。

## 仓库里有什么

| 目录 | 用途 |
| --- | --- |
| `apps/api` | Fastify 业务接口、账号／会话、数据库迁移、私有 OSS、管理与备份命令 |
| `apps/worker` | 音源校验、FFmpeg、Chromium 沙箱离线混音与队列 |
| `packages` | 前后端共用契约、声音规则、Web Audio 算法；交接版本有指纹 |
| `data/catalogue` | 后端自己的内置示例目录、试听衍生件和来源记录；不再读取前端目录 |
| `assets-source/audio` | 8 份已有公开使用记录的示例原件，不是用户上传的录音 |
| `deploy` | 隔离容器、Compose、Nginx 与最小权限配置示例，不含真实密钥 |
| `handoff` | 前端补丁、版本清单、人读步骤和 Claude Code 提示词 |
| `scripts` | 检查补丁、探测入口、构建镜像、独立本机测试等工具 |

## 后端本机检查

需要 Node.js 24.21 或更新的兼容版本。先做无需生产账号的检查：

```sh
npm ci
npm test
npm run build
```

`build` 检查类型、内置素材和交接完整性；Node 24 直接执行 TypeScript，不生成前端页面。运行 API 还需要独立 PostgreSQL、私密环境配置；不能直接拿生产库跑测试。新环境准备步骤见 [配置表](docs/CONFIGURATION.md)。

可选检查：`npm run test:media`、`npm run test:api`、`npm run test:worker:runtime`、`npm run test:operations`。后几项需要本机 Linux Docker；缺环境时记录未验证，不去共享 ECS 压测。

## 前端对接不需要云密钥

在本仓库根目录，检查一份独立的前端工作区：

```sh
node scripts/frontend-handoff.mjs check /absolute/path/to/voice_atalas_v2
```

工具只核对文件和补丁，不提交、不推送、不发布。实际应用必须在新的前端集成分支上；完整步骤、冲突处理和发布门槛见 [前端接入步骤](handoff/FRONTEND.md)。

发布前端以后，可运行只读探测：

```sh
node scripts/probe-deployment.mjs
```

HTTP 200 的 HTML 不算接口成功；`503 not-open` 表示后端尚未开放登录，需要后端维护者处理，不是让前端伪造身份。

## 安全与来源

不把 AccessKey、数据库密码、会话密钥、备份私钥、真实用户录音或带签名的播放地址提交到本仓库，也不发给前端或写进 Issue。

本仓库从现有开发快照整理，保留 [代码来源](PROVENANCE.md) 和 [音频来源／许可](data/catalogue/SOURCES.md)，没有擅自为全部代码新增开源许可证。
