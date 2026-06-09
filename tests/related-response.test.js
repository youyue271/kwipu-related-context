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
  formatQueryMeta,
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

console.log("related response tests passed");
