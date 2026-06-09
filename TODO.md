# TODO

## Phase 0 - Decisions

- [x] Choose plugin package name and ID: `kwipu-related-context`.
- [x] Decide whether version 1 is sidebar-only.
- [x] Decide whether version 1 depends on the Kwipu Python backend or starts with local-only scoring.
- [x] Decide cache location: Obsidian plugin data.

## Phase 1 - Plugin Scaffold

- [x] Add `manifest.json`.
- [x] Add `package.json`.
- [ ] Add TypeScript build config.
- [ ] Add `main.ts`.
- [x] Add runnable `main.js`.
- [x] Add a basic settings tab.
- [x] Add a sidebar view called `Related Context`.
- [x] Add commands:
  - [x] `Open Related Context`
  - [x] `Recompute Related Context for Current File`
  - [x] `Clear Related Context Cache`

## Phase 2 - Active File Tracking

- [x] Listen for active file changes.
- [x] Ignore non-Markdown files.
- [x] Read the active Markdown file through Obsidian Vault APIs.
- [x] Debounce editor changes.
- [ ] Track current file mtime and size.
- [x] Display basic active-file status in the sidebar.

## Phase 3 - Section Splitting

- [x] Implement deterministic Markdown section splitting.
- [x] Preserve heading, start line, end line, and text.
- [x] Normalize section text before hashing.
- [x] Compute section IDs and section hashes.
- [ ] Add tests for:
  - [ ] headings
  - [ ] paragraph groups
  - [ ] empty sections
  - [ ] wikilink-only short sections
  - [ ] stable IDs after unrelated edits

## Phase 4 - Cache

- [x] Define cache schema version.
- [x] Load cache on plugin startup.
- [x] Save cache after each file or section update.
- [x] Cache section hash to related results.
- [ ] Remove stale cache entries for deleted sections.
- [ ] Track file stats:
  - [x] open count
  - [x] related-hit count
  - [x] last opened time
  - [ ] last computed time
- [ ] Add cache migration handling.

## Phase 5 - Local Relatedness Scoring

- [x] Deferred: first runnable version calls Kwipu HTTP directly.
- [ ] Build a lightweight vault metadata index.
- [ ] Extract wikilinks per file.
- [ ] Extract tags per file.
- [ ] Extract title and headings per file.
- [ ] Tokenize Markdown text for lexical scoring.
- [ ] Score candidate files using:
  - [ ] direct links
  - [ ] backlinks
  - [ ] shared tags
  - [ ] title/heading overlap
  - [ ] keyword overlap
  - [ ] folder proximity
- [ ] Return top N related files per section.
- [ ] Store score and reason in cache.

## Phase 6 - Sidebar UI

- [x] Render active file name.
- [x] Render sections from the active file.
- [x] Render related files under each section.
- [x] Add click-to-open file behavior.
- [x] Show loading state.
- [x] Show empty state when no related files are found.
- [x] Add setting for max results per section.
- [ ] Improve parsing of source paths from Kwipu answers.
- [ ] Add stale-cache indicator.

## Phase 7 - Idle Precomputation

- [x] Implement basic idle precompute queue.
- [ ] Prioritize files by:
  - [x] open count
  - [x] related-hit count
  - [ ] recent modification time
  - [ ] links to/from active file
- [x] Process queue in small batches.
- [ ] Stop background work when the user edits or switches files.
- [ ] Persist queue progress.

## Phase 8 - Kwipu Integration

- [x] Add setting for Kwipu backend URL.
- [x] Define request shape for section text queries.
- [x] Add `kwipu_http_server.py`.
- [x] Cache backend results by section hash.
- [ ] Add request timeout handling.
- [ ] Add structured result format instead of parsing paths from answer text.
- [ ] Show backend status in settings.

## Phase 9 - Exclusions

- [x] Ignore `.obsidian`.
- [x] Ignore `.trash`.
- [x] Ignore folders starting with `00`, `01`, or `02`.
- [x] Ignore configured user exclusion patterns.
- [x] Ignore plugin cache folders if configured.
- [x] Add settings UI for exclusions.

## Phase 10 - Quality

- [ ] Add unit tests for scoring.
- [ ] Add unit tests for cache invalidation.
- [ ] Add manual test vault.
- [ ] Profile large vault startup.
- [ ] Profile active-file edit latency.
- [ ] Add README usage screenshots after UI exists.
