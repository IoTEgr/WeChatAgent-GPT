# WeChatAgent GPT

让 AI 在微信里自然聊天：文字、微信黄脸、颜文字、表情包、语音，以及按需引用、@ 和拍一拍。

基于 [sourcepro5/WeChatAgent](https://github.com/sourcepro5/WeChatAgent) **0.4.1** 持续修改，由 [IoTEgr](https://github.com/IoTEgr) 维护。本仓库当前版本为 **0.4.2**。聊天模型通过 DeepSeek Harness（DSH）连接，GPT 语音走独立的本机登录通道，两者分别配置。

[下载安装包](https://github.com/IoTEgr/WeChatAgent-GPT/releases/latest) · [更新记录](RELEASE_NOTES.md) · [构建与安装](docs/INSTALLER_RELEASE.md) · [问题反馈](https://github.com/IoTEgr/WeChatAgent-GPT/issues)

## 主要功能

| 能力 | 实际行为 |
| --- | --- |
| GPT 自主语音 | DSH 先理解话题并选择回复形式；选择语音后，把人格、相关聊天与摘要交给 GPT-Live 自主组织回答，而非固定朗读文字草稿 |
| 本地表情包库 | 按描述、标签、情绪和场景选图；优先本地图库，再看微信合集，最后考虑共享池 |
| 微信表情合集 | 读取当前账号已下载合集，按需准备选中的单张图片，无需先导入 50 张共享池 |
| 灵活回复 | 文字配一张表情包、单图、纯文字、微信黄脸、颜文字或语音；普通闲聊文字尽量配图，严肃话题不硬配 |
| 原生引用 / @ / 拍一拍 | 通过适配的后台组件发送，引用气泡和拍一拍保留发送端本地显示，无需自动操作微信窗口 |
| 群聊对象判断 | 区分提到名字和明确称呼，结合发言人、引用与近期人类对话判断“你”指谁，对象不清时少插嘴 |
| 自然发送节奏 | 模型生成计入首条打字等待，避免思考结束后重复等待；后续分条保留间隔 |
| 消息补读 | 区分已看与未处理，合并审阅积压，只回应仍重要、仍在问自己的内容 |
| 长期记忆 | 按账号、聊天与模式隔离，保存事实、偏好和未完成约定，支持查询、修改、遗忘与完成 |
| 主动聊天 | 每个聊天可选生活关心、科技分享等主题；科技分享根据真实检索结果组织话题 |
| 图片与语音修复 | 模型超时不再误报图片读取失败；图片事实可供语音参考，按音频时间戳保留真实停顿 |
| 中性深色外观 | 灰色主题，重要按钮、连接和状态采用清楚的强调色 |

同时保留上游的桌面控制台、聊天白名单、人设切换、联网搜索、网页阅读、插件安装、远程助手与文件收发。

## 安装与使用

适用于 **Windows 10 / 11 x64**。到 [Releases](https://github.com/IoTEgr/WeChatAgent-GPT/releases/latest) 下载 `WeChatAgent-Setup-0.4.2-x64.exe`，同页提供校验和与验证说明。

1. 运行安装器并选择根目录。程序放入 `app`，应用配置和运行数据放入同级 `data`。
2. 在首次配置中打开**匹配微信**并登录机器人账号，验证数据库和发送连接。
3. 单独安装 [DeepSeek Harness（DSH）](https://www.deepseek.com/harness/)，配置聊天模型并启用 WeChatAgent 桥接插件。安装包不包含 DSH 桌面程序。
4. 在“聊天”添加允许的好友或群聊，指定人格和参与方式。初始允许范围为空。
5. 按需启用搜索、图片、表情、记忆与语音，然后启动机器人。

**匹配微信固定为 4.1.10.27。** 读取和原生发送依赖特定版本，不能换成任意新版微信直接使用，详见 [微信适配说明](docs/WECHAT_HOOK.md)。

升级前停止机器人，退出 WeChatAgent、DSH 和匹配微信；在相同位置安装可沿用原数据。完成后重新登录并完整重开 DSH，加载新版插件。更换数据位置请使用应用迁移流程并保留原副本。

本分支的“检查更新”指向 **IoTEgr/WeChatAgent-GPT**。上游更新不代表已经合并到本分支，请以本仓库 Release 为准。

## GPT 语音怎样工作

```text
微信消息 → DSH 理解聊天、选择回复形式
            ├─ 文字 / 表情 → 微信发送与回执确认
            └─ 语音 → GPT-Live 按上下文自主回答
                         → 接收音频与转录 → SILK 编码 → 微信语音气泡
```

语音使用本机 Codex 登录组件和**实验性**实时语音通道，默认 Maple，也可选择设置页列出的其他音色。需要另行安装兼容 Codex，并以具备对应能力的 ChatGPT 账号登录；无需把令牌复制到项目，安装包也不带维护者账号。

语音账号与 DSH 聊天模型分开，更换文字模型不会自动改变语音账号。可用性、额度和音色依赖当前账号及实验接口，不保证免费、无限或未来版本兼容。没有保留 Edge TTS 替代引擎。

图片由当前视觉模型先读取，再把经过当前聊天验证的画面事实交给语音服务。明确确认语音尚未提交微信时，失败才改选文字或表情；送达不明时不自动重发。

详见 [语音说明](docs/VOICE_REPLY.md)、[图片输入](docs/IMAGE_INPUT.md)。

## 表情、互动与人格

本地图库、微信已下载合集和共享池是不同来源。每轮只提供少量候选描述，选中后才准备图片，不把几百张图片一起塞进上下文。新用户需要准备自己的素材，发布包不包含维护者收藏的图片。

普通文字回复尽量配一张贴切表情；单图能表达也可以单发。严肃讨论、没有合适素材或对方只要文字时不硬配，不固定重复同一张。微信黄脸使用客户端支持的中文名称。

互动遵循：**引用用于接话，@ 用于找人，拍一拍用于偶尔的熟人互动。** 不每次 @，不因无人回复反复点名或拍一拍。交互对象与消息引用必须来自当前聊天，通过账号、版本和回执校验。

`roles/` 提供通用预设，可导入自己的提示词并分别指定给好友和群聊。人格负责性格和语气，发送格式与权限由后端处理。长期记忆按账号和聊天隔离，记住约定不等于设置提醒。主动聊天按聊天配置主题；人格的作息也可能影响回应。交流对象和潜台词判断依赖模型，仍可能误解。

相关文档：[本地图库](docs/LOCAL_STICKER_LIBRARY.md)、[微信合集](docs/STICKER_PACKS.md)、[互动实现](docs/INTERACTION_EXPERIMENT_STATUS.md)、[聊天规则](docs/SOCIAL_STYLE.md)、[长期记忆](docs/LONG_TERM_MEMORY.md)、[消息补读](docs/MESSAGE_SYNC.md)、[科技分享](docs/TECH_SHARING.md)。

## 助手与插件

聊天模式用于人格交流；助手模式用于从微信交办任务。管理员、工具、联网与文件权限按聊天配置，普通群友聊天不自动获得任务执行权限。

在能力目录导入 WeChatAgent API v2 的 ZIP 插件，查看权限并按聊天启用。插件在独立进程运行，但不构成恶意代码的完整安全沙箱。源码提供可选的鱼的记事本和开发示例；梗百科、dsh-meme 等第三方插件需自行安装，不默认携带维护者安装的插件。

详见 [远程助手](docs/ASSISTANT_REMOTE.md)、[文件收发](docs/FILE_TRANSFER.md)、[插件开发](docs/PLUGIN_DEVELOPMENT.md)、[鱼的记事本](optional-extensions/fish-notebook/README.md)。

## 从源码构建

需要 Windows x64、Node.js 22.13+、npm；编译原生组件还需 Visual Studio C++ 工具。源码不包含微信客户端、外部 Hook 原始项目、原生 DLL、解释器或 `node_modules`，这些资源需按来源和许可单独准备。

```powershell
git clone https://github.com/IoTEgr/WeChatAgent-GPT.git
cd WeChatAgent-GPT
npm ci
npm ci --prefix packages/dsh-social-bridge-plugin
npm test
npm run privacy:check
```

准备已适配的运行组件后构建：

```powershell
npm run desktop:build
npm run installer:runtime
npm run installer:build
```

安装器输出到 `release/installer`。原生发送、引用 / 拍一拍和 @ 组件需要通过版本与哈希校验，新机器所需资源清单见 [发行版构建说明](docs/INSTALLER_RELEASE.md)。

验证使用合成数据、隔离目录和模拟服务，不向真实群友发测试消息。本次实际验证范围见 Release 的 `VERIFICATION.json`，下载校验使用 `SHA256SUMS.txt`。

## 数据与使用范围

账号配置、模型登录、令牌、联系人、白名单、聊天记录、语音缓存、个人表情及用户插件都留在本机，不进入源码或干净安装模板。运行目录中的私人专属人格也不自动公开。

自然参与模式下，普通群消息也可能进入模型判断，即使结果为沉默仍可能产生消耗。启用联网、图片或语音时，也需考虑对应服务的可用性与用量。使用前请了解自己配置的模型连接如何处理允许聊天的内容。

微信、DSH、Codex 和模型服务是独立产品，本项目不是它们的官方客户端；第三方接口变化可能需要重新适配。

## 来源与致谢

- 上游：[sourcepro5/WeChatAgent](https://github.com/sourcepro5/WeChatAgent)，基于 0.4.1，保留提交历史与许可。
- 社交桥接：[Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge)。
- NT 读取：[zhuobichen/weflow-cli](https://github.com/zhuobichen/weflow-cli)。

完整版权、组件来源及再分发边界见 [LICENSE](LICENSE)、[LICENSES.md](LICENSES.md) 和各组件自己的许可文件。
