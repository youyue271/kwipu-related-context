# Kwipu 相关上下文

这是一个给 Kwipu 使用的 Obsidian 插件。它会读取当前打开的 Markdown 文件，按标题和段落切分内容，只把当前光标所在段落发送给本地 Kwipu HTTP 服务，然后在右侧栏显示相关笔记建议。

插件依赖 Kwipu 后端，不会退化成一个独立的本地搜索插件。

## 当前实现

- `manifest.json`：Obsidian 插件清单。
- `main.js`：可直接运行的插件入口。
- `styles.css`：右侧栏样式。
- `package.json`：基础元信息和 `node --check` 检查命令。
- `.env.example`：Kwipu、vault、storage 和模型配置模板。
- `scripts/`：Windows 侧启动、健康检查、安装和更新脚本。

本地 HTTP bridge 位于 Kwipu 主项目的 `kwipu_http_server.py`。本仓库暂时不复制后端实现，只提供脚本启动主项目里的后端入口，避免两份后端脚本版本漂移。

插件目前只支持桌面端，因为它调用本机地址 `http://127.0.0.1:8765`。

## 完整安装流程

以下命令都在 Windows PowerShell 中运行。

### 1. 准备 Ollama 模型

确认本机 Ollama 能看到需要的模型：

```powershell
ollama list
```

推荐配置：

```text
LLM: qwen3.6:35b-a3b-q4_K_M
Embedding: bge-m3:567m
```

如果缺少 embedding 模型：

```powershell
ollama pull bge-m3:567m
```

### 2. 复制配置

进入插件仓库，复制 `.env.example` 为 `.env`：

```powershell
cd D:\project\Kwipu\obsidian-related-context
Copy-Item .env.example .env
notepad .env
```

按你的机器修改这些值：

```text
KWIPU_PROJECT_DIR=D:\project\Kwipu
KWIPU_KNOWLEDGE_DIR=D:\repo
KWIPU_STORAGE_DIR=D:\repo\00 rag storage
KWIPU_LLM_MODEL=qwen3.6:35b-a3b-q4_K_M
KWIPU_EMBED_MODEL=bge-m3:567m
```

`KWIPU_KNOWLEDGE_DIR` 是 Obsidian vault。`KWIPU_STORAGE_DIR` 是 Kwipu RAG storage，推荐放在 vault 下并加入排除目录，例如 `D:\repo\00 rag storage`，这样多设备同步时 storage 路径相对稳定，但插件不会把缓存写进普通笔记。

### 3. 首次建库

如果 `KWIPU_STORAGE_DIR` 还没有建好，首次启动 HTTP 服务时 Kwipu 会读取 vault 并创建索引。这个过程会调用 embedding 和 LLM，耗时取决于文件数量、模型上下文和显卡负载。

默认排除：

```text
00 rag storage;.obsidian;.git;node_modules
00;01;02 开头的目录
```

目前 Kwipu 侧建议只索引 Markdown 文件。

### 4. 启动 HTTP 服务

打开 Obsidian 前，先在 Windows 侧启动本地 HTTP 服务：

```powershell
cd D:\project\Kwipu\obsidian-related-context
.\scripts\start-kwipu-server.ps1
```

健康检查：

```powershell
cd D:\project\Kwipu\obsidian-related-context
.\scripts\check-kwipu-health.ps1
```

健康检查会请求 `/health`，并显示后端当前的 knowledge、storage、LLM 和 embedding 模型。

### 5. 安装或更新 Obsidian 插件

首次安装：

```powershell
cd D:\project\Kwipu\obsidian-related-context
.\scripts\install-plugin.ps1
```

后续更新：

```powershell
cd D:\project\Kwipu\obsidian-related-context
.\scripts\update-plugin.ps1
```

脚本会复制插件文件到：

```text
D:\repo\.obsidian\plugins\kwipu-related-context
```

复制内容包括：

```text
manifest.json
main.js
styles.css
README.md
TODO.md
scripts/
```

如果目标目录中已有 `data.json`，安装和更新脚本都会保留它。`data.json` 是 Obsidian 插件设置和缓存，不会被覆盖。

### 6. 在 Obsidian 中启用

1. 打开 Obsidian。
2. 进入设置，关闭安全模式或启用社区插件。
3. 启用 `Kwipu 相关上下文`。
4. 执行命令 `打开 Kwipu 相关上下文`，或在右侧栏打开插件视图。
5. 打开一篇 Markdown 笔记，把光标放在要查询的段落。

插件只会查询当前光标所在段落。

## 最小测试流程

先确认后端在线：

```powershell
cd D:\project\Kwipu\obsidian-related-context
.\scripts\check-kwipu-health.ps1
```

再直接请求 `/related`：

```powershell
$body = @{
  filePath = "test.md"
  sectionId = "manual-test"
  sectionText = "刑法中的犯罪构成通常包括客观要件、主观要件、违法性和责任判断。"
  topK = 3
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8765/related" `
  -ContentType "application/json; charset=utf-8" `
  -Body $body |
  ConvertTo-Json -Depth 8
```

期望返回：

