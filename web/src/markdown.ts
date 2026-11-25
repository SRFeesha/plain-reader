import markdownit, { type MarkdownIt, type Token, type StateCore, type StateInline } from 'markdown-it'
import footnote from 'markdown-it-footnote'
import mark from 'markdown-it-mark'
import hljs from 'highlight.js/lib/common'
import { bridge } from './bridge'

export interface Block {
  start: number // first source line (inclusive)
  end: number // last source line (exclusive)
  kind: string
  html: string
}

export interface Heading {
  id: string
  level: number
  text: string
  line: number
}

interface PlainEnv {
  headings: Heading[]
  slugs: Map<string, number>
}

const esc = (s: string) => md.utils.escapeHtml(s)

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  )
}

export const md: MarkdownIt = markdownit({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, info) {
    const lang = info.trim().split(/\s+/)[0]
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      } catch {
        /* fall through */
      }
    }
    return esc(code)
  },
})
  .use(footnote)
  .use(mark)
  .use(wikilinks)
  .use(tasks)
  .use(callouts)

// Headings get stable ids and are collected for the table of contents.
md.renderer.rules.heading_open = (tokens, idx, options, rawEnv, self) => {
  const env = rawEnv as unknown as PlainEnv
  const token = tokens[idx]
  const inline = tokens[idx + 1]
  const text = (inline.children ?? [])
    .map((c) => (c.type === 'wikilink' ? c.meta?.alias || c.meta?.target : c.type === 'html_inline' ? '' : c.content))
    .join('')
    .trim()
  const base = slugify(text)
  const seen = env.slugs.get(base) ?? 0
  env.slugs.set(base, seen + 1)
  const id = seen ? `${base}-${seen}` : base
  token.attrSet('id', id)
  env.headings.push({ id, level: Number(token.tag.slice(1)), text, line: token.map?.[0] ?? 0 })
  return self.renderToken(tokens, idx, options)
}

// Code blocks: quiet language label and a copy button.
const fence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const lang = tokens[idx].info.trim().split(/\s+/)[0] ?? ''
  const label = lang ? `<span class="code-lang">${esc(lang)}</span>` : ''
  return `<div class="code">${label}<button class="code-copy" type="button" aria-label="Copy code">Copy</button>${fence(tokens, idx, options, env, self)}</div>`
}

// Relative images load from next to the file.
const image = md.renderer.rules.image!
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const src = token.attrGet('src')
  if (src) token.attrSet('src', bridge.assetURL(String(src)))
  token.attrSet('loading', 'lazy')
  return image(tokens, idx, options, env, self)
}

// [[Note]], [[Note|alias]], [[Note#Heading]] and ![[image.png|300]] from Obsidian.
function wikilinks(md: MarkdownIt) {
  md.inline.ruler.before('link', 'wikilink', (state: StateInline, silent: boolean) => {
    const { src, pos } = state
    const embed = src.charCodeAt(pos) === 0x21
    const open = embed ? pos + 1 : pos
    if (src.charCodeAt(open) !== 0x5b || src.charCodeAt(open + 1) !== 0x5b) return false
    const close = src.indexOf(']]', open + 2)
    if (close < 0) return false
    const inner = src.slice(open + 2, close)
    if (!inner.trim() || inner.includes('\n')) return false
    if (!silent) {
      const [target, alias] = inner.split('|')
      const token = state.push(embed ? 'wikiembed' : 'wikilink', '', 0)
      token.meta = { target: target.trim(), alias: alias?.trim() }
    }
    state.pos = close + 2
    return true
  })

  md.renderer.rules.wikilink = (tokens, idx) => {
    const { target, alias } = tokens[idx].meta as { target: string; alias?: string }
    const [page, heading] = target.split('#')
    const href = (page ? encodeURI(page) : '') + (heading ? '#' + slugify(heading) : '')
    const label = alias || (heading && !page ? heading : target.replace('#', ' › '))
    return `<a class="wikilink" href="${esc(href)}" data-wiki="1">${esc(label)}</a>`
  }

  md.renderer.rules.wikiembed = (tokens, idx) => {
    const { target, alias } = tokens[idx].meta as { target: string; alias?: string }
    if (/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(target)) {
      const width = alias && /^\d+(x\d+)?$/.test(alias) ? ` width="${alias.split('x')[0]}"` : ''
      return `<img src="${esc(bridge.assetURL(target, true))}" alt="${esc(alias && !width ? alias : '')}"${width} loading="lazy">`
    }
    return `<a class="wikilink" href="${esc(encodeURI(target))}" data-wiki="1">${esc(alias || target)}</a>`
  }
}

