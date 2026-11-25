import './style.css'
import DOMPurify from 'dompurify'
import { renderDoc, type Block, type Heading } from './markdown'
import { attachEditor, autosize, activeEditor, caretRect, closePopovers, format, type Format } from './editor'
import { bridge } from './bridge'
import { Toc } from './toc'
import { Finder } from './find'
import { renderBreadcrumb, wireBreadcrumb, type Location } from './place'
import { kindFromName, isProse, renderJson, renderText, type Kind, type Rendered } from './kinds'
import welcome from './welcome.md?raw'

type Mode = 'read' | 'edit' | 'source'

interface Editing {
  start: number
  end: number
  el: HTMLElement
  ta: HTMLTextAreaElement
  fresh: boolean
  detach: () => void
}

const content = document.getElementById('content')!
const docEl = document.getElementById('doc')!
const tailEl = document.getElementById('tail')!
const statusEl = document.getElementById('status')!
const body = document.body

let source = ''
let blocks: Block[] = []
let rendered: string[] = []
let mode: Mode = 'read'
let modeBeforeSource: Mode = 'read'
let docName = 'Untitled'
let kind: Kind = 'markdown'
let summary: string | undefined
let dirty = false
let editing: Editing | null = null
let sourceTa: HTMLTextAreaElement | null = null
let detachSource: (() => void) | null = null
let fileHandle: FileSystemFileHandle | null = null
const undoStack: string[] = []
const redoStack: string[] = []

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
const toc = new Toc(
  document.getElementById('toc')!,
  (h) => scrollToHeading(h),
  (path) => bridge.post({ type: 'openLink', href: path }),
)
const placeEl = document.getElementById('place')!
wireBreadcrumb(placeEl)
const finder = new Finder(() => content, () => sourceTa)

const purify = {
  ADD_ATTR: ['data-line', 'data-wiki', 'loading'],
  SANITIZE_DOM: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|plain-doc|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
}

// ------------------------------------------------------------------ source

function setSource(next: string, record = true) {
  if (next === source) return
  if (record) {
    undoStack.push(source)
    if (undoStack.length > 300) undoStack.shift()
    redoStack.length = 0
  }
  source = next
  changed()
}

function changed() {
  dirty = true
  scheduleNotify()
  updateTitle()
}

/** Splices an edited block back into the document, keeping blank lines tidy. */
function spliceEdit(start: number, end: number, value: string) {
  const ls = source.split('\n')
  const trimmed = value.replace(/\s+$/, '')
  const ins = trimmed === '' ? [] : trimmed.split('\n')
  const count = ins.length
  let lead = 0
  let e = end
  if (count && start === end) {
    if (start > 0 && ls[start - 1]?.trim() !== '') {
      ins.unshift('')
      lead = 1
    }
    if (start < ls.length && ls[start]?.trim() !== '') ins.push('')
  }
  if (!count && end > start && e < ls.length && ls[e].trim() === '' && (start === 0 || ls[start - 1].trim() === '')) e++
  ls.splice(start, e - start, ...ins)
  return { text: ls.join('\n'), start: start + lead, end: start + lead + count }
}

function currentText() {
  if (editing) return spliceEdit(editing.start, editing.end, editing.ta.value).text
  return source
}

let notifyTimer = 0
function scheduleNotify() {
  clearTimeout(notifyTimer)
  notifyTimer = window.setTimeout(flush, 250)
}
function flush() {
  clearTimeout(notifyTimer)
  if (bridge.native) bridge.post({ type: 'change', text: currentText() })
}

function updateTitle() {
  if (!bridge.native) document.title = `${dirty ? '• ' : ''}${docName}`
}

// ------------------------------------------------------------------ render

function renderAny(): Rendered {
  if (kind === 'json') return renderJson(source)
  if (kind === 'text') return renderText(source)
  return renderDoc(source, kind === 'mdx')
}

