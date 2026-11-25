import { md, type Block, type Heading } from './markdown'

// Plain text and JSON. Markdown and MDX render in markdown.ts.

export type Kind = 'markdown' | 'mdx' | 'text' | 'json'

export interface Rendered {
  blocks: Block[]
  headings: Heading[]
  /** Replaces the word count in the status bar. */
  summary?: string
}

export function kindFromName(name: string): Kind {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase()
  if (ext === 'mdx') return 'mdx'
  if (ext === 'json') return 'json'
  if (ext === 'txt' || ext === 'text') return 'text'
  return 'markdown'
}

export const isProse = (k: Kind) => k !== 'json'

const esc = (s: string) => md.utils.escapeHtml(s)

// ------------------------------------------------------------------- text

/** Wraps URLs in links and escapes the rest. */
function linkify(text: string) {
  const found = md.linkify.match(text) ?? []
  let out = ''
  let at = 0
  for (const m of found) {
    out += esc(text.slice(at, m.index))
    out += `<a href="${esc(m.url)}">${esc(m.raw)}</a>`
    at = m.lastIndex
  }
  return out + esc(text.slice(at))
}

/** Paragraphs split on blank lines; each is a block mapped to its source lines. */
export function renderText(src: string): Rendered {
  const lines = src.split('\n')
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; ) {
    if (lines[i].trim() === '') {
      i++
      continue
    }
    let j = i
    while (j < lines.length && lines[j].trim() !== '') j++
    blocks.push({ start: i, end: j, kind: 'p', html: `<p class="plain">${linkify(lines.slice(i, j).join('\n'))}</p>` })
    i = j
  }
  return { blocks, headings: [] }
}

// ------------------------------------------------------------------- JSON

type JNode =
  | { t: 'obj'; kids: [string, JNode][] }
  | { t: 'arr'; kids: JNode[] }
  | { t: 'str'; v: string }
  | { t: 'num'; v: string }
  | { t: 'lit'; v: 'true' | 'false' | 'null' }

class JsonError extends Error {
  constructor(message: string, public pos: number) {
    super(message)
  }
}

/** A small JSON parser that knows where it failed, since WebKit's doesn't say. */
function parseJson(s: string): { root: JNode; topKeys: number[] } {
  let i = 0
  const topKeys: number[] = []
  const ws = () => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\n' || s[i] === '\t' || s[i] === '\r')) i++
  }
  const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y

  function str(): string {
    const start = i
    i++
    while (i < s.length && s[i] !== '"') {
      const c = s.charCodeAt(i)
      if (c < 0x20) throw new JsonError('Line breaks and control characters need escaping inside a string', i)
      i += s[i] === '\\' ? 2 : 1
    }
    if (i >= s.length) throw new JsonError('This string never closes', start)
    i++
    try {
      return JSON.parse(s.slice(start, i)) as string
    } catch {
      throw new JsonError('This string has an invalid escape', start)
    }
  }

  function value(depth: number): JNode {
    ws()
    const c = s[i]
    if (c === '{') {
      i++
      const kids: [string, JNode][] = []
      ws()
      if (s[i] === '}') {
        i++
        return { t: 'obj', kids }
      }
      for (;;) {
        ws()
        if (s[i] !== '"') throw new JsonError(kids.length ? 'Expected a key in double quotes (is there a trailing comma?)' : 'Expected a key in double quotes', i)
        if (depth === 0) topKeys.push(i)
        const key = str()
        ws()
        if (s[i] !== ':') throw new JsonError('Expected “:” after the key', i)
        i++
        kids.push([key, value(depth + 1)])
        ws()
        if (s[i] === ',') {
          i++
          continue
        }
        if (s[i] === '}') {
          i++
          return { t: 'obj', kids }
        }
        throw new JsonError('Expected “,” or “}”', i)
      }
    }
    if (c === '[') {
      i++
      const kids: JNode[] = []
      ws()
      if (s[i] === ']') {
        i++
        return { t: 'arr', kids }
      }
      for (;;) {
        kids.push(value(depth + 1))
        ws()
        if (s[i] === ',') {
          i++
          ws()
          if (s[i] === ']') throw new JsonError('Trailing comma before “]”', i)
          continue
        }
        if (s[i] === ']') {
          i++
          return { t: 'arr', kids }
        }
        throw new JsonError('Expected “,” or “]”', i)
      }
    }
    if (c === '"') return { t: 'str', v: str() }
    for (const lit of ['true', 'false', 'null'] as const) {
      if (s.startsWith(lit, i)) {
        i += lit.length
        return { t: 'lit', v: lit }
      }
    }
    NUM.lastIndex = i
    const m = NUM.exec(s)
    if (m) {
      i += m[0].length
      return { t: 'num', v: m[0] }
    }
    throw new JsonError(i >= s.length ? 'The file ends before the value does' : 'Expected a value', i)
  }

  if (s.charCodeAt(0) === 0xfeff) i = 1
  const root = value(0)
  ws()
  if (i < s.length) throw new JsonError('Unexpected text after the end of the JSON', i)
  return { root, topKeys }
}

