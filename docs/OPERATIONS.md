# 部署与运维：只供获授权的后端维护者

前端接入者不需要执行本页。上传 GitHub 不等于允许变更云端；本次没有更新 ECS、开启认证或发布 Netlify。

## 已有服务与新源码

现有 ECS 上的 Wanwu 服务来自此前单仓库候选镜像，已有独立 API／PG／媒体进程和 HTTPS 入口。本次拆分改变了示例数据路径与镜像构建上下文；必须重新构建并验证新源码，不能直接把新 Compose 模板覆盖到服务器。

服务器无宿主 Node，普通开发用户没有 Docker／免密 sudo 权限。不要为套用脚本而安装宿主 Node、提升普通用户权限，或把旧 Supabase 当作新库。

## 发布前门槛

- 在本机／CI 构建并锁定 image 内容摘要、源码摘要、迁移和配置；不在共享 ECS build 或压测。
- 执行独立 Linux API／媒体沙箱／资源测试；Chromium 必须启用 namespace、PID／network namespace 与 seccomp，不用 `--no-sandbox` 或 privileged。
- 变更前后核对旧站健康。可用内存至少 2.5 GiB，装载镜像后磁盘至少 8 GiB；不足就停，不挤占旧服务。
- 发布只操作 `/srv/wudaizii/wanwu-sound`，Compose 项目 `wanwu-sound`，独立网络／卷／日志；宿主 API 只绑定 127.0.0.1:3100，PG 和媒体不开放宿主端口。
- 现有正式配置在 root 保护的 `/etc/wanwu-sound`。root 不应执行普通开发账号可替换的脚本或环境文件。

## 工具顺序

```sh
# 本机或获授权 CI；本地 Docker 不可用就停止，不切到 ECS：
npm test
npm run build
npm run test:api
npm run test:media
npm run test:worker:runtime
npm run test:operations
npm run release:build -- --archive
# 按实际生成路径替换：
npm run test:release -- artifacts/releases/<id>/deployment
```

Docker／内核验证未通过时，不升级共享主机或降低隔离绕过。`build` 只检查源码，不证明 Linux 镜像已验证。

发布包的镜像引用校验使用 `deploy/runtime/resolve-images.mjs` 和 `image-pins.ts`。导入后只接受已记录的 image／config digest，不使用浮动标签。迁移保持向后兼容，先保留上一版配置和镜像。

Nginx 只改独立新配置。不要打印可能包含旧秘密的完整 `nginx -T`；完整 `nginx -t` 通过后才 graceful reload，不重启共享 Nginx／Docker，不改旧域名和证书。

## 开启真实 H5 联调

1. 前端维护者先完成 JSON API 代理和经批准的前端部署。
2. 后端维护者核对当前数据库／迁移、内置音源、媒体心跳，创建首个管理员。`admin-cli.ts` 只读受保护 stdin，不把密码放命令参数、历史或本仓库。
3. 实测最后代理连接 IP，写入精确信任列表；不照抄旧网关地址或信任整个 Docker 子网。
4. 经授权受控启用 `session`，只发测试邀请，逐项跑 `handoff/ACCEPTANCE.md`。失败保持／恢复 disabled，不用身份头或假会话替代。
5. 前后端共同确认完整闭环后再安排小范围试用；不要把无登录健康检查当作上线验收。

## 备份、清理和回滚

数据库备份是 PG 自定义 dump，经 AES-GCM 加密并用离线私钥对应的公钥封装。服务器只保留公钥，备份进入独立私有前缀，计划保留 30 天。

目前只有单次真实备份、独立本机恢复和单次清理的历史通过记录。每日备份、定期清理和健康任务尚待真正安装、执行和验证，RPO 24 小时／RTO 4 小时仍是目标。

`deploy/runtime/wanwu-*.service.example` 是模板。现有 ECS 的用户／Node／root 路径不适配，**不能直接启用**；需要审核 root 持有的固定动作适配器和只属于 Wanwu 的新单元。不提升普通账号 Docker／sudo 权限。

恢复只允许新建空的 `wanwu_sound_restore_<8位十六进制>` 数据库，不能指向生产或旧 Supabase，不使用 drop／clean。文件回收检查作品、素材库、发布和任务引用并保留 7 天宽限；临时上传 24 小时后清理。

故障只停止或回滚 Wanwu 的 API／媒体镜像；不 `down -v`、不全局 prune、不倒退或删除数据库。回滚和恢复必须实际演练，不能因为提供了命令就标为通过。