function render() {
  const r = renderAny()
  blocks = r.blocks
  summary = r.summary
  // Text and JSON are escaped as they render; only Markdown can carry HTML.
  const markup = kind === 'markdown' || kind === 'mdx'
  const htmls = blocks.map((b) => (markup ? (DOMPurify.sanitize(b.html, purify) as string) : b.html))
  const kids = Array.from(content.children) as HTMLElement[]
  let pre = 0
  while (pre < kids.length && pre < htmls.length && rendered[pre] === htmls[pre]) pre++
  let suf = 0
  while (
    suf < kids.length - pre &&
    suf < htmls.length - pre &&
    rendered[rendered.length - 1 - suf] === htmls[htmls.length - 1 - suf]
  )
    suf++
  const ref = kids[kids.length - suf] ?? null
  kids.slice(pre, kids.length - suf).forEach((k) => k.remove())
  for (let i = pre; i < htmls.length - suf; i++) {
    const el = document.createElement('div')
    el.innerHTML = htmls[i]
    content.insertBefore(el, ref)
  }
  Array.from(content.children).forEach((el, i) => {
    el.className = `blk k-${blocks[i].kind}`
    ;(el as HTMLElement).dataset.i = String(i)
  })
  rendered = htmls
  toc.set(r.headings, kind === 'json' ? 'Keys' : 'Contents')
  body.classList.toggle('empty', source.trim() === '')
  updateStatus()
  spy()
  finder.refresh()
}

function blockIndexAt(line: number) {
  return blocks.findIndex((b) => b.start === line)
}

// ----------------------------------------------------------------- editing

function startEdit(target: number | { insertAt: number }, caret: number | 'start' | 'end' = 'end') {
  if (editing) return
  let start: number
  let end: number
  let el: HTMLElement
  let blockKind = 'p'
  const fresh = typeof target !== 'number'
  if (typeof target !== 'number') {
    const lines = source.split('\n')
    if (source.trim() === '') {
      start = 0
      end = lines.length
    } else {
      start = end = Math.min(target.insertAt, lines.length)
    }
    el = document.createElement('div')
    el.className = 'blk fresh'
    const before = blocks.findIndex((b) => b.start >= start && b.kind !== 'frontmatter')
    content.insertBefore(el, before >= 0 ? content.children[before] : null)
  } else {
    const b = blocks[target]
    if (!b || b.kind === 'footnotes') return
    start = b.start
    end = b.end
    blockKind = b.kind
    el = content.children[target] as HTMLElement
    rendered[target] = '' // force a fresh render of this block afterwards
  }

  const text = source.split('\n').slice(start, end).join('\n')
  el.innerHTML = ''
  el.classList.add('is-editing')
  const ta = document.createElement('textarea')
  ta.className = `editor k-${blockKind}`
  ta.value = text
  ta.rows = 1
  ta.spellcheck = true
  ta.placeholder = kind === 'text' ? 'Start writing.' : source.trim() === '' ? 'Start writing. Type / for blocks.' : 'Type / for blocks'
  el.append(ta)
  autosize(ta)
  const pos = caret === 'end' ? text.length : caret === 'start' ? 0 : Math.min(caret, text.length)
  ta.focus({ preventScroll: true })
  ta.setSelectionRange(pos, pos)
  keepCaretVisible(ta)

  const detach = attachEditor(ta, {
    onInput() {
      autosize(ta)
      keepCaretVisible(ta)
      dirty = true
      updateTitle()
      scheduleNotify()
    },
    onEscape: () => void commitEdit(),
    onExitUp() {
      const cur = editing!
      if (!blocks.some((b) => b.end <= cur.start && b.kind !== 'footnotes')) return false
      const r = commitEdit()!
      const prev = [...blocks].reverse().findIndex((b) => b.start < r.start && b.kind !== 'footnotes')
      if (prev >= 0) startEdit(blocks.length - 1 - prev, 'end')
      return true
    },
    onExitDown() {
      const cur = editing!
      if (!blocks.some((b) => b.start >= cur.end && b.kind !== 'footnotes' && !(fresh && b.start === cur.start))) return false
      const r = commitEdit()!
      const next = blocks.findIndex((b) => b.start >= r.end && b.kind !== 'footnotes')
      if (next >= 0) startEdit(next, 'start')
      return true
    },
    onEnterAtEnd() {
      const r = commitEdit()!
      startEdit({ insertAt: r.end })
      return true
    },
    onDeleteEmpty() {
      const r = commitEdit()!
      const prev = [...blocks].reverse().findIndex((b) => b.start < r.start && b.kind !== 'footnotes' && b.kind !== 'frontmatter')
      if (prev >= 0) startEdit(blocks.length - 1 - prev, 'end')
      return true
    },
    onMove: (dir) => moveBlock(dir),
    plain: kind === 'text',
  })
  editing = { start, end, el, ta, fresh, detach }
}

