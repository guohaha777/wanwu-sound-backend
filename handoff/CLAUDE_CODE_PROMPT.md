# 给前端 Claude Code 的启动提示词

把下面整段交给负责原前端仓库的 Claude Code。它是交接任务说明，不替代操作者自己的授权边界。

```text
你负责万物声谱前端接入，不负责重新开发后端，也不要重做已定稿视觉。

前端仓库：https://github.com/guohaha777/voice_atalas_v2
后端与交接仓库：https://github.com/wudaizii/wanwu-sound-backend
目标 H5：https://voiceatalass.netlify.app
后端：https://wanwu-api.proterm.ink

先只读检查两个工作区、当前分支和未提交改动。没有后端交接工作区时，可克隆公开仓库到与前端并列的新目录，不能覆盖现有目录或把后端克隆到前端内部。
先完整阅读后端仓库的 AGENTS.md、README.md、handoff/START_HERE.md、handoff/FRONTEND.md、handoff/ACCEPTANCE.md、docs/STATUS.md。
再阅读前端仓库自己的 AGENTS.md／CLAUDE.md；有冲突就报告，不用交接文件覆盖操作者明确的限制。

按以下阶段推进：
1. 列出真实状态、目标文件、已有改动和配置归属。不要假定 Netlify 分支叫 main 或 v2。
2. 从后端仓库运行 frontend-handoff.mjs check，目标是前端仓库绝对路径。补丁基线为 35000af3005609b6b02356023dba680233d69cd8。
3. 基线相符且工作区干净时，在新的前端集成分支应用补丁，再 verify。否则保留现有工作，比较差异并提出逐文件移植方案；禁止强行覆盖、reset --hard、--3way 或静默忽略错误。
4. 在前端执行 npm ci、npm test、npm run build、npm run test:ui。缺浏览器时按文档安装对应 Chromium。保留实际输出，无法运行的项标为未执行。
5. 确认根 netlify.toml 使用同源 /api/v1 代理，优先于 SPA 回退；前端不要持有 OSS／数据库／会话密钥。不要改成跨源 Cookie 请求或 localStorage 登录 token。
6. 只有得到操作者针对发布的授权并拥有站点权限，才处理 Netlify 发布。否则停在已测试的集成分支，列出需要他手工配置的项。
7. 发布后运行后端仓库的 probe-deployment.mjs，再按 ACCEPTANCE.md 做真实业务验收。503 not-open 要交给后端维护者启用账号服务；不能伪造身份头、假登录或关闭 CSRF／Origin 检查来绕过。

不要读取或上传密钥、密码、Cookie、签名 URL、真实孩子录音。不要动 ECS、Nginx、DNS、RAM、旧 ProTerm／Supabase、Docker 设置或生产认证开关；这些由后端维护者另行授权处理。
保留访客当前创作；登录后只在用户主动确认时迁入账号；上传不自动进入个人库或共享库，两者都要老师试听确认。
音频塑形、背景与节奏参数保持交接版本；如果确实需要修改，给出前后端同步方案和音频回归，不要只改一端。

完成后给出：改动文件、前端提交 SHA（若获准提交）、执行命令与结果、实际部署 URL（若获准发布）、每项验收证据、未完成项、需要后端维护者或项目负责人处理的事项。
先从只读检查和交接文档开始，再推进到本机集成；文档中的部署步骤不等于已经获得部署授权。
```

Claude Code 的项目入口是根 `CLAUDE.md`；多步骤内容保留在本目录，避免把所有过程塞进一个超长指令文件。参考：[Claude Code 项目说明文件](https://code.claude.com/docs/en/memory)。