// - [ ] and - [x] become checkboxes that write back to the source line.
function tasks(md: MarkdownIt) {
  md.core.ruler.after('inline', 'tasks', (state: StateCore) => {
    const ts = state.tokens
    for (let i = 2; i < ts.length; i++) {
      const t = ts[i]
      if (t.type !== 'inline' || ts[i - 1].type !== 'paragraph_open' || ts[i - 2].type !== 'list_item_open') continue
      const m = /^\[([ xX])\][ \t]+/.exec(t.content)
      const first = t.children?.[0]
      if (!m || !first || first.type !== 'text') continue
      first.content = first.content.replace(/^\[[ xX]\][ \t]*/, '')
      const checked = m[1] !== ' '
      const box = new state.Token('html_inline', '', 0)
      const label = t.content.slice(m[0].length).split('\n')[0].replace(/[*_`~=[\]]/g, '').trim()
      box.content = `<input type="checkbox" class="task-check" aria-label="${esc(label)}" data-line="${t.map?.[0] ?? 0}"${checked ? ' checked' : ''}>`
      t.children!.unshift(box)
      ts[i - 2].attrJoin('class', checked ? 'task done' : 'task')
    }
  })
}

// > [!note] Title  callouts from Obsidian and GitHub.
function callouts(md: MarkdownIt) {
  md.core.ruler.after('inline', 'callouts', (state: StateCore) => {
    const ts = state.tokens
    for (let i = 0; i < ts.length - 2; i++) {
      if (ts[i].type !== 'blockquote_open' || ts[i + 1].type !== 'paragraph_open' || ts[i + 2].type !== 'inline') continue
      const inline = ts[i + 2]
      const m = /^\[!([\w-]+)\][+-]?[ \t]*(.*)/.exec(inline.content)
      if (!m) continue
      const type = m[1].toLowerCase()
      const title = m[2].split('\n')[0].trim() || type[0].toUpperCase() + type.slice(1)
      ts[i].attrJoin('class', `callout callout-${type}`)
      const kids = inline.children ?? []
      const br = kids.findIndex((k) => k.type === 'softbreak' || k.type === 'hardbreak')
      inline.children = br >= 0 ? kids.slice(br + 1) : []
      const head = new state.Token('html_inline', '', 0)
      head.content = `<span class="callout-title">${esc(title)}</span>`
      inline.children.unshift(head)
    }
  })
}

function kindOf(t: Token): string {
  switch (t.type) {
    case 'heading_open':
      return t.tag
    case 'paragraph_open':
      return 'p'
    case 'bullet_list_open':
    case 'ordered_list_open':
      return 'list'
    case 'blockquote_open':
      return 'quote'
    case 'fence':
    case 'code_block':
      return 'code'
    case 'table_open':
      return 'table'
    case 'hr':
      return 'hr'
    case 'html_block':
      return 'html'
    default:
      return 'other'
  }
}

const TAG_KEYS = new Set(['tags', 'tag', 'aliases', 'categories', 'keywords', 'topics'])

function frontmatter(lines: string[]): { end: number; html: string } | null {
  if (lines[0]?.trim() !== '---') return null
  for (let k = 1; k < lines.length; k++) {
    if (!/^(---|\.\.\.)\s*$/.test(lines[k])) continue
    const rows: [string, string[], string][] = [] // key, values, joiner
    for (const line of lines.slice(1, k)) {
      const kv = /^([^\s:#][^:]*):\s*(.*)$/.exec(line)
      const item = /^\s*-\s+(.*)$/.exec(line)
      const last = rows[rows.length - 1]
      if (kv) rows.push([kv[1].trim(), kv[2] && !/^[|>][-+]?$/.test(kv[2].trim()) ? [kv[2]] : [], ', '])
      else if (item && last) last[1].push(item[1])
      else if (/^\s+\S/.test(line) && last) {
        last[1].push(line.trim()) // nested keys or block text
        if (!/^\s+[\w-]+:/.test(line)) last[2] = ' '
      }
    }
    const clean = (v: string) => v.trim().replace(/^\[(.*)\]$/, '$1').replace(/^["']|["']$/g, '')
    const html = rows.length
      ? `<dl class="props">${rows
          .map(([key, vals, joiner]) => {
            if (TAG_KEYS.has(key.toLowerCase())) {
              const tags = vals.flatMap((v) => clean(v).split(',')).map((v) => v.trim().replace(/^#/, '')).filter(Boolean)
              return `<div><dt>${esc(key)}</dt><dd class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') || '—'}</dd></div>`
            }
            return `<div><dt>${esc(key)}</dt><dd>${esc(vals.map(clean).join(joiner)) || '—'}</dd></div>`
          })
          .join('')}</dl>`
      : `<dl class="props"><div><dt>Properties</dt><dd>—</dd></div></dl>`
    return { end: k + 1, html }
  }
  return null
}

// MDX: leading import/export lines, and blocks that are only JSX components.
// Both render as quiet code, so the Markdown around them reads normally.
function mdxBlocks(lines: string[], from: number): Block[] {
  const out: Block[] = []
  let i = from
  for (; i < lines.length; ) {
    if (lines[i].trim() === '') {
      i++
      continue
    }
    if (!/^(import|export)\b/.test(lines[i])) break
    let j = i
    while (j < lines.length && lines[j].trim() !== '') j++
    const code = lines.slice(i, j).join('\n')
    out.push({ start: i, end: j, kind: 'esm', html: `<div class="code quiet"><span class="code-lang">js</span><pre><code>${hljs.highlight(code, { language: 'javascript', ignoreIllegals: true }).value}</code></pre></div>` })
    i = j
  }
  let fence = ''
  for (; i < lines.length; i++) {
    const l = lines[i]
    const f = /^\s*(`{3,}|~{3,})/.exec(l)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = ''
      continue
    }
    if (f) {
      fence = f[1]
      continue
    }
    const m = /^<([A-Z][\w.]*)/.exec(l)
    if (!m || (i > from && lines[i - 1].trim() !== '')) continue
    const close = `</${m[1]}>`
    let j = i + 1
    if (!/\/>\s*$/.test(l) && !l.includes(close)) {
      let k = i + 1
      while (k < lines.length && !lines[k].includes(close)) k++
      if (k < lines.length) j = k + 1
    }
    while (j < lines.length && lines[j].trim() !== '') j++
    const code = lines.slice(i, j).join('\n')
    out.push({ start: i, end: j, kind: 'jsx', html: `<div class="code quiet"><span class="code-lang">jsx</span><button class="code-copy" type="button" aria-label="Copy code">Copy</button><pre><code>${esc(code)}</code></pre></div>` })
    i = j - 1
  }
  return out
}

/**
 * Parses the whole document once, then renders each top-level block on its
 * own, keeping the source line range so a block can be edited in place.
 */
export function renderDoc(src: string, mdx = false): { blocks: Block[]; headings: Heading[] } {
  const lines = src.split('\n')
  const blocks: Block[] = []
  let body = src
  const fm = frontmatter(lines)
  if (fm) blocks.push({ start: 0, end: fm.end, kind: 'frontmatter', html: fm.html })
  const own = mdx ? mdxBlocks(lines, fm?.end ?? 0) : []
  blocks.push(...own)
  // Lines rendered here are blanked for markdown-it, so line numbers still match.
  if (fm || own.length) {
    const blank = new Set<number>()
    for (const b of fm ? [{ start: 0, end: fm.end }, ...own] : own) for (let n = b.start; n < b.end; n++) blank.add(n)
    body = lines.map((l, n) => (blank.has(n) ? '' : l)).join('\n')
  }

  const plainEnv: PlainEnv = { headings: [], slugs: new Map() }
  const env = plainEnv as unknown as Record<string, unknown>
  const tokens = md.parse(body, env)
  const tail: Token[] = []

  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i]
    if (t.level !== 0) {
      i++
      continue
    }
    let j = i
    if (t.nesting === 1) {
      let depth = 0
      for (j = i; j < tokens.length; j++) {
        depth += tokens[j].nesting
        if (depth === 0) break
      }
    }
    const slice = tokens.slice(i, j + 1)
    if (t.map) {
      let [start, end] = t.map
      while (end > start + 1 && lines[end - 1]?.trim() === '') end--
      blocks.push({ start, end, kind: kindOf(t), html: md.renderer.render(slice, md.options, env) })
    } else {
      tail.push(...slice) // footnotes, collected at the end by the plugin
    }
    i = j + 1
  }

  if (own.length) blocks.sort((a, b) => a.start - b.start)
  if (tail.length) {
    blocks.push({ start: lines.length, end: lines.length, kind: 'footnotes', html: md.renderer.render(tail, md.options, env) })
  }
  return { blocks, headings: plainEnv.headings }
}
