const {
  ItemView,
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
  return firstLine ? firstLine.trim().slice(0, 80) : "Untitled section";
}

function extractPaths(answer) {
  const paths = new Set();
  const text = String(answer || "");
  const bracketPattern = /\[([^\]\n]+\.md)\]/g;
  const plainPattern = /(?:^|\s)([^\s\[\]()]+(?:\/|\\)[^\s\[\]()]+\.md)/g;
  let match;

  while ((match = bracketPattern.exec(text)) !== null) {
    paths.add(match[1]);
  }
  while ((match = plainPattern.exec(text)) !== null) {
    paths.add(match[1]);
  }
  return Array.from(paths).slice(0, 8);
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
    return "Kwipu Related Context";
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
      text: "Kwipu Related Context",
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

    if (!this.plugin.state.sections.length) {
      container.createDiv({
        cls: "kwipu-related-context__empty",
        text: this.plugin.state.emptyMessage,
      });
      return;
    }

    for (const section of this.plugin.state.sections) {
      this.renderSection(container, section);
    }
  }

  renderSection(container, section) {
    const sectionEl = container.createDiv({ cls: "kwipu-related-context__section" });
    sectionEl.createDiv({
      cls: "kwipu-related-context__section-title",
      text: titleForSection(section),
    });
    sectionEl.createDiv({
      cls: "kwipu-related-context__section-meta",
      text: `Lines ${section.startLine + 1}-${section.endLine + 1}`,
    });
    sectionEl.createDiv({
      cls: "kwipu-related-context__excerpt",
      text: normalizeText(section.text).slice(0, 180),
    });

    if (section.loading) {
      sectionEl.createDiv({
        cls: "kwipu-related-context__status",
        text: "Querying Kwipu...",
      });
      return;
    }

    if (section.error) {
      sectionEl.createDiv({
        cls: "kwipu-related-context__status",
        text: section.error,
      });
      return;
    }

    if (section.paths && section.paths.length) {
      const pathsEl = sectionEl.createDiv({ cls: "kwipu-related-context__paths" });
      for (const path of section.paths) {
        const button = pathsEl.createEl("button", {
          cls: "kwipu-related-context__path",
          text: path,
        });
        button.addEventListener("click", () => this.plugin.openPath(path));
      }
    }

    sectionEl.createDiv({
      cls: "kwipu-related-context__answer",
      text: section.answer || "No related files returned yet.",
    });
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
    containerEl.createEl("h2", { text: "Kwipu Related Context" });

    new Setting(containerEl)
      .setName("Kwipu HTTP endpoint")
      .setDesc("Local Kwipu server endpoint.")
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
      .setName("Debounce")
      .setDesc("Milliseconds to wait after file/editor changes before querying Kwipu.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.debounceMs)).onChange(async (value) => {
          this.plugin.settings.debounceMs = Number(value) || DEFAULT_SETTINGS.debounceMs;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Max results per section")
      .setDesc("Passed to the Kwipu related endpoint.")
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
      .setName("Max sections per file")
      .setDesc("Limits per-active-file requests.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.maxSectionsPerFile)).onChange(async (value) => {
          this.plugin.settings.maxSectionsPerFile =
            Number(value) || DEFAULT_SETTINGS.maxSectionsPerFile;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Excluded directories")
      .setDesc("Semicolon or comma separated.")
      .addText((text) =>
        text.setValue(this.plugin.settings.excludeDirs).onChange(async (value) => {
          this.plugin.settings.excludeDirs = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Excluded directory prefixes")
      .setDesc("Semicolon or comma separated.")
      .addText((text) =>
        text.setValue(this.plugin.settings.excludePrefixes).onChange(async (value) => {
          this.plugin.settings.excludePrefixes = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Idle precompute")
      .setDesc("Use idle time to precompute frequently opened notes.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.idlePrecompute).onChange(async (value) => {
          this.plugin.settings.idlePrecompute = value;
          await this.plugin.saveSettings();
        })
      );
  }
}

module.exports = class KwipuRelatedContextPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.cache = this.settings.cache || this.createEmptyCache();
    this.state = {
      status: "Idle",
      filePath: "",
      sections: [],
      emptyMessage: "Open a Markdown file to query Kwipu.",
    };
    this.activeTimer = null;
    this.idleTimer = null;
    this.currentRun = 0;

    this.registerView(VIEW_TYPE, (leaf) => new RelatedContextView(leaf, this));
    this.addSettingTab(new RelatedContextSettingsTab(this.app, this));

    this.addRibbonIcon("network", "Open Kwipu Related Context", () => {
      this.activateView();
    });
    this.addCommand({
      id: "open-kwipu-related-context",
      name: "Open Kwipu Related Context",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "recompute-kwipu-related-context",
      name: "Recompute Kwipu Related Context for current file",
      callback: () => this.recomputeActiveFile(true),
    });
    this.addCommand({
      id: "clear-kwipu-related-cache",
      name: "Clear Kwipu Related Context cache",
      callback: async () => {
        this.cache = this.createEmptyCache();
        await this.saveSettings();
        new Notice("Kwipu related context cache cleared.");
        this.scheduleActiveFileUpdate(true);
      },
    });

    this.registerEvent(
      this.app.workspace.on("active-file-change", () => this.scheduleActiveFileUpdate(false))
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => this.scheduleActiveFileUpdate(false))
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.isIncludedMarkdown(file)) this.markIndexDirty();
      })
    );

    this.scheduleActiveFileUpdate(false);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  createEmptyCache() {
    return {
      version: CACHE_VERSION,
      files: {},
      stats: {},
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
        status: "Idle",
        filePath: "",
        sections: [],
        emptyMessage: "Open a Markdown file to query Kwipu.",
      };
      this.renderViews();
      return;
    }

    this.recordOpen(file.path);
    this.state.status = "Reading";
    this.state.filePath = file.path;
    this.renderViews();

    const text = await this.app.vault.cachedRead(file);
    const sections = this.splitSections(file.path, text).slice(0, this.settings.maxSectionsPerFile);
    if (runId !== this.currentRun) return;

    this.state.sections = sections.map((section) => Object.assign({}, section, { loading: true }));
    this.state.status = "Querying";
    this.state.emptyMessage = "No sections found.";
    this.renderViews();

    for (let i = 0; i < sections.length; i += 1) {
      if (runId !== this.currentRun) return;
      const result = await this.getRelatedForSection(file, sections[i], force);
      this.state.sections[i] = Object.assign({}, sections[i], result, { loading: false });
      this.renderViews();
      await this.saveSettings();
    }

    this.state.status = "Done";
    this.renderViews();
    this.scheduleIdlePrecompute();
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
        error: "",
      };
    }

    try {
      const response = await this.callKwipuRelated(file.path, section);
      const answer = response.answer || "";
      const paths = extractPaths(answer);
      this.cache.files[file.path] = fileCache;
      fileCache.sections[section.sectionId] = {
        hash: section.hash,
        answer,
        paths,
        computedAt: Date.now(),
      };
      this.recordRelatedHits(paths);
      this.cache.indexDirty = false;
      return { answer, paths, error: "" };
    } catch (error) {
      const message = `Kwipu unavailable: ${error.message || error}`;
      return {
        answer: cached ? cached.answer : "",
        paths: cached ? cached.paths || [] : [],
        error: message,
      };
    }
  }

  async callKwipuRelated(filePath, section) {
    const response = await fetch(`${this.settings.endpoint.replace(/\/$/, "")}/related`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath,
        sectionId: section.sectionId,
        sectionText: section.text,
        topK: this.settings.maxResultsPerSection,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
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
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    } else {
      new Notice(`File not found: ${path}`);
    }
  }
};
