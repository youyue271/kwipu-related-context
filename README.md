# Kwipu 相关上下文

这是一个给 Kwipu 使用的 Obsidian 插件。它会读取当前打开的 Markdown 文件，按标题和段落切分内容，只把当前光标所在段落发送给本地 Kwipu HTTP 服务，然后在右侧栏显示相关笔记建议。

插件依赖 Kwipu 后端，不会退化成一个独立的本地搜索插件。

## 当前实现

- `manifest.json`：Obsidian 插件清单。
- `main.js`：可直接运行的插件入口。
- `styles.css`：右侧栏样式。
- `package.json`：基础元信息和 `node --check` 检查命令。

本地 HTTP bridge 位于 Kwipu 主项目的 `kwipu_http_server.py`。

插件目前只支持桌面端，因为它调用本机地址 `http://127.0.0.1:8765`。

## 启动 Kwipu HTTP 服务

打开 Obsidian 前，先在 Windows 侧启动 HTTP 服务：

```powershell
cd D:\project\Kwipu

$env:KWIPU_OLLAMA_HTTP = "1"
$env:KWIPU_VERBOSE = "1"
$env:KWIPU_NUM_CTX = "32768"
$env:KWIPU_GRAPH_PATH_DEPTH = "1"
$env:KWIPU_EMBED_BATCH_SIZE = "1"
$env:KWIPU_EMBED_MAX_CHARS = "4000"
$env:KWIPU_KNOWLEDGE_DIR = "D:\repo"
$env:KWIPU_STORAGE_DIR = "D:\repo\00 rag storage"
$env:KWIPU_EXCLUDE_DIRS = "00 rag storage;.obsidian;.git;node_modules"
$env:KWIPU_EXCLUDE_DIR_PREFIXES = "00;01;02"

python kwipu_http_server.py --llm-model qwen3.6:35b-a3b-q4_K_M --embed-model bge-m3:567m
```

健康检查：

```powershell
curl http://127.0.0.1:8765/health
```

## 安装到 Obsidian

把本目录复制或软链接到 vault 的插件目录：

```text
D:\repo\.obsidian\plugins\kwipu-related-context
```

目录中至少需要包含：

```text
manifest.json
main.js
styles.css
```

然后在 Obsidian 社区插件设置中启用 `Kwipu 相关上下文`。

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

## 非目标

- 不修改用户笔记。
- 不依赖云服务。
- 不索引非 Markdown 文件。
- 不替代 Obsidian 搜索、反链或图谱视图。
- 不在用户输入时同步扫描整个 vault。
- 不在 Kwipu 不可用时悄悄切换成另一个本地搜索引擎。

## 开发检查

```bash
npm run check
```
