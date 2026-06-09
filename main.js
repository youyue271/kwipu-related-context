const {
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} = require("obsidian");

const VIEW_TYPE = "kwipu-related-context-view";
const CACHE_VERSION = 1;

const DEFAULT_SETTINGS = {
  endpoint: "http://127.0.0.1:8765",
  debounceMs: 1200,
  maxResultsPerSection: 5,
  maxSectionsPerFile: 12,
  minSectionChars: 20,
  requestTimeoutMs: 60000,
  excludeDirs: ".obsidian;.trash;00 rag storage",
  excludePrefixes: "00;01;02",
  idlePrecompute: true,
  idleDelayMs: 5000,
};

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function hashString(text) {
  let hash = 2166136261;
  const input = String(text || "");
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseList(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function titleForSection(section) {
  if (section.heading) return section.heading;
  const firstLine = section.text.split(/\r?\n/).find((line) => line.trim());
  return firstLine ? firstLine.trim().slice(0, 80) : "未命名段落";
}

function extractPaths(answer) {
  const paths = new Set();
  const text = String(answer || "");
  const markdownLinkPattern = /\[[^\]\n]*\]\(([^)\n]+?)(?:\s+"[^"]*")?\)/g;
  const wikiLinkPattern = /\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g;
  const bracketPattern = /\[([^\]\n]+?\.md(?:#[^\]\n]+)?)\]/g;
  let match;

  while ((match = markdownLinkPattern.exec(text)) !== null) {
    paths.add(match[1]);
  }
  while ((match = wikiLinkPattern.exec(text)) !== null) {
    paths.add(match[1]);
  }
  while ((match = bracketPattern.exec(text)) !== null) {
    paths.add(match[1]);
  }
  for (const line of text.split(/\r?\n/)) {
    const plain = line
      .trim()
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^>\s+/, "");
    if (/\[[^\]\n]*\]\(/.test(plain) || plain.includes("[[")) continue;
    if (!plain.includes(".md") || !/[\\/]/.test(plain)) continue;
    const end = plain.indexOf(".md") + 3;
    paths.add(plain.slice(0, end));
  }
  return Array.from(new Set(Array.from(paths).map(cleanResultPath).filter(Boolean))).slice(0, 8);
}

function normalizeRelatedItem(item) {
  if (typeof item === "string") {
    const path = cleanResultPath(item);
    return path ? { path, title: "", reason: "", score: null, source: "" } : null;
  }
  if (!item || typeof item !== "object") return null;
  const path = cleanResultPath(item.path || item.filePath || item.file || "");
  if (!path) return null;
  const score = typeof item.score === "number" ? item.score : null;
  return {
    path,
    title: String(item.title || item.name || "").trim(),
    reason: String(item.reason || item.explanation || item.summary || "").trim(),
    score,
    source: String(item.source || item.sourceType || item.retriever || "").trim(),
  };
}

function normalizeRelatedResponse(response) {
  const answer = String((response && response.answer) || "");
  const structured = Array.isArray(response && response.related)
    ? response.related.map(normalizeRelatedItem).filter(Boolean)
    : [];
  const related = structured.length
    ? structured
    : extractPaths(answer).map((path) => ({ path, title: "", reason: "", score: null, source: "" }));
  const paths = Array.from(new Set(related.map((item) => item.path).filter(Boolean)));
  return { answer, related, paths };
}

function formatRelatedMeta(item) {
  const meta = [];
  if (item && typeof item.score === "number") meta.push(`相关度 ${item.score.toFixed(2)}`);
  if (item && item.source) meta.push(`来源：${item.source}`);
  if (item && item.path) meta.push(item.path);
  return meta.join(" · ");
}

function applyRelatedPreferences(items, cache) {
  const pinned = (cache && cache.pinnedRelated) || {};
  const ignored = (cache && cache.ignoredRelated) || {};
  return (items || [])
    .filter((item) => item && item.path && !ignored[item.path])
    .map((item) => Object.assign({}, item, { pinned: Boolean(pinned[item.path]) }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

function formatQueryMeta(result) {
  const parts = [];
  if (result && result.source === "cache") parts.push("缓存");
  else if (result && result.source === "backend") parts.push("后端");
  if (result && result.elapsedMs > 0) {
    const elapsed = result.elapsedMs < 1000
      ? `${Math.round(result.elapsedMs)}ms`
      : `${(result.elapsedMs / 1000).toFixed(1)}s`;
    parts.push(elapsed);
  }
  return parts.join(" · ");
}

function removeCachePath(cache, path) {
  if (!cache || !path) return false;
  let changed = false;
  if (cache.files && cache.files[path]) {
    delete cache.files[path];
    changed = true;
  }
  if (cache.stats && cache.stats[path]) {
    delete cache.stats[path];
    changed = true;
  }
  if (removeRelatedReferences(cache, path)) changed = true;
  if (changed) cache.indexDirty = true;
  return changed;
}

function migrateCachePath(cache, oldPath, newPath) {
  if (!cache || !oldPath || !newPath || oldPath === newPath) return false;
  let changed = false;
  cache.files = cache.files || {};
  cache.stats = cache.stats || {};
  if (cache.files[oldPath]) {
    cache.files[newPath] = cache.files[oldPath];
    delete cache.files[oldPath];
    changed = true;
  }
  if (cache.stats[oldPath]) {
    cache.stats[newPath] = cache.stats[oldPath];
    delete cache.stats[oldPath];
    changed = true;
  }
  if (migrateRelatedReferences(cache, oldPath, newPath)) changed = true;
  if (changed) cache.indexDirty = true;
  return changed;
}

function removeRelatedReferences(cache, path) {
  if (!cache || !cache.files || !path) return false;
  let changed = false;
  for (const fileCache of Object.values(cache.files)) {
    for (const section of Object.values((fileCache && fileCache.sections) || {})) {
      if (Array.isArray(section.paths) && section.paths.includes(path)) {
        section.paths = section.paths.filter((item) => item !== path);
        changed = true;
      }
      if (Array.isArray(section.related) && section.related.some((item) => item && item.path === path)) {
        section.related = section.related.filter((item) => item && item.path !== path);
        changed = true;
      }
    }
  }
  return changed;
}

function migrateRelatedReferences(cache, oldPath, newPath) {
  if (!cache || !cache.files || !oldPath || !newPath) return false;
  let changed = false;
  for (const fileCache of Object.values(cache.files)) {
    for (const section of Object.values((fileCache && fileCache.sections) || {})) {
      if (Array.isArray(section.paths)) {
        section.paths = section.paths.map((item) => {
          if (item === oldPath) {
            changed = true;
            return newPath;
          }
          return item;
        });
      }
      if (Array.isArray(section.related)) {
        section.related = section.related.map((item) => {
          if (item && item.path === oldPath) {
            changed = true;
            return Object.assign({}, item, { path: newPath });
          }
          return item;
        });
      }
    }
  }
  return changed;
}

function backendSignature(data) {
  if (!data || typeof data !== "object") return "";
  return [
    data.knowledgeDir || "",
    data.storageDir || "",
    data.llmModel || data.modelName || "",
    data.embedModel || "",
    data.indexVersion || "",
  ].join("|");
}

function applyBackendSignature(cache, signature) {
  if (!cache || !signature) return false;
  if (cache.backendSignature === signature) return false;
  cache.backendSignature = signature;
  cache.indexDirty = true;
  return true;
}

function formatBackendStatus(status) {
  if (!status || status.ok === false) {
    const lines = ["状态：不可用"];
    if (status && status.error) lines.push(`错误：${status.error}`);
    return lines;
  }
  const lines = ["状态：可用"];
  if (status.knowledgeDir) lines.push(`知识库：${status.knowledgeDir}`);
  if (status.storageDir) lines.push(`存储：${status.storageDir}`);
  if (status.llmModel || status.modelName) lines.push(`LLM：${status.llmModel || status.modelName}`);
  if (status.embedModel) lines.push(`Embedding：${status.embedModel}`);
  if (status.indexVersion) lines.push(`索引：${status.indexVersion}`);
  return lines;
}

function cleanResultPath(path) {
  const value = String(path || "")
    .replace(/\\/g, "/")
    .replace(/^file:\/+/, "")
    .replace(/[?#].*$/, "")
    .replace(/^["'`[\s]+|["'`\]\s.,;:，。；：]+$/g, "")
    .replace(/^\/+/, "");
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function isMarkdown(file) {
  return file instanceof TFile && file.extension === "md";
}

class RelatedContextView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Kwipu 相关上下文";
  }

  getIcon() {
    return "network";
  }

  async onOpen() {
    this.render();
  }

  render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("kwipu-related-context");

    const header = container.createDiv({ cls: "kwipu-related-context__header" });
    header.createDiv({
      cls: "kwipu-related-context__title",
      text: "Kwipu 相关上下文",
    });
    header.createDiv({
      cls: "kwipu-related-context__status",
      text: this.plugin.state.status,
    });

    if (this.plugin.state.filePath) {
      container.createDiv({
        cls: "kwipu-related-context__file",
        text: this.plugin.state.filePath,
      });
    }

    if (!this.plugin.state.section) {
      container.createDiv({
        cls: "kwipu-related-context__empty",
        text: this.plugin.state.emptyMessage,
      });
      return;
    }

    this.renderSection(container, this.plugin.state.section);
  }

  renderSection(container, section) {
    const sectionEl = container.createDiv({ cls: "kwipu-related-context__section" });
    sectionEl.createDiv({
      cls: "kwipu-related-context__section-title",
      text: titleForSection(section),
    });
    sectionEl.createDiv({
      cls: "kwipu-related-context__section-meta",
      text: `第 ${section.startLine + 1}-${section.endLine + 1} 行`,
    });
    sectionEl.createDiv({
      cls: "kwipu-related-context__excerpt",
      text: normalizeText(section.text).slice(0, 180),
    });

    if (section.loading) {
      sectionEl.createDiv({
        cls: "kwipu-related-context__status",
        text: "正在查询 Kwipu...",
      });
      return;
    }

    if (section.error) {
      const errorEl = sectionEl.createDiv({ cls: "kwipu-related-context__error" });
      errorEl.createDiv({
        cls: "kwipu-related-context__status",
        text: section.error,
      });
      const retryButton = errorEl.createEl("button", {
        cls: "kwipu-related-context__retry",
        text: "重试",
      });
      retryButton.addEventListener("click", () => this.plugin.recomputeActiveFile(true));
      if (!section.answer && !this.plugin.getRelatedItems(section).length) return;
    }

    const answerEl = sectionEl.createDiv({
      cls: "kwipu-related-context__answer markdown-rendered",
    });
    this.renderMarkdown(answerEl, section.answer || "暂时没有返回相关文件。");

    const queryMeta = formatQueryMeta(section);
    if (queryMeta) {
      sectionEl.createDiv({
        cls: "kwipu-related-context__query-meta",
        text: queryMeta,
      });
    }

    if (this.plugin.getRelatedItems(section).length) {
      this.renderRelatedCards(sectionEl, section);
    }
  }

  renderRelatedCards(container, section) {
    const groupEl = container.createDiv({ cls: "kwipu-related-context__related" });
    groupEl.createDiv({
      cls: "kwipu-related-context__related-heading",
      text: "相关笔记",
    });

    for (const item of this.plugin.getRelatedItems(section)) {
      const cardEl = groupEl.createDiv({ cls: "kwipu-related-context__related-card" });
      const titleEl = cardEl.createDiv({
        cls: "kwipu-related-context__related-title markdown-rendered",
      });
      this.renderMarkdown(titleEl, this.plugin.formatRelatedLinkMarkdown(item));

      if (item.reason) {
        cardEl.createDiv({
          cls: "kwipu-related-context__related-reason",
          text: item.reason,
        });
      }

      const meta = formatRelatedMeta(item);
      if (meta) {
        cardEl.createDiv({
          cls: "kwipu-related-context__related-meta",
          text: meta,
        });
      }

      const actionsEl = cardEl.createDiv({ cls: "kwipu-related-context__related-actions" });
      const pinButton = actionsEl.createEl("button", {
        cls: "kwipu-related-context__related-action",
        text: item.pinned ? "取消固定" : "固定",
      });
      pinButton.addEventListener("click", () => this.plugin.togglePinnedRelated(item.path));
      const insertButton = actionsEl.createEl("button", {
        cls: "kwipu-related-context__related-action",
        text: "插入双链",
      });
      insertButton.addEventListener("click", () => this.plugin.insertRelatedLink(item));
      const ignoreButton = actionsEl.createEl("button", {
        cls: "kwipu-related-context__related-action",
        text: "忽略",
      });
      ignoreButton.addEventListener("click", () => this.plugin.ignoreRelated(item.path));
    }
  }

  renderMarkdown(container, markdown) {
    const sourcePath = this.plugin.state.filePath || "";
    try {
      if (MarkdownRenderer.renderMarkdown) {
        MarkdownRenderer.renderMarkdown(markdown, container, sourcePath, this);
      } else {
        MarkdownRenderer.render(this.app, markdown, container, sourcePath, this);
      }
    } catch (error) {
      container.setText(markdown);
    }
  }
}

class RelatedContextSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Kwipu 相关上下文" });
    this.renderBackendStatus(containerEl);

    new Setting(containerEl)
      .setName("Kwipu HTTP 地址")
      .setDesc("本地 Kwipu 服务地址。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.endpoint)
          .setValue(this.plugin.settings.endpoint)
          .onChange(async (value) => {
            this.plugin.settings.endpoint = value.trim() || DEFAULT_SETTINGS.endpoint;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("防抖延迟")
      .setDesc("文件或编辑器变化后，等待多少毫秒再查询 Kwipu。")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.debounceMs)).onChange(async (value) => {
          this.plugin.settings.debounceMs = Number(value) || DEFAULT_SETTINGS.debounceMs;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("每段最大结果数")
      .setDesc("传给 Kwipu 相关上下文接口的 topK。")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.maxResultsPerSection))
          .onChange(async (value) => {
            this.plugin.settings.maxResultsPerSection =
              Number(value) || DEFAULT_SETTINGS.maxResultsPerSection;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("每个文件最大段落数")
      .setDesc("限制后台预计算时每个文件处理的段落数量。")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.maxSectionsPerFile)).onChange(async (value) => {
          this.plugin.settings.maxSectionsPerFile =
            Number(value) || DEFAULT_SETTINGS.maxSectionsPerFile;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("请求超时")
      .setDesc("单次 Kwipu 查询最长等待毫秒数。")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.requestTimeoutMs)).onChange(async (value) => {
          this.plugin.settings.requestTimeoutMs =
            Number(value) || DEFAULT_SETTINGS.requestTimeoutMs;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("排除目录")
      .setDesc("用分号或逗号分隔。")
      .addText((text) =>
        text.setValue(this.plugin.settings.excludeDirs).onChange(async (value) => {
          this.plugin.settings.excludeDirs = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("排除目录前缀")
      .setDesc("用分号或逗号分隔。")
      .addText((text) =>
        text.setValue(this.plugin.settings.excludePrefixes).onChange(async (value) => {
          this.plugin.settings.excludePrefixes = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("空闲预计算")
      .setDesc("空闲时预计算常打开笔记的相关上下文。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.idlePrecompute).onChange(async (value) => {
          this.plugin.settings.idlePrecompute = value;
          await this.plugin.saveSettings();
        })
      );
  }

  renderBackendStatus(containerEl) {
    const statusEl = containerEl.createDiv({ cls: "kwipu-related-context__settings-status" });
    statusEl.createEl("h3", { text: "后端状态" });
    const status = this.plugin.backendStatus || { ok: false, error: "尚未刷新" };
    for (const line of formatBackendStatus(status)) {
      statusEl.createDiv({ text: line });
    }
    new Setting(statusEl)
      .setName("刷新后端状态")
      .setDesc("请求 /health 并更新 storage、模型和索引状态。")
      .addButton((button) =>
        button.setButtonText("刷新").onClick(async () => {
          await this.plugin.refreshBackendSignature();
          this.display();
        })
      );
  }
}

module.exports = class KwipuRelatedContextPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.cache = this.settings.cache || this.createEmptyCache();
    this.cache.pinnedRelated = this.cache.pinnedRelated || {};
    this.cache.ignoredRelated = this.cache.ignoredRelated || {};
    this.state = {
      status: "空闲",
      filePath: "",
      section: null,
      emptyMessage: "打开 Markdown 文件后开始查询 Kwipu。",
    };
    this.activeTimer = null;
    this.idleTimer = null;
    this.currentRun = 0;
    this.lastEditorCursor = { filePath: "", line: 0 };
    this.inflightRelated = new Map();
    this.activeAbortController = null;
    this.activeRequestKey = "";
    this.backendStatus = null;

    this.registerView(VIEW_TYPE, (leaf) => new RelatedContextView(leaf, this));
    this.addSettingTab(new RelatedContextSettingsTab(this.app, this));

    this.addRibbonIcon("network", "打开 Kwipu 相关上下文", () => {
      this.activateView();
    });
    this.addCommand({
      id: "open-kwipu-related-context",
      name: "打开 Kwipu 相关上下文",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "recompute-kwipu-related-context",
      name: "重新计算当前段落的 Kwipu 相关上下文",
      callback: () => this.recomputeActiveFile(true),
    });
    this.addCommand({
      id: "clear-kwipu-related-cache",
      name: "清空 Kwipu 相关上下文缓存",
      callback: async () => {
        this.cache = this.createEmptyCache();
        await this.saveSettings();
        new Notice("已清空 Kwipu 相关上下文缓存。");
        this.scheduleActiveFileUpdate(true);
      },
    });

    this.registerEvent(
      this.app.workspace.on("active-file-change", () => this.scheduleActiveFileUpdate(false))
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => this.scheduleActiveFileUpdate(false))
    );
    this.registerDomEvent(document, "selectionchange", () => {
      if (this.isMarkdownEditorFocused()) this.scheduleActiveFileUpdate(false);
    });
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.isIncludedMarkdown(file)) this.markIndexDirty();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (file instanceof TFile && removeCachePath(this.cache, file.path)) {
          await this.saveSettings();
          this.renderViews();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFile && migrateCachePath(this.cache, oldPath, file.path)) {
          await this.saveSettings();
          this.renderViews();
        }
      })
    );

    this.refreshBackendSignature();
    this.scheduleActiveFileUpdate(false);
  }

  onunload() {
    if (this.activeAbortController) this.activeAbortController.abort();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  createEmptyCache() {
    return {
      version: CACHE_VERSION,
      files: {},
      stats: {},
      pinnedRelated: {},
      ignoredRelated: {},
      indexDirty: false,
    };
  }

  async saveSettings() {
    this.settings.cache = this.cache;
    await this.saveData(this.settings);
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (!leaves.length) {
      await this.app.workspace.getRightLeaf(false).setViewState({
        type: VIEW_TYPE,
        active: true,
      });
    }
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]);
    this.renderViews();
    this.scheduleActiveFileUpdate(false);
  }

  renderViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view && leaf.view.render) leaf.view.render();
    }
  }

  scheduleActiveFileUpdate(force) {
    window.clearTimeout(this.activeTimer);
    this.activeTimer = window.setTimeout(
      () => this.recomputeActiveFile(Boolean(force)),
      this.settings.debounceMs
    );
  }

  async recomputeActiveFile(force) {
    const runId = ++this.currentRun;
    const file = this.app.workspace.getActiveFile();
    if (!this.isIncludedMarkdown(file)) {
      this.state = {
        status: "空闲",
        filePath: "",
        section: null,
        emptyMessage: "打开 Markdown 文件后开始查询 Kwipu。",
      };
      this.renderViews();
      return;
    }

    this.recordOpen(file.path);
    this.state.status = "读取中";
    this.state.filePath = file.path;
    this.renderViews();

    const text = await this.app.vault.cachedRead(file);
    const sections = this.splitSections(file.path, text);
    const cursorLine = this.getActiveCursorLine(file.path);
    const currentSection = this.findSectionForLine(sections, cursorLine);
    if (runId !== this.currentRun) return;

    if (!currentSection) {
      this.state.section = null;
      this.state.status = "空闲";
      this.state.emptyMessage = "当前光标位置没有可查询的段落。";
      this.renderViews();
      return;
    }

    this.state.section = Object.assign({}, currentSection, { loading: true });
    this.state.status = "查询中";
    this.renderViews();

    const result = await this.getRelatedForSection(file, currentSection, force);
    if (runId !== this.currentRun) return;
    this.state.section = Object.assign({}, currentSection, result, { loading: false });
    this.renderViews();
    await this.saveSettings();

    this.state.status = "完成";
    this.renderViews();
    this.scheduleIdlePrecompute();
  }

  getActiveCursorLine(filePath) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    try {
      if (view && view.editor && view.file && view.file.path === filePath) {
        const line = view.editor.getCursor().line;
        this.lastEditorCursor = { filePath, line };
        return line;
      }
      if (this.lastEditorCursor.filePath === filePath) return this.lastEditorCursor.line;
      return 0;
    } catch (error) {
      return this.lastEditorCursor.filePath === filePath ? this.lastEditorCursor.line : 0;
    }
  }

  isMarkdownEditorFocused() {
    const activeElement = document.activeElement;
    if (!activeElement || !activeElement.closest) return false;
    if (!activeElement.closest(".markdown-source-view, .markdown-preview-view, .cm-editor")) {
      return false;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return Boolean(view && view.editor);
  }

  findSectionForLine(sections, line) {
    if (!sections.length) return null;
    const direct = sections.find((section) => line >= section.startLine && line <= section.endLine);
    if (direct) return direct;
    let nearest = sections[0];
    for (const section of sections) {
      if (section.startLine <= line) nearest = section;
      else break;
    }
    return nearest;
  }

  splitSections(filePath, text) {
    const lines = String(text || "").split(/\r?\n/);
    const sections = [];
    let heading = "";
    let buffer = [];
    let startLine = 0;

    const flush = (endLine) => {
      const body = buffer.join("\n").trim();
      if (!body) {
        buffer = [];
        return;
      }
      if (
        body.length < this.settings.minSectionChars &&
        !body.includes("[[") &&
        !body.includes("#")
      ) {
        buffer = [];
        return;
      }
      const index = sections.length;
      const normalized = normalizeText(body);
      sections.push({
        sectionId: hashString(`${filePath}|${heading}|${index}|${startLine}`),
        hash: hashString(normalized),
        heading,
        startLine,
        endLine: Math.max(startLine, endLine),
        text: body,
      });
      buffer = [];
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const isHeading = /^#{1,6}\s+/.test(line);
      const isBlank = !line.trim();
      if (isHeading) {
        flush(i - 1);
        heading = line.replace(/^#{1,6}\s+/, "").trim();
        startLine = i;
        buffer = [line];
      } else if (isBlank && buffer.length) {
        flush(i - 1);
        startLine = i + 1;
      } else {
        if (!buffer.length) startLine = i;
        buffer.push(line);
      }
    }
    flush(lines.length - 1);
    return sections;
  }

  async getRelatedForSection(file, section, force) {
    const fileCache = this.cache.files[file.path] || { sections: {} };
    const cached = fileCache.sections[section.sectionId];
    const requestKey = `${file.path}|${section.sectionId}|${section.hash}|${this.settings.maxResultsPerSection}`;
    if (
      !force &&
      cached &&
      cached.hash === section.hash &&
      cached.answer &&
      !this.cache.indexDirty
    ) {
      return {
        answer: cached.answer,
        paths: cached.paths || [],
        related: cached.related || (cached.paths || []).map((path) => ({ path })),
        source: "cache",
        elapsedMs: 0,
        error: "",
      };
    }
    if (!force && this.inflightRelated.has(requestKey)) {
      return this.inflightRelated.get(requestKey);
    }

    const request = this.fetchRelatedForSection(file, section, fileCache, cached, requestKey).finally(() => {
      this.inflightRelated.delete(requestKey);
    });
    this.inflightRelated.set(requestKey, request);
    return request;
  }

  async fetchRelatedForSection(file, section, fileCache, cached, requestKey) {
    const startedAt = Date.now();
    try {
      const response = await this.callKwipuRelated(file.path, section, requestKey);
      const elapsedMs = Date.now() - startedAt;
      const { answer, paths, related } = normalizeRelatedResponse(response);
      this.cache.files[file.path] = fileCache;
      fileCache.sections[section.sectionId] = {
        hash: section.hash,
        answer,
        paths,
        related,
        computedAt: Date.now(),
      };
      this.recordRelatedHits(paths);
      this.cache.indexDirty = false;
      return { answer, paths, related, source: "backend", elapsedMs, error: "" };
    } catch (error) {
      const message = error && error.name === "AbortError"
        ? "Kwipu 查询已取消或超时。"
        : `Kwipu 不可用：${error.message || error}`;
      return {
        answer: cached ? cached.answer : "",
        paths: cached ? cached.paths || [] : [],
        related: cached ? cached.related || (cached.paths || []).map((path) => ({ path })) : [],
        source: cached ? "cache" : "",
        elapsedMs: Date.now() - startedAt,
        error: message,
      };
    }
  }

  async callKwipuRelated(filePath, section, requestKey) {
    if (
      this.activeAbortController &&
      this.activeRequestKey &&
      this.activeRequestKey !== requestKey
    ) {
      this.activeAbortController.abort();
    }
    const controller = new AbortController();
    this.activeAbortController = controller;
    this.activeRequestKey = requestKey;
    const timeout = window.setTimeout(() => controller.abort(), this.settings.requestTimeoutMs);
    const response = await fetch(`${this.settings.endpoint.replace(/\/$/, "")}/related`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        filePath,
        sectionId: section.sectionId,
        sectionText: section.text,
        topK: this.settings.maxResultsPerSection,
      }),
    }).finally(() => {
      window.clearTimeout(timeout);
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
        this.activeRequestKey = "";
      }
    });
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  isIncludedMarkdown(file) {
    if (!isMarkdown(file)) return false;
    const parts = file.path.split("/");
    const excludedDirs = new Set(parseList(this.settings.excludeDirs));
    const prefixes = parseList(this.settings.excludePrefixes);
    return !parts.some((part) => excludedDirs.has(part) || prefixes.some((prefix) => part.startsWith(prefix)));
  }

  recordOpen(path) {
    const stats = this.cache.stats[path] || {};
    stats.openCount = (stats.openCount || 0) + 1;
    stats.lastOpenedAt = Date.now();
    this.cache.stats[path] = stats;
  }

  recordRelatedHits(paths) {
    for (const path of paths) {
      const stats = this.cache.stats[path] || {};
      stats.relatedHitCount = (stats.relatedHitCount || 0) + 1;
      stats.lastRelatedAt = Date.now();
      this.cache.stats[path] = stats;
    }
  }

  markIndexDirty() {
    this.cache.indexDirty = true;
    this.scheduleIdlePrecompute();
  }

  async refreshBackendSignature() {
    try {
      const response = await fetch(`${this.settings.endpoint.replace(/\/$/, "")}/health`);
      const data = await response.json();
      this.backendStatus = Object.assign({}, data, { ok: response.ok && data.ok });
      if (response.ok && data.ok && applyBackendSignature(this.cache, backendSignature(data))) {
        await this.saveSettings();
      }
    } catch (error) {
      this.backendStatus = { ok: false, error: error.message || String(error) };
    }
  }

  scheduleIdlePrecompute() {
    window.clearTimeout(this.idleTimer);
    if (!this.settings.idlePrecompute) return;
    this.idleTimer = window.setTimeout(() => this.runIdlePrecompute(), this.settings.idleDelayMs);
  }

  async runIdlePrecompute() {
    const candidates = Object.entries(this.cache.stats)
      .sort((a, b) => {
        const scoreA = (a[1].openCount || 0) * 2 + (a[1].relatedHitCount || 0);
        const scoreB = (b[1].openCount || 0) * 2 + (b[1].relatedHitCount || 0);
        return scoreB - scoreA;
      })
      .slice(0, 3)
      .map(([path]) => path);

    const active = this.app.workspace.getActiveFile();
    for (const path of candidates) {
      if (active && active.path === path) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!this.isIncludedMarkdown(file)) continue;
      const text = await this.app.vault.cachedRead(file);
      const sections = this.splitSections(file.path, text).slice(0, 2);
      for (const section of sections) {
        await this.getRelatedForSection(file, section, false);
      }
    }
    await this.saveSettings();
  }

  async openPath(path) {
    const resolution = this.resolveMarkdownPath(path);
    const file = resolution.file;
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    } else {
      console.warn("Kwipu 相关上下文：找不到文件", {
        input: path,
        normalized: resolution.normalized,
        candidates: resolution.candidates,
      });
      new Notice(`找不到文件：${path}`);
    }
  }

  resolveMarkdownPath(path) {
    const normalized = cleanResultPath(path);
    const rawCandidates = [
      normalized,
      normalized.replace(/^.*?(03 collection\/)/, "$1"),
      normalized.replace(/^.*?(Law\/)/, "03 collection/$1"),
    ];
    const candidates = new Set();

    for (const candidate of rawCandidates) {
      if (!candidate) continue;
      candidates.add(candidate);
      if (!candidate.toLowerCase().endsWith(".md")) candidates.add(`${candidate}.md`);
    }

    for (const candidate of candidates) {
      const file = this.app.vault.getAbstractFileByPath(candidate);
      if (file instanceof TFile) return { file, normalized, candidates: Array.from(candidates) };
    }

    const files = this.app.vault.getMarkdownFiles();
    const suffixMatches = files.filter((file) =>
      Array.from(candidates).some((candidate) => file.path.endsWith(candidate))
    );
    if (suffixMatches.length === 1) {
      return { file: suffixMatches[0], normalized, candidates: Array.from(candidates) };
    }

    const basename = normalized.split("/").pop();
    const basenameWithExtension = basename && basename.toLowerCase().endsWith(".md")
      ? basename
      : basename
        ? `${basename}.md`
        : "";
    if (basename) {
      const basenameMatches = files.filter((file) => file.name === basenameWithExtension);
      if (basenameMatches.length === 1) {
        return { file: basenameMatches[0], normalized, candidates: Array.from(candidates) };
      }
      if (basenameMatches.length > 1) {
        const active = this.app.workspace.getActiveFile();
        if (active) {
          const activeParts = active.path.split("/");
          const scored = basenameMatches
            .map((file) => {
              const parts = file.path.split("/");
              let score = 0;
              for (let i = 0; i < Math.min(parts.length, activeParts.length); i += 1) {
                if (parts[i] === activeParts[i]) score += 1;
              }
              return { file, score };
            })
            .sort((a, b) => b.score - a.score);
          return { file: scored[0].file, normalized, candidates: Array.from(candidates) };
        }
        return { file: basenameMatches[0], normalized, candidates: Array.from(candidates) };
      }
    }
    return { file: null, normalized, candidates: Array.from(candidates) };
  }

  toWikiLinkPath(path) {
    const resolution = this.resolveMarkdownPath(path);
    const filePath = resolution.file instanceof TFile ? resolution.file.path : resolution.normalized;
    return String(filePath || "")
      .replace(/\.md$/i, "")
      .replace(/\|/g, " ")
      .replace(/\]\]/g, "]");
  }

  getRelatedItems(section) {
    const related = section.related && section.related.length
      ? section.related
      : (section.paths || []).map((path) => ({ path }));
    return applyRelatedPreferences(related, this.cache);
  }

  formatRelatedLinkMarkdown(item) {
    const title = item.title ? String(item.title).replace(/\|/g, " ").replace(/\]\]/g, "]") : "";
    const linkPath = this.toWikiLinkPath(item.path || "");
    return title ? `[[${linkPath}|${title}]]` : `[[${linkPath}]]`;
  }

  async togglePinnedRelated(path) {
    if (!path) return;
    this.cache.pinnedRelated = this.cache.pinnedRelated || {};
    if (this.cache.pinnedRelated[path]) delete this.cache.pinnedRelated[path];
    else this.cache.pinnedRelated[path] = true;
    await this.saveSettings();
    this.renderViews();
  }

  async ignoreRelated(path) {
    if (!path) return;
    this.cache.ignoredRelated = this.cache.ignoredRelated || {};
    this.cache.ignoredRelated[path] = true;
    if (this.cache.pinnedRelated) delete this.cache.pinnedRelated[path];
    await this.saveSettings();
    this.renderViews();
  }

  async insertRelatedLink(item) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      new Notice("当前没有可插入双链的编辑器。");
      return;
    }
    view.editor.replaceSelection(this.formatRelatedLinkMarkdown(item));
  }
};

module.exports.__test = {
  applyBackendSignature,
  applyRelatedPreferences,
  backendSignature,
  cleanResultPath,
  extractPaths,
  formatBackendStatus,
  formatRelatedMeta,
  normalizeRelatedResponse,
  formatQueryMeta,
  migrateCachePath,
  removeCachePath,
};