function commitEdit(): { start: number; end: number } | null {
  if (!editing) return null
  const e = editing
  editing = null
  e.detach()
  const r = spliceEdit(e.start, e.end, e.ta.value)
  if (e.fresh) e.el.remove()
  setSource(r.text)
  render()
  flush()
  return { start: r.start, end: r.end }
}

function moveBlock(dir: -1 | 1) {
  const cur = editing
  if (!cur || cur.fresh) return
  const idx = blockIndexAt(cur.start)
  const other = blocks[idx + dir]
  if (idx < 0 || !other || other.kind === 'footnotes' || other.kind === 'frontmatter') return
  const ls = source.split('\n')
  const text = cur.ta.value.replace(/\s+$/, '').split('\n')
  const caret = cur.ta.selectionStart
  let newStart: number
  if (dir < 0) {
    const gap = ls.slice(other.end, cur.start)
    const moved = [...text, ...(gap.length ? gap : ['']), ...ls.slice(other.start, other.end)]
    ls.splice(other.start, cur.end - other.start, ...moved)
    newStart = other.start
  } else {
    const gap = ls.slice(cur.end, other.start)
    const b = ls.slice(other.start, other.end)
    const g = gap.length ? gap : ['']
    ls.splice(cur.start, other.end - cur.start, ...b, ...g, ...text)
    newStart = cur.start + b.length + g.length
  }
  editing = null
  cur.detach()
  setSource(ls.join('\n'))
  render()
  flush()
  const i = blockIndexAt(newStart)
  if (i >= 0) {
    startEdit(i, caret)
    content.children[i]?.scrollIntoView({ block: 'nearest' })
  }
}

function keepCaretVisible(ta: HTMLTextAreaElement) {
  const c = caretRect(ta, ta.selectionEnd)
  if (c.top + c.height > innerHeight - 48) scrollBy({ top: c.top + c.height - innerHeight + 96 })
  else if (c.top < 24) scrollBy({ top: c.top - 96 })
}

/** Maps a click in rendered text to roughly the same spot in the source. */
function caretFromPoint(el: HTMLElement, src: string, x: number, y: number): number {
  const range = document.caretRangeFromPoint?.(x, y)
  if (!range || !el.contains(range.startContainer)) return src.length
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.startContainer, range.startOffset)
  let at = 0
  for (const ch of pre.toString()) {
    if (/\s/.test(ch)) continue
    const k = src.indexOf(ch, at)
    if (k >= 0 && k - at < 80) at = k + 1
  }
  return at
}

function toggleTaskLine(line: number) {
  const ls = source.split('\n')
  if (ls[line] == null) return
  ls[line] = ls[line].replace(/\[([ xX])\]/, (_, c: string) => (c === ' ' ? '[x]' : '[ ]'))
  setSource(ls.join('\n'))
  render()
  flush()
}

// -------------------------------------------------------------------- modes

function setMode(next: Mode) {
  if (next === 'edit' && kind === 'json') next = 'source' // JSON is edited as raw text
  if (next === mode) return
  if (editing) commitEdit()
  if (mode === 'source') leaveSource()
  if (next === 'source') modeBeforeSource = mode
  mode = next
  body.dataset.mode = next
  if (next === 'source') enterSource()
  updateStatus()
}

