# Plain Reader

A plain reader for plain-text files: Markdown, MDX, text and JSON. It opens a file, renders it well, and gets out of the way. Press ⌘E when you want to change something, then click any block to edit its Markdown in place.

Under 1 MB. A small AppKit app that renders with the system's WebKit. No Electron, no Rust, no account.

## Build and install

```bash
./mac/build.sh --install
```

This builds the web UI, compiles the Swift shell, and copies it to `~/Applications/Plain Reader.app`. It becomes the default app for Markdown files and shows up under *Open with* for MDX, text and JSON. To make it the default for one of those too: select a file of that type in Finder, press ⌘I, choose Plain Reader under *Open with*, then *Change All…*

Needs Node and the Xcode Command Line Tools (`xcode-select --install`). Full Xcode isn't needed.

## What it opens

- **Markdown** (`.md`, `.markdown`): the full reader and editor below
- **MDX** (`.mdx`): Markdown, with the leading `import` and `export` lines hidden while reading, and component blocks like `<Chart />` shown as quiet code you can still edit
- **Text** (`.txt`): readable prose with the same typography. Paragraphs split on blank lines, line breaks stay, and URLs become links. Edit any paragraph in place
- **JSON** (`.json`): a collapsible tree with the top-level keys in the margin and a count on folded nodes. Invalid JSON shows the line and column of the problem above the raw text. ⌘E opens the raw text to edit, and saving writes exactly what you typed. Files over 2 MB start folded below the second level

## What it does

- Renders CommonMark and GitHub tables, task lists, footnotes and syntax-highlighted code
- Handles Obsidian files: `[[wikilinks]]`, `![[image embeds]]`, `> [!note]` callouts, `==highlights==` and frontmatter properties
- Shows where the file lives: a path breadcrumb (each folder opens in Finder) and the readable files next to it
- Frontmatter as a properties block, with tags as pills
- Five themes: Stone (follows light and dark mode), Olive, Olive Night, Terracotta and Graphite. Pick one from the dot in the status bar or View › Theme. Every text pair passes WCAG AA
- Contents in the left margin on wide windows. On narrow windows they fold into dashes on the right that open on hover
- Edits in place, like [Esqia](https://esqia.jakub.kr/): a `/` menu, a toolbar when you select text, Markdown shortcuts, list continuation, block moves
- Source view for the whole file
- Autosaves like any Mac app, with versions, Open Recent, tabs and Rename from the title bar
- Reloads when another app changes the file, unless you have unsaved edits
- Follows light and dark mode

## Shortcuts

| Keys | |
| --- | --- |
| ⌘E | Reading and editing (JSON: the raw text) |
| ⇧⌘E | Source view |
| ⌘\ | Show or hide contents |
| ⌘F, ⌘G | Find, find next |
| ⌘+ ⌘− ⌘0 | Text size |
| Esc | Close the block, then stop editing |
| ↑ ↓ at a block's edge | Move to the next block |
| ⇧⌘↑ ⇧⌘↓ | Move a block |
| / | Insert a block |
| ⌘B ⌘I ⌘K | Bold, italic, link |
| ⇧⌘X ⇧⌘C ⇧⌘H | Strikethrough, code, highlight |
| ⌘↩ | Toggle to-do |
| Tab, ⇧Tab | Indent or outdent a list |
| ⌘/ | All shortcuts |

## How it's built

```
web/   Vite + TypeScript UI, built into one index.html
  src/markdown.ts  markdown-it, split into top-level blocks with source line ranges (and MDX)
  src/kinds.ts     plain text paragraphs, and the JSON parser and tree
  src/editor.ts    textarea behaviour: shortcuts, / menu, selection toolbar
  src/main.ts      rendering, block editing, modes, contents, find
mac/   Swift Package, no Xcode project
  MarkdownDocument.swift          NSDocument for every file type: open, save, autosave, reload on change
  DocumentWindowController.swift  WKWebView window and the bridge to the UI
  AssetSchemeHandler.swift        serves the UI and images next to the file
  Resolver.swift                  resolves relative links and finds files in a vault
```

Each top-level Markdown block renders on its own and keeps its source line range. Clicking a block swaps it for a textarea with exactly those lines. Closing the block splices them back. Nothing gets reformatted, so the file stays the way you wrote it.

To work on the UI in a browser:

```bash
npm --prefix web run dev
```

## Licence

MIT
