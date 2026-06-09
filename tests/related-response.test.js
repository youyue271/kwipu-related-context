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
const { normalizeRelatedResponse } = pluginModule.__test;

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

console.log("related response tests passed");
