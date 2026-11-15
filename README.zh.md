# dsh-ccswitch-sync

[English](README.md) · [npm](https://www.npmjs.com/package/dsh-ccswitch-sync) · [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) · [插件目录](https://dshtui.com/plugins)

把 **CC Switch** 写在自己 profile 里的 DSH 配置，镜像进 `dsh-tui` profile 的
[dsh-TUI](https://dshtui.com) 插件；底栏顺带显示这份镜像有多新。

CC Switch 把 `llm-pi-ai.providers` 和 `cc-switch-mcp-*` 写进
`~/.dsh/profiles/web/cordis.patch.yml`（没有就退到 `desktop`）。dsh-TUI 跑的是自己的
profile `~/.dsh/profiles/dsh-tui`，所以那些 provider 与 MCP 在 TUI 里一个都看不见。
本插件把 CC Switch 的镜像逻辑搬进了插件自己：同一套文本拼接，在 TUI 进程内执行，
再用一个底栏字段告诉你镜像是不是新鲜的。

```
ccs 3p 4mcp 1m        ← 3 个 provider、4 个 MCP、1 分钟前写入
```

## 安装

```sh
# 从 npm 装
dsh plugin --profile dsh-tui add dsh-ccswitch-sync

# 或从本地检出装
dsh plugin --profile dsh-tui add link:/path/to/dsh-ccswitch-sync
```

终端里 `/plugin install <spec>` 同样可用。装完**重启 dsh-TUI**——bundle 只在新进程启动时
组合。

```sh
dsh plugin --profile dsh-tui remove dsh-ccswitch-sync
```

## 用法

| | |
| --- | --- |
| `/ccswitch` | provider 数、MCP 数、patch 年龄 |
| `/ccswitch sync` | 立刻镜像一次（会重写 profile 补丁，见下） |
| 底栏字段 `ccswitch` | 同样的计数，每 60 秒刷新；`slot` 选项可放 `left-tail` / `right-head` / `right-tail` |

底栏字段属于插件字段：`/settings → statusBar.pluginFields` 能关掉它，
`statusBar.pluginFieldsOrder` 能按槽组给它排序。关掉字段不影响命令。

## 什么时候同步

**它不会自己同步。** 安装、激活、重载、切会话都不会动 profile：

- `/ccswitch sync` —— 现在镜像一次。
- `DSH_CCSWITCH_SYNC_ON_START=1` —— 显式选择「激活时镜像一次」。
- 没有文件监听，没有会写盘的定时器。唯一的定时器只刷新底栏文本。

这个默认值是刻意的。dsh-TUI 的 profile 是 `patchReload: live`：写
`cordis.patch.yml` 会重载整份组合——而跑这个插件的那一行就写在同一份文件里。
激活即镜像等于让插件重载刚刚激活它的 profile。改成手动，那次重载才是一个明确的动作。

## 镜像怎么做的

托管的行会进目标补丁末尾的一个标记区块：

```yaml
# >>> cc-switch sync (managed) >>>
- id: llm-pi-ai
  config:
    providers: { ... }
- insert:
    - id: cc-switch-mcp-context7
      ...
# <<< cc-switch sync (managed) <<<
```

- **文本拼接，不是 YAML 往返。** 区块逐字节照搬，注释、顺序、引号风格都不会被改写。
  没有 YAML 依赖，也就没有重新序列化带来的意外。
- **幂等。** 拼装结果与当前文件逐字节比较，一样就一个字节都不写：`mtime` 不变，
  不触发重载。这是让 live reload 不打转的关键。
- **原子写。** 先写 `<patch>.candidate.yml`，再 rename 覆盖目标。
- **留备份。** 每次重写前把旧补丁拷到 `~/.dsh-tui/ccswitch-sync/backups/`，保留最新 20 份。
- **只动标记以内。** 区块外若残留一条 `llm-pi-ai`，会被去掉（否则组合里会有两条）；
  区块之外的其他行一律不碰。
- **来源优先。** 有 `web` 就镜像 `web`，否则用 `desktop`。

## 不碰什么

- `~/.dsh/.credentials.yaml` 与任何凭证。provider 条目引用的是 `CC_SWITCH_DSH_*`
  环境变量名，密钥留在 CC Switch 放的位置。
- `~/.dsh/skills` 与任何共享技能树。
- 托管区块以外的行，以及其他所有 profile。
- CC Switch 自己的文件：只读，不写。

## 声明的权限

`dsh-plugin.json` 里正好三条（`/plugin` 的授权矩阵显示同样的行）：

| 权限 | 范围 |
| --- | --- |
| `dsh-ccswitch-sync.profile.read` | `~/.dsh/profiles/{web,desktop}/cordis.patch.yml` |
| `dsh-ccswitch-sync.profile.write` | `~/.dsh/profiles/dsh-tui/cordis.patch.yml` |
| `dsh-ccswitch-sync.state.write` | `~/.dsh-tui/ccswitch-sync/` |

权限是行为声明，不是 OS 沙箱：与任何 dsh-TUI 插件一样，这段代码以进程内全信任
（`trusted-in-process`）运行，拥有你终端的权限。

## 卸载与残留数据

`disable` 把行标成 `disabled`；`remove` 把 bundle 从 profile 里摘掉。两者都是普通的、
可复原的 profile 操作。**它们都不删用户数据**，所以 `remove` 之后还会留下：

| 残留 | 位置 |
| --- | --- |
| 补丁备份与 `plugin.log` | `~/.dsh-tui/ccswitch-sync/` |
| profile 补丁里的托管区块 | `~/.dsh/profiles/dsh-tui/cordis.patch.yml` |

要把备份删干净，删那个目录即可。要去掉托管区块，删掉两行 `# >>>` / `# <<<` 标记
以及它们之间的内容——下次 `/ccswitch sync` 会重新造出来。

## 兼容性

- dsh-TUI ≥ 0.20.0（用到两个宿主接缝：底栏字段 `tuiStatus.setField` 与 `commands` 服务）。
  两者都经 `ctx.inject` 软探测；缺了其中一个时插件退化为空操作，不会拖垮启动。
- 清单：Community v0.15（`dsh-plugin.json`），facet `v1alpha1`。
- Node `^22.19 || >=24`，纯 ESM，零运行时依赖。
- Windows / macOS / Linux。路径全部来自 `DSH_HOME` 与 `~`，没有写死的盘符。

## 开发

```sh
node --test test/sync.test.mjs     # 拼接逻辑：幂等、标记、残留行
node scripts/check-manifest.mjs    # 无依赖的清单形状检查
```

权威校验器是 Community v0.15 parser（`@dsh-std/manifest`）；本仓库的 `dsh-plugin.json`
在 `0.1.1-rc.2` 下 parse 与 project 均通过。

## 链接

- dsh-TUI：<https://github.com/ccch1mneyyy/dsh-TUI> · <https://dshtui.com>
- 插件准入与开发指南：
  <https://github.com/ccch1mneyyy/dsh-TUI/blob/main/tui-profile/docs/plugin-admission-and-development.md>
- 生态组织：<https://github.com/dsh-tui-ecosystem>

## 许可

MIT。
