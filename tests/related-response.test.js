const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

class TFile {
  constructor(path) {
    this.path = path;
    this.name = path.split("/").pop();
    this.extension = "md";
  }
}

function loadPluginModule() {
  const code = fs.readFileSync("main.js", "utf8");
  const sandbox = {
    require(name) {
      if (name !== "obsidian") throw new Error(`unexpected require: ${name}`);
      return {
        ItemView: class {},
        MarkdownRenderer: {},
        MarkdownView: class {},
        Notice: class {},
        Plugin: class {},
        PluginSettingTab: class {},
        Setting: class {},
        TFile,
      };
    },
    module: { exports: {} },
    console,
  };
  vm.runInNewContext(code, sandbox, { filename: "main.js" });
  return sandbox.module.exports;
}

const pluginModule = loadPluginModule();
const {
  applyBackendSignature,
  applyRelatedPreferences,
  buildLocalMetadataIndex,
  formatBackendStatus,
  formatQueryMeta,
  formatRelatedMeta,
  mergeRelatedItems,
  rankIdleCandidatePaths,
  scoreLocalCandidates,
  setLocalMetadataForFile,
  migrateCachePath,
  normalizeRelatedResponse,
  removeCachePath,
} = pluginModule.__test;

assert.strictEqual(typeof normalizeRelatedResponse, "function");

const structured = normalizeRelatedResponse({
  answer: "## 相关说明\n\n这些笔记都讨论犯罪构成。",
  related: [
    {
      path: "03 collection/Law/犯罪构成.md",
      title: "犯罪构成",
      reason: "与当前段落都讨论构成要件。",
      score: 0.91,
      source: "vector",
    },
    {
      path: "Law/责任",
      reason: "都涉及责任判断。",
    },
  ],
});

assert.deepStrictEqual(Array.from(structured.paths), [
  "03 collection/Law/犯罪构成.md",
  "Law/责任",
]);
assert.strictEqual(structured.related.length, 2);
assert.strictEqual(structured.related[0].title, "犯罪构成");
assert.strictEqual(structured.related[0].reason, "与当前段落都讨论构成要件。");
assert.strictEqual(structured.related[0].score, 0.91);
assert.strictEqual(structured.related[0].source, "vector");

assert.strictEqual(formatRelatedMeta({
  path: "03 collection/Law/犯罪构成.md",
  score: 0.91,
  source: "vector",
}), "相关度 0.91 · 来源：vector · 03 collection/Law/犯罪构成.md");

assert.deepStrictEqual(JSON.parse(JSON.stringify(applyRelatedPreferences([
  { path: "b.md", title: "B" },
  { path: "a.md", title: "A" },
  { path: "c.md", title: "C" },
], {
  pinnedRelated: { "a.md": true },
  ignoredRelated: { "c.md": true },
}))), [
  { path: "a.md", title: "A", pinned: true },
  { path: "b.md", title: "B", pinned: false },
]);

const metadataIndex = buildLocalMetadataIndex([
  {
    path: "Law/刑法/当前.md",
    text: "# 犯罪构成\n\n#刑法 [[Law/刑法/责任]] 犯罪 构成 责任",
  },
  {
    path: "Law/刑法/责任.md",
    text: "# 责任\n\n#刑法 [[Law/刑法/当前]] 犯罪 责任 判断",
  },
  {
    path: "Project/API.md",
    text: "# API\n\n#项目 接口 文档",
  },
  {
    path: "Law/刑法/概念.md",
    text: "# 刑法概念\n\n#刑法 犯罪 基础 概念",
  },
]);

assert.deepStrictEqual(JSON.parse(JSON.stringify(metadataIndex["Law/刑法/当前.md"].links)), ["Law/刑法/责任"]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(metadataIndex["Law/刑法/当前.md"].tags)), ["刑法"]);
assert.ok(metadataIndex["Law/刑法/当前.md"].keywords.includes("犯罪"));

const localCandidates = scoreLocalCandidates(
  metadataIndex,
  "Law/刑法/当前.md",
  "犯罪构成与责任判断 #刑法 [[Law/刑法/责任]]",
  3
);
assert.strictEqual(localCandidates[0].path, "Law/刑法/责任.md");
assert.ok(localCandidates[0].score > localCandidates[1].score);
assert.ok(localCandidates[0].reason.includes("直接链接"));
assert.ok(localCandidates[0].reason.includes("反链"));
assert.ok(localCandidates[0].source.includes("local-metadata"));

const mergedRelated = mergeRelatedItems(
  [{ path: "Law/刑法/责任.md", score: 0.9, source: "vector" }],
  localCandidates,
  3
);
assert.strictEqual(mergedRelated[0].path, "Law/刑法/责任.md");
assert.ok(mergedRelated[0].source.includes("vector"));
assert.ok(mergedRelated[0].source.includes("local-metadata"));
assert.strictEqual(new Set(mergedRelated.map((item) => item.path)).size, mergedRelated.length);

