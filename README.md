# Kwipu Related Context

An Obsidian plugin for showing Kwipu-powered related vault files for the file currently open in the editor. The plugin works at paragraph/block granularity: it reads the active Markdown file, splits it into meaningful sections, sends each section to a local Kwipu HTTP service, caches results by section hash, and displays recommendations inside Obsidian.

This directory contains a first runnable plugin version. It intentionally depends on Kwipu instead of becoming a separate local-search plugin.

## Current Implementation

- `manifest.json`: Obsidian plugin manifest.
- `main.js`: runnable plugin entrypoint.
- `styles.css`: sidebar styles.
- `package.json`: minimal metadata and `node --check` script.

The local HTTP bridge lives in the Kwipu main project as `kwipu_http_server.py`.

The plugin is desktop-only because it calls `http://127.0.0.1:8765`.

## Run Kwipu HTTP Server

Start the HTTP bridge before opening Obsidian:

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

Health check:

```powershell
curl http://127.0.0.1:8765/health
```

## Install In Obsidian

Copy or symlink this directory into your vault:

```text
D:\repo\.obsidian\plugins\kwipu-related-context
```

The directory must contain:

```text
manifest.json
main.js
styles.css
```

Then enable `Kwipu Related Context` from Obsidian community plugins.

## Usage

1. Start `kwipu_http_server.py`.
2. Open Obsidian.
3. Enable/open the `Kwipu Related Context` sidebar.
4. Open a Markdown note.
5. The sidebar splits the active file into sections and queries Kwipu for each section.

The plugin caches results by:

```text
file path + section id + section content hash
```

If a paragraph changes, only that paragraph's related context is recomputed.

## Goals

- Track the active Markdown file in real time.
- Split the active file into paragraphs or semantic blocks.
- For each changed paragraph, ask Kwipu for related files across the vault.
- Show related files near the current context or in a side panel.
- Cache paragraph hashes and related-file results to avoid recomputing unchanged content.
- Use idle time to precompute likely future recommendations.

## Non-Goals

- Do not modify user notes.
- Do not require cloud services.
- Do not index non-Markdown files in the first version.
- Do not replace Obsidian search, backlinks, or graph view.
- Do not compute expensive whole-vault results synchronously while the user is typing.
- Do not silently fall back to a separate local-only search engine when Kwipu is unavailable.

## User Experience

The first version should provide a right sidebar view named "Related Context".

When the user opens or edits a Markdown note, the view lists sections from the active file. Under each section, it shows related files with a short reason or matching excerpt when available.

Example layout:

```text
Related Context

Current: Traffic Control.md

Section: "Signal priority rules..."
- Urban Mobility Plan.md
- Intersection Safety Notes.md
- Queue Detection API.md

Section: "Adaptive timing..."
- SCOOT Overview.md
- Reinforcement Learning Notes.md
```

The view should update after a debounce rather than on every keystroke. A typical debounce target is 750-1500 ms after editing stops.

## Data Model

The plugin should store cache data under the plugin data directory, not inside user notes.

Suggested cache shape:

```json
{
  "version": 1,
  "vaultId": "local",
  "files": {
    "folder/current.md": {
      "mtime": 1710000000000,
      "size": 12345,
      "sections": [
        {
          "sectionId": "sha1(path + heading + index)",
          "hash": "sha256(section text)",
          "heading": "Traffic Control",
          "startLine": 12,
          "endLine": 24,
          "related": [
            {
              "path": "folder/other.md",
              "score": 0.82,
              "reason": "shared terms and backlinks",
              "computedAt": 1710000000000
            }
          ]
        }
      ]
    }
  },
  "stats": {
    "folder/other.md": {
      "openCount": 12,
      "relatedHitCount": 31,
      "lastOpenedAt": 1710000000000
    }
  }
}
```

## Section Splitting

Initial section splitting should be deterministic and cheap:

- Split on headings.
- Within long heading sections, split on blank-line paragraph groups.
- Ignore very short blocks unless they contain wikilinks or tags.
- Preserve line ranges so results can be displayed near the relevant source text later.

The implementation should produce stable section IDs where possible. A good first version is:

```text
sha256(file path + nearest heading + section index)
```

The content hash should be separate:

```text
sha256(normalized section text)
```

That lets the plugin know whether a cached recommendation is still valid.

## Relatedness Strategy

The first implementation calls the local Kwipu HTTP bridge:

```http
POST http://127.0.0.1:8765/related
Content-Type: application/json

{
  "filePath": "folder/current.md",
  "sectionId": "abc123",
  "sectionText": "paragraph text...",
  "topK": 5
}
```

Response:

```json
{
  "ok": true,
  "answer": "Related files with reasons...",
  "filePath": "folder/current.md",
  "sectionId": "abc123"
}
```

The older local-only scoring idea is kept as a possible fallback design, but it is not the current product direction:

1. Direct Obsidian signals:
   - outgoing wikilinks
   - backlinks
   - shared tags
   - same folder or nearby folder

2. Lexical similarity:
   - normalized keyword overlap
   - heading/title overlap
   - BM25-style scoring if cheap enough

3. External backend:
   - call the local Kwipu HTTP endpoint
   - retrieve graph/vector results for the section text

## Caching Strategy

Cache key:

```text
file path + section id + section content hash + index version
```

If the file is edited:

- Re-split the active file after debounce.
- Compare section hashes against cache.
- Recompute only changed or new sections.
- Remove cache entries for deleted sections.

If another file changes:

- Mark global index state dirty.
- Recompute affected active-file sections lazily.
- Schedule low-priority background refreshes.

## Idle Precomputation

The plugin can make the UI feel faster by using idle time.

Signals to prioritize:

- files opened frequently
- files frequently shown as related results
- files recently modified
- files linked from the active file
- files linking to the active file

Idle queue behavior:

- process only when Obsidian is idle
- keep work in small batches
- stop immediately when the active file changes or the user starts typing
- persist progress after each file or section

## Display Strategy

Version 1 should use a sidebar view. Inline decorations can come later.

Sidebar advantages:

- simpler to implement
- less risk of editor performance issues
- easier to debug cache and scoring

Later versions can add:

- inline gutter indicators
- hover popovers
- command palette action: "Show related context for current section"
- status bar progress indicator

## Performance Rules

- Never scan the whole vault synchronously on active file change.
- Debounce editor changes.
- Cache by section hash.
- Persist after small units of work.
- Keep background batches interruptible.
- Avoid indexing generated/cache folders.

Default ignored folders should include:

- `.obsidian`
- `.trash`
- any folder starting with `00`, `01`, or `02`
- plugin cache folders
- configured user exclusions

## Open Questions

- Should related files be computed only from Obsidian metadata and lexical scoring, or should the plugin call Kwipu when available?
- Should the cache live only in Obsidian plugin data, or can it optionally live in a synced folder?
- Should per-section results show only files, or also matching paragraphs inside those files?
- What is the maximum acceptable CPU time per active file update?
