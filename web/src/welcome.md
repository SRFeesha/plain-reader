---
title: Welcome to Plain Reader
tags: [markdown, reader]
---

# Plain Reader

A plain reader for plain-text files: Markdown, MDX, text and JSON. It opens a file, renders it well, and gets out of the way. When you want to change something, press **⌘E** and click any block.

## Reading

Headings build the contents on the left. On a narrow window they fold into the dashes on the right; hover them to see the list. **⌘\\** hides it.

Links are underlined, `inline code` stays small, and ==highlights== look like a pen mark. Footnotes work too.[^1]

> [!note] Callouts from Obsidian
> They render as a calm panel. GitHub-style `> [!tip]` works the same way.

> A plain quote stays a plain quote.

## Editing

Press **⌘E**, then click a block to edit its Markdown right where it sits. **Esc** puts it back. Press Esc again to stop editing.

- Type `/` at the start of a line to insert a heading, list, table or code block
- Select text to get a small toolbar, or use ⌘B, ⌘I and ⌘K
- **↑** and **↓** at the edge of a block move to the next one
- **⇧⌘↑** and **⇧⌘↓** move the whole block
- Press Enter on an empty line to start a new block

### To-dos

- [x] Open a file
- [ ] Click a checkbox, even while reading
- [ ] Press ⌘↩ on a line to toggle it

### Code

```ts
function greet(name: string) {
  // Comments stay quiet, strings get a little warmth
  return `Hello, ${name}`
}
```

### Tables

| Shortcut | What it does |
| --- | --- |
| ⌘E | Reading and editing |
| ⇧⌘E | Source view |
| ⌘F | Find |
| ⌘/ | All shortcuts |

---

Wiki links like [[Another note]] open the file next to this one, and `![[image.png]]` embeds an image from your vault.

[^1]: Like this one.
