# Text Memory · 外源记忆库

Text Memory 是一个面向 Chromium 浏览器的本地外源记忆扩展。它把长期任务、来源资料、版本化记忆、记忆候选与跨 AI 对话上下文放在浏览器本地管理，并尽量把“已保存到本地”“已插入输入框”“已发送”“已确认事实”等状态明确区分，避免把本地保存误写成模型已经永久记住。

当前版本：**0.12.2**

## 当前支持

正式扩展目前面向以下站点：

- ChatGPT
- DeepSeek
- Kimi
- Grok
- Claude
- 千问

仓库代码中仍保留部分 Gemini 预览/实验性适配痕迹，但当前版本不把 Gemini 作为已支持、已验收站点，也不承诺其可用性。

## 主要能力

- 本地资料库、任务、来源与版本化记忆管理
- 记忆候选审核，而不是让模型输出直接覆盖已确认事实
- 来源与证据检查、冲突控制、旧异步结果拒绝
- 跨 AI 网站上下文整理、插入与发送状态区分
- 备份/恢复与内建功能自检
- 六站主题化角色装饰与软团子交互反馈

## 安装

该仓库中的 **`extension/` 是实际浏览器扩展目录**。

1. 下载或克隆仓库。
2. Chrome 打开 `chrome://extensions/`；Edge 打开 `edge://extensions/`。
3. 开启“开发者模式”。
4. 选择“加载已解压的扩展程序”。
5. **选择仓库里的 `extension/` 目录**，不要选择 `tests/standalone/product/`。

`extension/manifest.json` 当前要求 Chromium 116 或更高版本。

## 测试

`tests/standalone/` 来自项目开发阶段的独立 localhost 验收框架。它会从正式 `extension/` 生成一个经过测试环境桥接处理的 `product/` 副本，因此：

> **`tests/standalone/product/` 仅用于 localhost 自动化验收，不能作为 Chrome/Edge 扩展加载。**

从仓库根目录运行：

```bash
npm run prepare:test
npm test
npm run verify:test
```

也可以进入 `tests/standalone/` 后运行 `python serve.py --port 8814`，再访问本地测试页。

## 数据与权限

扩展以浏览器本地存储为核心，不在仓库中内置用户账号、Cookie、API Key 或真实个人记忆库。站点权限通过 Manifest V3 的可选站点权限声明获取。

## 非官方角色素材说明

`extension/assets/companions/` 中的 24 张角色装饰图由本项目使用生成式 AI 制作并在本地裁剪整理，是围绕相关 AI 服务设计的**非官方二创视觉素材**。它们不是对应公司的官方角色或品牌素材，也不表示任何合作、授权、赞助或背书关系。

代码许可证见 [LICENSE](LICENSE)。角色素材的来源与处理说明见 `extension/assets/companions/README.md`。

## 项目结构

```text
extension/                  实际可加载的浏览器扩展
  manifest.json
  core/                     外源记忆、来源、任务、检索、协议等核心逻辑
  adapters/                 AI 网站输入/发送/回复与反馈适配
  soft-body/                软团子表情、物理与交互
  assets/companions/        非官方生成式 AI 二创角色素材

tests/standalone/           独立 localhost 验收框架
LICENSE                     代码许可证
```

## 说明

本项目不隶属于或代表上述 AI 服务提供商。网页 DOM 和站点风控策略可能随时变化，因此站点适配需要以实际浏览器表现为准。

## Inspiration & Acknowledgements

The soft interactive AI blob was inspired by an idea I encountered while working on a worldbook status-bar UI. That concept encouraged me to make the AI interface feel more expressive, tactile, and playful rather than purely functional.

The current mascot system, interaction mechanics, expressions, character-specific behaviors, and memory integration were independently redesigned and developed for Memi.

Special thanks to the original creator of that status-bar concept for the inspiration.
