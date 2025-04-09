# Ciallo TTS - 在线文本转语音工具

Ciallo TTS 是一款免费的在线文本转语音工具，支持多种声音选择，可调节语速和语调，提供即时试听和下载功能。

## 功能特点

- 🎯 支持超过300种不同语言和口音的声音
- 🔊 实时预览和试听功能
- ⚡ 支持长文本自动分段处理
- 🎛️ 可调节语速和语调
- 📱 响应式设计，支持移动端
- 💾 支持音频下载
- 📝 历史记录功能（最多保存50条）

## 部署指南

### Cloudflare Pages 部署

1. Fork 本仓库到你的 GitHub 账号

2. 登录 Cloudflare Dashboard，进入 Pages 页面

3. 创建新项目，选择从 Git 导入：
   - 选择你 fork 的仓库
   - 构建设置：
     - 构建命令：留空
     - 输出目录：`/`
     - 环境变量：无需设置

4. 部署完成后，你会获得一个 `xxx.pages.dev` 的域名

### Vercel 部署

1. Fork 本仓库到你的 GitHub 账号

2. 登录 Vercel，点击 "New Project"

3. 导入你 fork 的仓库：
   - Framework Preset: 选择 "Other"
   - Build Settings：
     - Build Command: 留空
     - Output Directory: `./`
     - Install Command: 留空

4. 点击 Deploy，等待部署完成

## 项目结构 

```
.
├── index.html # 主页面
├── style.css # 样式文件
├── script.js # 主要逻辑
└── speakers.json # 讲述人配置
```