const cacheWithMetadata = { files: {}, stats: {}, localMetadataIndex: {}, indexDirty: false };
assert.strictEqual(setLocalMetadataForFile(cacheWithMetadata, "Law/刑法/当前.md", "# 当前\n\n#刑法 [[Law/刑法/责任]] 犯罪"), true);
assert.strictEqual(cacheWithMetadata.localMetadataIndex["Law/刑法/当前.md"].title, "当前");
assert.strictEqual(cacheWithMetadata.indexDirty, true);

cacheWithMetadata.indexDirty = false;
assert.strictEqual(setLocalMetadataForFile(cacheWithMetadata, "Law/刑法/当前.md", "# 当前\n\n#刑法 [[Law/刑法/责任]] 犯罪"), false);
assert.strictEqual(cacheWithMetadata.indexDirty, false);

cacheWithMetadata.indexDirty = false;
migrateCachePath(cacheWithMetadata, "Law/刑法/当前.md", "Law/刑法/新当前.md");
assert.strictEqual(cacheWithMetadata.localMetadataIndex["Law/刑法/当前.md"], undefined);
assert.strictEqual(cacheWithMetadata.localMetadataIndex["Law/刑法/新当前.md"].path, "Law/刑法/新当前.md");
assert.strictEqual(cacheWithMetadata.indexDirty, true);

cacheWithMetadata.indexDirty = false;
removeCachePath(cacheWithMetadata, "Law/刑法/新当前.md");
assert.strictEqual(cacheWithMetadata.localMetadataIndex["Law/刑法/新当前.md"], undefined);
assert.strictEqual(cacheWithMetadata.indexDirty, true);

assert.deepStrictEqual(JSON.parse(JSON.stringify(rankIdleCandidatePaths(
  {
    "Project/API.md": { openCount: 5 },
    "Law/刑法/概念.md": { relatedHitCount: 1 },
  },
  localCandidates,
  2
))), ["Law/刑法/责任.md", "Law/刑法/概念.md"]);

const fallback = normalizeRelatedResponse({
  answer: "- [犯罪构成](03%20collection/Law/犯罪构成.md)\n- [[Law/责任]]",
});

assert.deepStrictEqual(Array.from(fallback.paths), [
  "03 collection/Law/犯罪构成.md",
  "Law/责任",
]);
assert.strictEqual(fallback.related.length, 2);
assert.strictEqual(fallback.related[0].path, "03 collection/Law/犯罪构成.md");

assert.strictEqual(formatQueryMeta({ source: "cache", elapsedMs: 42 }), "缓存 · 42ms");
assert.strictEqual(formatQueryMeta({ source: "backend", elapsedMs: 1234 }), "后端 · 1.2s");
assert.strictEqual(formatQueryMeta({ source: "backend", elapsedMs: 0 }), "后端");

const cache = {
  files: {
    "old.md": { sections: { a: {} } },
    "keep.md": {
      sections: {
        b: {
          paths: ["old.md", "other.md"],
          related: [{ path: "old.md", reason: "旧路径" }, { path: "other.md" }],
        },
      },
    },
  },
  stats: {
    "old.md": { openCount: 2 },
    "keep.md": { openCount: 1 },
  },
  indexDirty: false,
};
migrateCachePath(cache, "old.md", "new.md");
assert.deepStrictEqual(Object.keys(cache.files).sort(), ["keep.md", "new.md"]);
assert.strictEqual(cache.stats["new.md"].openCount, 2);
assert.deepStrictEqual(cache.files["keep.md"].sections.b.paths, ["new.md", "other.md"]);
assert.strictEqual(cache.files["keep.md"].sections.b.related[0].path, "new.md");
assert.strictEqual(cache.indexDirty, true);

removeCachePath(cache, "new.md");
assert.strictEqual(cache.files["new.md"], undefined);
assert.strictEqual(cache.stats["new.md"], undefined);
assert.strictEqual(cache.files["keep.md"].sections.b !== undefined, true);
assert.deepStrictEqual(cache.files["keep.md"].sections.b.paths, ["other.md"]);
assert.deepStrictEqual(cache.files["keep.md"].sections.b.related, [{ path: "other.md" }]);

assert.strictEqual(applyBackendSignature(cache, "sig-a"), true);
assert.strictEqual(cache.backendSignature, "sig-a");
assert.strictEqual(cache.indexDirty, true);
cache.indexDirty = false;
assert.strictEqual(applyBackendSignature(cache, "sig-a"), false);
assert.strictEqual(cache.indexDirty, false);
assert.strictEqual(applyBackendSignature(cache, "sig-b"), true);
assert.strictEqual(cache.indexDirty, true);

assert.deepStrictEqual(Array.from(formatBackendStatus({
  ok: true,
  knowledgeDir: "D:/repo",
  storageDir: "D:/repo/00 rag storage",
  llmModel: "qwen3.6",
  embedModel: "bge-m3",
  indexVersion: "v1",
})), [
  "状态：可用",
  "知识库：D:/repo",
  "存储：D:/repo/00 rag storage",
  "LLM：qwen3.6",
  "Embedding：bge-m3",
  "索引：v1",
]);
assert.deepStrictEqual(Array.from(formatBackendStatus({ ok: false, error: "boom" })), [
  "状态：不可用",
  "错误：boom",
]);

console.log("related response tests passed");
