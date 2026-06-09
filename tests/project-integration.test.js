const assert = require("assert");
const fs = require("fs");
const path = require("path");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertFileContains(filePath, patterns) {
  assert.ok(fs.existsSync(filePath), `${filePath} should exist`);
  const text = read(filePath);
  for (const pattern of patterns) {
    assert.match(text, pattern, `${filePath} should contain ${pattern}`);
  }
}

assertFileContains(".env.example", [
  /^KWIPU_KNOWLEDGE_DIR=/m,
  /^KWIPU_STORAGE_DIR=/m,
  /^KWIPU_LLM_MODEL=/m,
  /^KWIPU_EMBED_MODEL=/m,
  /^KWIPU_EXCLUDE_DIRS=/m,
  /^KWIPU_EXCLUDE_DIR_PREFIXES=/m,
  /^KWIPU_HTTP_PORT=/m,
  /^KWIPU_PROJECT_DIR=/m,
]);

for (const script of [
  "kwipu-common.ps1",
  "start-kwipu-server.ps1",
  "check-kwipu-health.ps1",
  "install-plugin.ps1",
  "update-plugin.ps1",
  "package-release.ps1",
]) {
  assert.ok(fs.existsSync(path.join("scripts", script)), `${script} should exist`);
}

assertFileContains("scripts/start-kwipu-server.ps1", [
  /kwipu_http_server\.py/,
  /--llm-model/,
  /--embed-model/,
  /KWIPU_NUM_CTX/,
]);

assertFileContains("scripts/check-kwipu-health.ps1", [
  /\/health/,
  /Invoke-RestMethod/,
]);

assertFileContains("scripts/install-plugin.ps1", [
  /\.obsidian[\\/]plugins[\\/]kwipu-related-context/,
  /manifest\.json/,
  /main\.js/,
  /styles\.css/,
]);

assertFileContains("scripts/update-plugin.ps1", [
  /data\.json/,
  /install-plugin\.ps1/,
]);

assertFileContains("scripts/package-release.ps1", [
  /manifest\.json/,
  /main\.js/,
  /styles\.css/,
  /README\.md/,
  /scripts/,
  /Compress-Archive/,
  /data\.json/,
  /\.env/,
]);

assertFileContains("README.md", [
  /完整安装流程/,
  /复制配置/,
  /首次建库/,
  /启动 HTTP 服务/,
  /安装或更新 Obsidian 插件/,
  /最小测试流程/,
  /\/related/,
  /sectionText/,
  /发布策略/,
  /package-release\.ps1/,
  /kwipu-related-context-0\.1\.0\.zip/,
  /常见错误/,
]);

console.log("project integration tests passed");