const toggleEdit = () => setMode(mode === 'edit' ? 'read' : 'edit')
const toggleSource = () => setMode(mode === 'source' ? (modeBeforeSource === 'source' ? 'read' : modeBeforeSource) : 'source')

function scrollFraction() {
  const max = document.documentElement.scrollHeight - innerHeight
  return max > 0 ? scrollY / max : 0
}
function restoreFraction(f: number) {
  scrollTo(0, f * (document.documentElement.scrollHeight - innerHeight))
}

function enterSource() {
  const f = scrollFraction()
  const ta = document.createElement('textarea')
  ta.className = 'editor source'
  ta.value = source
  ta.spellcheck = true
  docEl.insertBefore(ta, tailEl)
  sourceTa = ta
  autosize(ta)
  restoreFraction(f)
  ta.focus({ preventScroll: true })
  ta.setSelectionRange(0, 0)
  detachSource = attachEditor(ta, {
    onInput() {
      autosize(ta)
      setSource(ta.value, false)
    },
    onEscape: () => setMode('read'),
  })
}

function leaveSource() {
  const f = scrollFraction()
  detachSource?.()
  detachSource = null
  sourceTa?.remove()
  sourceTa = null
  render()
  restoreFraction(f)
}

// --------------------------------------------------------------- navigation

function scrollToHeading(h: Heading) {
  const behavior: ScrollBehavior = reduceMotion.matches ? 'auto' : 'smooth'
  if (sourceTa) {
    const at = source.split('\n').slice(0, h.line).join('\n').length + (h.line ? 1 : 0)
    const c = caretRect(sourceTa, at)
    scrollTo({ top: scrollY + c.top - 32, behavior })
    return
  }
  const el = document.getElementById(h.id)
  if (el) scrollTo({ top: scrollY + el.getBoundingClientRect().top - 32, behavior })
}

function scrollToId(id: string) {
  const h = toc.headings.find((x) => x.id === id)
  if (h) return scrollToHeading(h)
  const el = document.getElementById(id)
  if (el) scrollTo({ top: scrollY + el.getBoundingClientRect().top - 32, behavior: reduceMotion.matches ? 'auto' : 'smooth' })
}

let spyQueued = false
function spy() {
  if (spyQueued) return
  spyQueued = true
  requestAnimationFrame(() => {
    spyQueued = false
    const hs = toc.headings
    if (!hs.length || sourceTa) return
    let current = hs[0].id
    for (const h of hs) {
      const el = document.getElementById(h.id)
      if (el && el.getBoundingClientRect().top <= 96) current = h.id
      else if (el) break
    }
    toc.setActive(current)
  })
}
addEventListener('scroll', spy, { passive: true })

function followLink(a: HTMLAnchorElement) {
  const href = a.getAttribute('href') ?? ''
  if (href.startsWith('#')) return scrollToId(decodeURIComponent(href.slice(1)))
  if (/^(https?|mailto|tel):/i.test(href)) {
    if (bridge.native) bridge.post({ type: 'openExternal', url: href })
    else window.open(href, '_blank', 'noopener')
    return
  }
  if (bridge.native) bridge.post({ type: 'openLink', href, wiki: a.dataset.wiki === '1' })
  else toast('Links to other files open in the Mac app')
}

content.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  const box = t.closest<HTMLInputElement>('input.task-check')
  if (box) {
    e.preventDefault()
    if (editing) commitEdit()
    toggleTaskLine(Number(box.dataset.line))
    return
  }
  const copy = t.closest<HTMLButtonElement>('.code-copy')
  if (copy) {
    bridge.copy(copy.parentElement?.querySelector('pre')?.innerText.replace(/\n$/, '') ?? '')
    copy.textContent = 'Copied'
    setTimeout(() => (copy.textContent = 'Copy'), 1200)
    return
  }
  const a = t.closest<HTMLAnchorElement>('a[href]')
  if (mode === 'edit' && !(e.metaKey && a)) {
    if (t.closest('.is-editing')) return
    const blk = t.closest<HTMLElement>('.blk')
    if (!blk || getSelection()?.toString()) return
    e.preventDefault()
    let i = Number(blk.dataset.i)
    const b = blocks[i]
    if (!b || b.kind === 'footnotes') return
    const src = source.split('\n').slice(b.start, b.end).join('\n')
    const caret = caretFromPoint(blk, src, e.clientX, e.clientY)
    if (editing) {
      commitEdit()
      i = blockIndexAt(b.start)
    }
    if (i >= 0) startEdit(i, caret)
    return
  }
  if (a) {
    e.preventDefault()
    followLink(a)
  }
})