```json
{
  "ok": true,
  "answer": "中文解释...",
  "related": [
    {
      "path": "03 collection/Law/犯罪构成.md",
      "reason": "中文相关原因"
    }
  ]
}
```

最后在 Obsidian 中打开右侧栏，光标放到同类段落上，确认能看到 Markdown 回答和 `[[相关笔记]]` 双链卡片。

## 使用方式

1. 启动 `kwipu_http_server.py`。
2. 打开 Obsidian。
3. 启用并打开 `Kwipu 相关上下文` 右侧栏。
4. 打开一篇 Markdown 笔记。
5. 把光标放在当前正在阅读或编辑的段落。
6. 右侧栏只查询这个当前段落，并显示中文相关建议。

插件缓存键为：

```text
文件路径 + 段落 ID + 段落内容 hash
```

如果段落内容没有变化，会直接使用缓存。同一段落正在查询时，插件会复用进行中的请求，避免重复打到后端。

## 交互行为

- 右侧栏只显示当前光标所在段落的建议。
- 点右侧栏不会让当前段落识别跳走。
- Kwipu 返回内容会按 Markdown 渲染。
- 相关文件会在回答下方显示为 Obsidian 双链。
- 查询结果要求使用中文回答。

示例：

```text
Kwipu 相关上下文

当前文件：03 collection/Law/刑法总论.md

当前段落：犯罪构成要件……
- [[03 collection/Law/犯罪构成]]
- [[03 collection/Law/违法性]]
- [[03 collection/Law/责任]]
```

## 路径解析

插件会从 Kwipu 的 Markdown 回答中提取候选路径，再解析为 Obsidian vault 内的笔记。

支持的形式包括：

- `folder/note.md`
- `[note](folder/note.md)`
- `[[folder/note]]`
- 带本机前缀但包含 `03 collection/` 的路径
- `Law/...` 自动映射到 `03 collection/Law/...`

如果仍然无法打开笔记，Obsidian 开发者控制台会打印原始路径、规范化路径和候选路径。

长期更好的方案是让 `kwipu_http_server.py` 返回结构化结果，例如：

```json
{
  "ok": true,
  "answer": "中文解释...",
  "related": [
    {
      "path": "03 collection/Law/犯罪构成.md",
      "reason": "与当前段落都讨论构成要件。"
    }
  ]
}
```

这样插件就不需要从模型回答文本里解析路径。

## 缓存策略

缓存数据保存在 Obsidian 插件数据目录，不写入用户笔记。

当前缓存包含：

- 每个文件的段落 hash。
- 每个段落的 Kwipu 回答和提取出的相关路径。
- 文件打开次数。
- 相关结果命中次数。

文件编辑后：

- 插件会在防抖延迟后重新切分当前文件。
- 只重新计算当前光标所在段落。
- 内容 hash 未变化时直接读缓存。

## 后台预计算

插件可以在空闲时预计算一小部分常用笔记。

优先级信号：

- 文件打开次数。
- 文件作为相关结果出现的次数。

当前后台预计算批量很小，避免影响正在编辑时的体验。

## 排除规则

默认排除：

- `.obsidian`
- `.trash`
- `00`、`01`、`02` 开头的目录
- 用户在设置中配置的排除目录

## 常见错误

### 502 或连接失败

通常是 HTTP 服务没启动、端口不一致，或 Obsidian 插件设置里的 endpoint 不是 `http://127.0.0.1:8765`。先运行：

```powershell
.\scripts\check-kwipu-health.ps1
```

如果健康检查失败，先重启：

```powershell
.\scripts\start-kwipu-server.ps1
```

### 400 input length exceeds context length

embedding 模型上下文不足。当前配置用 `KWIPU_EMBED_MAX_CHARS=4000` 做本地截断，长文件应按段落截断，避免把整篇笔记送进 embedding。

### WinError 10053

这通常表示 Obsidian 侧超时或取消请求后，Python 服务准备写回响应时连接已经断开。插件已经有超时、取消和重试状态；如果频繁出现，优先看 `/related completed in ...s` 的耗时，必要时降低 `topK` 或减少后台预计算。

### storage 路径错误

确认 `.env` 中：

```text
KWIPU_KNOWLEDGE_DIR=D:\repo
KWIPU_STORAGE_DIR=D:\repo\00 rag storage
KWIPU_EXCLUDE_DIRS=00 rag storage;.obsidian;.git;node_modules
```

`KWIPU_STORAGE_DIR` 不要指向普通笔记目录。若要多设备同步，建议固定为 vault 下的 `00 rag storage`，并在 Kwipu 排除规则中排除它。

### 后端状态没有更新

在插件设置页点击“刷新后端状态”，或重启 Obsidian。插件会读取 `/health` 并检查 storage、模型等指纹变化。

## 非目标

- 不修改用户笔记。
- 不依赖云服务。
- 不索引非 Markdown 文件。
- 不替代 Obsidian 搜索、反链或图谱视图。
- 不在用户输入时同步扫描整个 vault。
- 不在 Kwipu 不可用时悄悄切换成另一个本地搜索引擎。

## 开发检查

```bash
npm test
npm run check
```
