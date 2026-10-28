# 微信已安装表情合集

## 使用方式

在匹配微信 4.1.10.27 中下载合集并保持登录，开启对应聊天的原生表情开关。应用新代码并重启读取服务、消息桥和 DSH 后，聊天模型可使用 `wechat_sticker_pack_search` 按场景检索，再用 `wechat_sticker_pack_select` 选择一张。

合集图片直接来自当前账号的微信本地缓存。选中的图片经过 MD5 完整性校验后，作为短期资源交给现有 GIF 表情发送和服务器回执校验流程。不会调用表情池导入，不受 50 张表情池上限限制。发送链路使用 GIF 表情，不附带微信商店的整套商品详情或下载入口。

## 本地读取接口

沿用 `Authorization: Bearer <reader token>`，仅监听本机。

| 方法和路径 | 参数 | 作用 |
| --- | --- | --- |
| `GET /api/v1/sticker-packs` | `offset=0`, `limit=50` | 已下载合集名称和数量，每页最多 100 套 |
| `GET /api/v1/sticker-packs/items` | `packId`, `query`, `offset=0`, `limit=50` | 合集内配文，每页最多 100 张 |
| `GET /api/v1/sticker-packs/search` | `conversationKey`, `query`, `limit=3` | 按配文、关键词和本地场景词检索，最多三条候选 |
| `POST /api/v1/sticker-packs/prepare` | JSON: `conversationKey`, `id` | 校验目录成员、只解码选中图片，生成当前聊天的临时发送资源 |

目录响应包含 `source: "wechat-installed-packs"`。`sendSupported` 表示当前读取器配置了受支持版本的解码器和发送缓存，不代替登录状态或发送回执。目录里的 `id` 是账号内的目录引用，不能直接当发送 ID；`prepare` 成功返回的 `id` 才能放入 `[STICKER:...]`。

桌面控制台保留已认证的只读代理 `/api/sticker-packs`、`/api/sticker-packs/items`、`/api/sticker-packs/search`。尚未添加合集浏览管理界面。

## 模型与上下文

新增两个模型工具：搜索返回最多三条短配文和合集名；选择工具只接受本轮搜索结果，每轮最多选一张，并与现有图库工具共享选图次数。搜索和准备都重新检查账号、白名单及原生表情开关，无需开启联网搜索或第三方表情图库。

图像文件、缓存密钥和整包目录不会进入模型上下文。本地索引读取及排名本身不调用模型；使用工具会产生少量工具定义、请求和结果 token。检索是配文关键词和场景词扩展，没有命中时返回空列表；未进行全库视觉理解。

可单发表情，或文字后换行加表情标记。微信黄脸表情仍通过客户端支持的中文方括号名称发送。

## 缓存、权限和版本

SQLCipher 只读连接查询当前账号的 `emoticon.db`，数据库和 WAL 变化会使短期目录缓存失效。`PersistStore` 是账号相关的 AES-128-CBC 缓存；程序只读访问配置指定的微信进程、核对已适配的模块位置和账号访问入口，在内存里获取缓存密钥，不保存或返回密钥。按选中图片的偏移读取必要密文块，并核验微信记录的原图 MD5。

微信退出、账号切换、权限撤销、文件缺失、未知版本或校验失败会拒绝准备。临时发送资源绑定账号和聊天，最多 16 张、32 MiB、保留 10 分钟；发送时再次检查权限，仅写入受现有发送器校验的临时 outgoing 目录，不写入 collected 表情池。

适配依据是 4.1.10.27 的本地缓存和账号布局。升级微信需要重新适配，不能假设其他版本兼容。当前实现不需要重新编译 Hook DLL。

## 验证

```powershell
python -B -m unittest discover -s scripts -p 'test_sticker_pack*.py' -v
node --test scripts/test-sticker-packs.mjs scripts/test-reply-protocol.mjs
```

自动测试使用合成缓存、临时数据库和独立本机端口，覆盖偏移解码、篡改拒绝、权限撤销、跨聊天隔离、当前轮选图和临时资源，不发送真实消息。真实部署还需检查当前账号合集解码以及实际微信发送回执。