// Clicking below the last block starts a new one.
tailEl.addEventListener('mousedown', (e) => {
  if (mode !== 'edit') return
  e.preventDefault()
  if (editing?.fresh && editing.ta.value === '') return editing.ta.focus()
  if (editing) commitEdit()
  startEdit({ insertAt: source.split('\n').length })
})

// Clicks outside the open block close it.
document.addEventListener('mousedown', (e) => {
  if (!editing) return
  const t = e.target as HTMLElement
  if (editing.el.contains(t) || t.closest('.popover') || t.closest('#content') || t === tailEl) return
  commitEdit()
})

// ---------------------------------------------------------------- status

const statusMode = document.createElement('button')
const statusWords = document.createElement('span')
const themeDot = document.createElement('button')
statusMode.type = themeDot.type = 'button'
statusMode.dataset.cmd = 'mode'
themeDot.className = 'theme-dot'
themeDot.setAttribute('aria-label', 'Theme')
themeDot.title = 'Theme'
themeDot.setAttribute('aria-haspopup', 'true')
statusEl.append(themeDot, statusMode, statusWords)

function updateStatus() {
  // The button names what it does: start editing, or finish.
  statusMode.textContent = mode === 'read' ? 'Edit' : 'Done'
  statusMode.title =
    mode === 'read' ? (kind === 'json' ? 'Edit the raw JSON (⌘E)' : 'Edit this file (⌘E)') : mode === 'edit' ? 'Done editing (⌘E)' : 'Close source view (⇧⌘E)'
  if (!isProse(kind)) {
    statusWords.textContent = summary ?? ''
    return
  }
  let text = ''
  for (const el of content.children) if (!/\bk-(esm|jsx)\b/.test(el.className)) text += el.textContent + ' '
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0
  const mins = Math.max(1, Math.round(words / 230))
  statusWords.textContent = `${words.toLocaleString()} words · ${mins} min`
}
statusMode.addEventListener('click', () => command(mode === 'source' ? 'toggleSource' : 'toggleEdit'))

// A polite live region, rendered empty first so screen readers announce each message.
const toastEl = document.createElement('div')
toastEl.className = 'toast'
toastEl.setAttribute('role', 'status')
body.append(toastEl)
let toastTimer = 0
function toast(text: string, ms = 2400) {
  toastEl.textContent = text
  toastEl.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), ms)
}

// ------------------------------------------------------------------ themes

const THEMES: { id: string; name: string; swatch: string[]; dark?: boolean }[] = [
  { id: 'stone', name: 'Stone', swatch: ['#fafaf9', '#78716c', '#1c1917'] },
  { id: 'olive', name: 'Olive', swatch: ['#f6f5ee', '#9a9c6b', '#545830'] },
  { id: 'olive-night', name: 'Olive night', swatch: ['#1b1d13', '#545830', '#b4b889'], dark: true },
  { id: 'terracotta', name: 'Terracotta', swatch: ['#fbf6f2', '#ffbe98', '#c4605e'] },
  { id: 'graphite', name: 'Graphite', swatch: ['#121212', '#3a3a3a', '#b9a3f5'], dark: true },
]
const systemDark = matchMedia('(prefers-color-scheme: dark)')
let theme = localStorage.getItem('plain.theme') ?? 'stone'