/** Line numbers (0-based) for ascending character offsets, in one pass. */
function linesAt(s: string, offsets: number[]) {
  const out: number[] = []
  let line = 0
  let at = 0
  for (const o of offsets) {
    for (; at < o; at++) if (s.charCodeAt(at) === 10) line++
    out.push(line)
  }
  return out
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const countOf = (n: JNode) => (n.t === 'obj' ? plural(n.kids.length, 'key', 'keys') : n.t === 'arr' ? plural(n.kids.length, 'item', 'items') : '')

function leaf(n: JNode) {
  switch (n.t) {
    case 'str':
      return `<span class="j-str">${esc(JSON.stringify(n.v))}</span>`
    case 'num':
      return `<span class="j-num">${n.v}</span>`
    case 'lit':
      return `<span class="j-${n.v === 'null' ? 'null' : 'bool'}">${n.v}</span>`
    case 'obj':
      return '<span class="j-punct">{}</span>'
    case 'arr':
      return '<span class="j-punct">[]</span>'
  }
}

function keyHtml(key: string | number) {
  return typeof key === 'number' ? `<span class="j-index">${key}</span>` : `<span class="j-key">${esc(key)}</span>`
}

function node(key: string | number | null, n: JNode, depth: number, openTo: number, id = ''): string {
  const idAttr = id ? ` id="${id}"` : ''
  const label = key === null ? '' : keyHtml(key)
  const kids = n.t === 'obj' ? n.kids : n.t === 'arr' ? n.kids.map((v, i) => [i, v] as [number, JNode]) : null
  if (!kids || !kids.length) return `<div class="j-row"${idAttr}>${label}${label ? '<span class="j-colon">:</span> ' : ''}${leaf(n)}</div>`
  const brackets = n.t === 'obj' ? ['{', '}'] : ['[', ']']
  const inner = kids.map(([k, v]) => node(k, v, depth + 1, openTo)).join('')
  return `<details class="j-node"${idAttr}${depth < openTo ? ' open' : ''}><summary>${label || `<span class="j-punct">${brackets[0]}${brackets[1]}</span>`}<span class="j-count">${countOf(n)}</span></summary><div class="j-kids">${inner}</div></details>`
}

const LARGE = 2 * 1024 * 1024

export function renderJson(src: string): Rendered {
  const lines = src.split('\n')
  const whole = (html: string, kind = 'json'): Block[] => [{ start: 0, end: lines.length, kind, html }]
  let parsed: ReturnType<typeof parseJson>
  try {
    parsed = parseJson(src)
  } catch (err) {
    if (!(err instanceof JsonError)) throw err
    const [line] = linesAt(src, [err.pos])
    const col = err.pos - (src.lastIndexOf('\n', err.pos - 1) + 1) + 1
    const raw = lines.map((l, n) => (n === line ? `<span class="json-bad">${esc(l) || ' '}</span>` : esc(l))).join('\n')
    const html =
      `<div class="json-error" role="alert"><p class="json-error-title">This JSON doesn’t parse</p>` +
      `<p>Line ${line + 1}, column ${col}: ${esc(err.message)}. Press ⌘E to fix it in the source.</p></div>` +
      `<div class="code"><span class="code-lang">json</span><pre><code>${raw}</code></pre></div>`
    return { blocks: whole(html, 'json-invalid'), headings: [], summary: 'Invalid JSON' }
  }

  const { root, topKeys } = parsed
  // Big files start folded below the second level, so they open quickly.
  const openTo = src.length > LARGE ? 2 : Infinity
  const headings: Heading[] = []
  let html: string
  if (root.t === 'obj' && root.kids.length) {
    const keyLines = linesAt(src, topKeys)
    html = root.kids
      .map(([k, v], i) => {
        const id = `json-${i}`
        headings.push({ id, level: 1, text: k || '""', line: keyLines[i] ?? 0 })
        return node(k, v, 1, openTo, id)
      })
      .join('')
  } else if (root.t === 'arr' && root.kids.length) {
    html = root.kids.map((v, i) => node(i, v, 1, openTo)).join('')
  } else {
    html = node(null, root, 0, openTo)
  }
  return {
    blocks: whole(`<div class="json-tree">${html}</div>`),
    headings,
    summary: countOf(root) || 'One value',
  }
}
