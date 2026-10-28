# 前端接入：按顺序执行

前端仓库：[guohaha777/voice_atalas_v2](https://github.com/guohaha777/voice_atalas_v2)。本仓库不接管它的所有权或发布权限。

## 1. 先检查，不要覆盖

在前端工作区执行 `git status --short --branch`，保存现有工作。不要运行 `reset --hard`，不要为了套补丁删除作者的新页面或声音参数。

两个仓库建议放在并列的新工作区，不要把后端克隆进前端仓库内部，否则会产生未跟踪目录或嵌套 Git 工作区。

用 Node 24.21，在本仓库根目录执行（替换为实际绝对路径）：

```sh
node scripts/frontend-handoff.mjs check /absolute/path/to/voice_atalas_v2
```

它检查补丁 SHA-256、每个受影响文件的基线指纹、目标仓库身份和工作区状态。`manifest.json` 记录基线及预期结果；没有密钥。

如果返回 baseline differs／dirty／symlink，停下来比较差异。不能使用 `--reject`、`--3way`、忽略错误或直接覆盖解决。Windows 等环境若做了自动换行转换，也需要先解释指纹差异；不要误报已应用。

## 2. 在前端集成分支上应用

在前端工作区新建分支，例如：

```sh
git switch -c integrate/wanwu-backend-v1
```

回到本仓库，执行：

```sh
node scripts/frontend-handoff.mjs apply /absolute/path/to/voice_atalas_v2
node scripts/frontend-handoff.mjs verify /absolute/path/to/voice_atalas_v2
```

`apply` 不提交、不推送、不发布。工具拒绝在 `main`、`master`、`v2` 或 detached HEAD 上应用；重复应用完整相同结果时返回 already-applied。应用后先看 `git diff --stat`、`git diff --check`，再 review 具体文件。

## 3. 补丁包含什么

- 真实 Cookie／CSRF 账号客户端、注册登录／改密／恢复入口；不会返回假登录成功。
- 云端草稿、冲突副本、原始录音保留与上传进度、素材库试听确认、书架／成品任务、匿名分享页、最小管理页面。
- 共享 `contracts` 和 `audio-engine` 源码快照。它们不是 API 服务，前端仓库可以保留这两个客户端共用包。
- 根工作区只含前端和共用包，**不包含 `apps/api`、`apps/worker`，也不要求前端拉后端密钥或启动后端容器**。
- `netlify.toml`：API 代理在前、SPA 回退在后；移除会抢先拦截 API 的旧 `apps/web/public/_redirects`。
- 前端独立的单元和浏览器布局测试，不再导入后端测试运行器。

没有重做已定稿的视觉，也没有主动改写音乐规则。前后端共用文件的确切版本在 `manifest.json` 的 sharedFiles 中；规则有新改动时两边协商同步，不要各改一套后还沿用旧版本号。

## 4. 在前端仓库验证

```sh
npm ci
npm test
npm run build
# 首次本机可能需要安装对应 Chromium：
npx playwright install chromium
npm run test:ui
```

构建产物仍为 `apps/web/dist`。30 个页面／屏宽场景覆盖基础布局，但不等于真实登录、手机麦克风或云端保存通过。

如果原作者近期有修改，补丁不能原样套用，可参考补丁逐模块合入；完成后重新测试，并记录哪些文件不再匹配交接指纹。不要把人工移植结果谎称为自动验证完全相同。

## 5. Netlify 配置（仅由有权限者在发布授权后处理）

目标站点为 `voiceatalass.netlify.app`。Base directory 使用工作区根；构建命令 `npm run build`，Publish directory 为 `apps/web/dist`，Node 24.21。实际生产分支必须在控制台核对；旧 README 曾写过 v2，不能据此假定当前就是它。

根 `netlify.toml` 已带 `/api/v1/*` → `https://wanwu-api.proterm.ink/api/v1/:splat` 的 200 代理，且排在 SPA 回退前。不另写一条优先级更高的全站回退，不加永久密钥，不将 Cookie 登录改成 localStorage token。

前端不需要 `VITE_OSS_ACCESS_KEY`、数据库 URL 或后端会话密钥，也不要把 API 客户端改成跨源 fetch。预览域名不在当前精确 Origin／CORS 范围内时，不能用预览站登录失败证明生产站不可用，或私自放开通配符。

发布之后在本仓库运行 `node scripts/probe-deployment.mjs`。前端健康必须是 JSON；后端认证关闭时探测会明确阻塞，不能忽略退出码。

## 6. 与后端维护者联调

前端路由正确后，把真实 Origin 和发布时间给后端维护者；由其创建管理员、核对精确代理 IP，并按授权受控开启 session。前端作者不需要 root 或任何生产凭据。

双方按 [ACCEPTANCE.md](ACCEPTANCE.md) 验收。交接完成报告要写清：前端提交 SHA、发布分支、部署 URL、JSON 代理检查、Cookie／CSRF、上传、草稿冲突、成品和分享／撤销的实际结果。