function applyTheme(id: string) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0]
  theme = t.id
  localStorage.setItem('plain.theme', t.id)
  const root = document.documentElement
  // Swap colours in one frame, with transitions off, so nothing smears.
  root.classList.add('no-transitions')
  if (t.id === 'stone') delete root.dataset.theme
  else root.dataset.theme = t.id
  const dark = t.dark ?? (t.id === 'stone' && systemDark.matches)
  root.toggleAttribute('data-dark', dark)
  void root.offsetHeight
  requestAnimationFrame(() => root.classList.remove('no-transitions'))
  const bg = getComputedStyle(document.body).backgroundColor
  bridge.post({ type: 'theme', id: t.id, bg, dark, followsSystem: t.id === 'stone' })
  themeMenu?.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.theme === t.id)))
}
systemDark.addEventListener('change', () => applyTheme(theme))
// Every open window follows a theme change made in another one.
addEventListener('storage', (e) => {
  if (e.key === 'plain.theme' && e.newValue && e.newValue !== theme) applyTheme(e.newValue)
})

let themeMenu: HTMLElement | null = null
function toggleThemeMenu() {
  if (themeMenu) {
    themeMenu.remove()
    themeMenu = null
    themeDot.setAttribute('aria-expanded', 'false')
    return
  }
  themeMenu = document.createElement('div')
  themeMenu.className = 'popover themes'
  themeMenu.setAttribute('role', 'menu')
  themeMenu.setAttribute('aria-label', 'Theme')
  themeMenu.innerHTML = THEMES.map(
    (t) =>
      `<button type="button" role="menuitemradio" data-theme="${t.id}" aria-checked="${t.id === theme}"><span class="sw" aria-hidden="true">${t.swatch
        .map((c) => `<i style="background:${c}"></i>`)
        .join('')}</span>${t.name}</button>`,
  ).join('')
  themeMenu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-theme]')
    if (b) applyTheme(b.dataset.theme!)
  })
  themeMenu.addEventListener('keydown', (e) => {
    const items = [...themeMenu!.querySelectorAll<HTMLElement>('button')]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      toggleThemeMenu()
      themeDot.focus()
    }
  })
  body.append(themeMenu)
  themeDot.setAttribute('aria-expanded', 'true')
  themeMenu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
}
themeDot.addEventListener('click', toggleThemeMenu)
document.addEventListener('mousedown', (e) => {
  const t = e.target as HTMLElement
  if (themeMenu && !themeMenu.contains(t) && t !== themeDot) toggleThemeMenu()
})
applyTheme(theme)

// --------------------------------------------------------------- shortcuts

const SHORTCUTS: [string, string][] = [
  ['⌘E', 'Switch reading and editing'],
  ['⇧⌘E', 'Source view'],
  ['⌘\\', 'Show or hide contents'],
  ['⌘F', 'Find'],
  ['⌘+ ⌘− ⌘0', 'Text size'],
  ['Esc', 'Close the block, then stop editing'],
  ['↑ ↓', 'Move between blocks'],
  ['⇧⌘↑ ⇧⌘↓', 'Move a block'],
  ['/', 'Insert a block'],
  ['⌘B ⌘I', 'Bold, italic'],
  ['⇧⌘X ⇧⌘C ⇧⌘H', 'Strike, code, highlight'],
  ['⌘K', 'Link'],
  ['⌘↩', 'Toggle to-do'],
  ['Tab ⇧Tab', 'Indent list'],
  ['⌘Z ⇧⌘Z', 'Undo, redo'],
]

function toggleShortcuts() {
  let el = document.querySelector<HTMLElement>('.shortcuts')
  if (el) return el.remove()
  el = document.createElement('div')
  el.className = 'popover shortcuts'
  el.innerHTML = `<div class="toc-title">Shortcuts</div><dl>${SHORTCUTS.map(([k, v]) => `<div><dt>${v}</dt><dd>${k
    .split(' ')
    .map((x) => `<kbd>${x}</kbd>`)
    .join('')}</dd></div>`).join('')}</dl>`
  el.addEventListener('click', () => el!.remove())
  body.append(el)
}

let zoom = Number(localStorage.getItem('plain.zoom') || 1)
function setZoom(z: number) {
  zoom = Math.min(1.6, Math.max(0.8, Math.round(z * 100) / 100))
  document.documentElement.style.setProperty('--zoom', String(zoom))
  localStorage.setItem('plain.zoom', String(zoom))
}
setZoom(zoom)

function toggleToc() {
  const off = body.classList.toggle('toc-off')
  localStorage.setItem('plain.toc', off ? 'off' : 'on')
}
if (localStorage.getItem('plain.toc') === 'off') body.classList.add('toc-off')

function undo(redo = false) {
  const ta = activeEditor()
  if (ta) {
    document.execCommand(redo ? 'redo' : 'undo')
    return
  }
  const from = redo ? redoStack : undoStack
  const to = redo ? undoStack : redoStack
  const prev = from.pop()
  if (prev === undefined) return
  to.push(source)
  source = prev
  changed()
  render()
  flush()
}

function command(name: string) {
  if (name.startsWith('theme:')) return applyTheme(name.slice(6))
  switch (name) {
    case 'toggleEdit': return kind === 'json' ? toggleSource() : mode === 'source' ? setMode('edit') : toggleEdit()
    case 'toggleSource': return toggleSource()
    case 'toggleToc': return toggleToc()
    case 'find': return finder.open()
    case 'findNext': return finder.step(1)
    case 'findPrevious': return finder.step(-1)
    case 'zoomIn': return setZoom(zoom + 0.1)
    case 'zoomOut': return setZoom(zoom - 0.1)
    case 'zoomReset': return setZoom(1)
    case 'shortcuts': return toggleShortcuts()
    case 'themes': return toggleThemeMenu()
    case 'undo': return undo()
    case 'redo': return undo(true)
    case 'bold': case 'italic': case 'strike': case 'code': case 'highlight': case 'link': case 'task': {
      if (kind !== 'markdown' && kind !== 'mdx') return
      const ta = activeEditor()
      if (ta) format(ta, name as Format)
      return
    }
  }
}

addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey
  if (mod) flush() // the native document is current before ⌘S
  const t = e.target as HTMLElement
  const typing = t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement
  const run = (name: string) => {
    e.preventDefault()
    command(name)
  }
  if (mod && !e.altKey && e.code === 'KeyE') return run(e.shiftKey ? 'toggleSource' : 'toggleEdit')
  if (mod && e.altKey && e.code === 'KeyE') return run('toggleEdit')
  if (mod && e.code === 'Backslash') return run('toggleToc')
  if (mod && e.code === 'KeyF') return run('find')
  if (mod && e.code === 'KeyG') return run(e.shiftKey ? 'findPrevious' : 'findNext')
  if (mod && (e.key === '=' || e.key === '+')) return run('zoomIn')
  if (mod && e.key === '-') return run('zoomOut')
  if (mod && e.key === '0') return run('zoomReset')
  if (mod && e.code === 'Slash') return run('shortcuts')
  if (mod && e.code === 'KeyZ' && !typing) return run(e.shiftKey ? 'redo' : 'undo')
  if (!bridge.native && mod && e.code === 'KeyO') {
    e.preventDefault()
    return void openFile()
  }
  if (!bridge.native && mod && e.code === 'KeyS') {
    e.preventDefault()
    return void saveFile()
  }
  if (e.key === 'Escape') {
    const sc = document.querySelector('.shortcuts')
    if (sc) return sc.remove()
    if (finder.isOpen) return finder.close()
    if (mode !== 'read' && !typing) return setMode('read')
  }
  if (mode === 'edit' && !editing && !typing && e.key === 'Enter') {
    e.preventDefault()
    const first = blocks.findIndex((b) => {
      const el = content.querySelector<HTMLElement>(`[data-i="${blocks.indexOf(b)}"]`)
      return b.kind !== 'footnotes' && !!el && el.getBoundingClientRect().bottom > 40
    })
    if (first >= 0) startEdit(first, 'end')
    else startEdit({ insertAt: source.split('\n').length })
  }
})

addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement
  if (bridge.native && !getSelection()?.toString() && !(t instanceof HTMLTextAreaElement) && !t.closest('a,img,input')) e.preventDefault()
})
addEventListener('blur', flush)

// -------------------------------------------------------------- documents

function setKind(next: Kind) {
  kind = next
  body.dataset.kind = next
}
setKind(kind)

function load(text: string, name: string, keepView = false, as?: Kind) {
  if (editing) {
    editing.detach()
    if (editing.fresh) editing.el.remove()
    editing = null
  }
  closePopovers()
  const y = scrollY
  const next = text.replace(/\r\n?/g, '\n')
  docName = name
  const nextKind = as ?? kindFromName(name)
  if (nextKind !== kind) {
    setKind(nextKind)
    keepView = false
  }
  if (!keepView) {
    undoStack.length = 0
    redoStack.length = 0
    rendered = []
    content.innerHTML = ''
  } else if (next !== source) {
    undoStack.push(source)
  }
  source = next
  dirty = false
  updateTitle()
  if (sourceTa) {
    if (sourceTa.value !== source) sourceTa.value = source
    autosize(sourceTa)
  } else {
    render()
  }
  if (keepView) scrollTo(0, y)
  else {
    scrollTo(0, 0)
    const empty = source.trim() === ''
    if (kind === 'json') setMode(empty ? 'source' : 'read')
    else {
      setMode(empty ? 'edit' : 'read')
      if (empty) startEdit({ insertAt: 0 })
    }
  }
}

async function openFile() {
  type Picker = (o: object) => Promise<FileSystemFileHandle[]>
  const pick = (window as unknown as { showOpenFilePicker?: Picker }).showOpenFilePicker
  if (pick) {
    try {
      const [h] = await pick({
        types: [
          { description: 'Markdown, MDX and text', accept: { 'text/markdown': ['.md', '.markdown', '.mdx'], 'text/plain': ['.txt'] } },
          { description: 'JSON', accept: { 'application/json': ['.json'] } },
        ],
      })
      const f = await h.getFile()
      fileHandle = h
      load(await f.text(), f.name)
    } catch {
      /* cancelled */
    }
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.md,.markdown,.mdx,.txt,.json,text/markdown,text/plain,application/json'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (f) load(await f.text(), f.name)
  }
  input.click()
}

async function saveFile() {
  const text = currentText()
  type SavePicker = (o: object) => Promise<FileSystemFileHandle>
  const pick = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  try {
    if (!fileHandle && pick) fileHandle = await pick({ suggestedName: /\.[^.]+$/.test(docName) ? docName : `${docName}.md` })
    if (!fileHandle) return toast('Saving needs Chrome or the Mac app')
    const w = await (fileHandle as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable()
    await w.write(text)
    await w.close()
    dirty = false
    updateTitle()
    toast('Saved')
  } catch {
    /* cancelled */
  }
}

if (!bridge.native) {
  addEventListener('dragover', (e) => {
    e.preventDefault()
    body.classList.add('dropping')
  })
  addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) body.classList.remove('dropping')
  })
  addEventListener('drop', async (e) => {
    e.preventDefault()
    body.classList.remove('dropping')
    const f = e.dataTransfer?.files[0]
    if (f) {
      fileHandle = null
      load(await f.text(), f.name)
    }
  })
}

// The native shell drives these.
;(window as unknown as { plain: unknown }).plain = {
  open(doc: { text: string; name: string; reload?: boolean; kind?: Kind }) {
    load(doc.text, doc.name, !!doc.reload, doc.kind)
  },
  command,
  notice: (text: string) => toast(text, 4000),
  location(loc: Location & { kind?: Kind }) {
    // Rename can change the extension, and with it how the file reads.
    if (loc.kind && loc.kind !== kind) {
      if (editing) commitEdit()
      if (mode !== 'read') setMode('read')
      setKind(loc.kind)
      rendered = []
      content.innerHTML = ''
      render()
    }
    renderBreadcrumb(placeEl, loc)
    toc.setFolder(loc.path, loc.siblings)
  },
  text: () => currentText(),
}

if (bridge.native) {
  body.classList.add('native')
  bridge.post({ type: 'ready' })
} else {
  load(welcome, 'Welcome.md')
}
