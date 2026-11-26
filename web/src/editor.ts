// Behaviour for any Markdown textarea: shortcuts, list continuation, the "/"
// insert menu and the formatting toolbar on selection.

export interface EditorHooks {
  onInput?(): void
  onEscape?(): void
  onExitUp?(): boolean
  onExitDown?(): boolean
  onMove?(dir: -1 | 1): void
  onDeleteEmpty?(): boolean
  onEnterAtEnd?(): boolean
  /** Plain text: no Markdown shortcuts, / menu or format toolbar. */
  plain?: boolean
}

const plainEditors = new WeakSet<HTMLTextAreaElement>()

export type Format = 'bold' | 'italic' | 'strike' | 'code' | 'highlight' | 'link' | 'task'

let active: HTMLTextAreaElement | null = null
export const activeEditor = () => active

// ---------------------------------------------------------------- text edits

/** Replaces a range through the browser's editing stack, so ⌘Z still works. */
function replaceRange(ta: HTMLTextAreaElement, start: number, end: number, text: string, selStart?: number, selEnd?: number) {
  ta.focus()
  ta.setSelectionRange(start, end)
  const ok = text === '' ? start === end || document.execCommand('delete') : document.execCommand('insertText', false, text)
  if (!ok) {
    ta.setRangeText(text, start, end, 'end')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
  if (selStart != null) ta.setSelectionRange(selStart, selEnd ?? selStart)
}

function lineBounds(v: string, pos: number) {
  const start = v.lastIndexOf('\n', pos - 1) + 1
  const nl = v.indexOf('\n', pos)
  return { start, end: nl === -1 ? v.length : nl }
}

function wordAt(v: string, pos: number): [number, number] | null {
  let s = pos
  let e = pos
  while (s > 0 && /[\p{L}\p{N}_'-]/u.test(v[s - 1])) s--
  while (e < v.length && /[\p{L}\p{N}_'-]/u.test(v[e])) e++
  return s === e ? null : [s, e]
}

const MARKS: Record<string, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
  highlight: ['==', '=='],
}

function toggleWrap(ta: HTMLTextAreaElement, a: string, b: string) {
  const v = ta.value
  let s = ta.selectionStart
  let e = ta.selectionEnd
  if (s === e) {
    const w = wordAt(v, s)
    if (w) [s, e] = w
  }
  const inner = v.slice(s, e)
  const wrappedOutside =
    v.slice(s - a.length, s) === a && v.slice(e, e + b.length) === b && !(a === '*' && v[s - 2] === '*' && v[e + 1] === '*')
  if (wrappedOutside) {
    replaceRange(ta, s - a.length, e + b.length, inner, s - a.length, e - a.length)
  } else if (inner.length >= a.length + b.length && inner.startsWith(a) && inner.endsWith(b)) {
    const bare = inner.slice(a.length, inner.length - b.length)
    replaceRange(ta, s, e, bare, s, s + bare.length)
  } else {
    replaceRange(ta, s, e, a + inner + b, s + a.length, e + a.length)
  }
}

function makeLink(ta: HTMLTextAreaElement) {
  const s = ta.selectionStart
  const e = ta.selectionEnd
  const sel = ta.value.slice(s, e)
  if (/^(https?:\/\/|mailto:)\S+$/.test(sel)) replaceRange(ta, s, e, `[](${sel})`, s + 1)
  else replaceRange(ta, s, e, `[${sel}]()`, s + sel.length + 3)
}

const LIST = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/

function toggleTask(ta: HTMLTextAreaElement) {
  const v = ta.value
  const { start, end } = lineBounds(v, ta.selectionStart)
  const line = v.slice(start, end)
  const caret = ta.selectionStart
  const m = LIST.exec(line)
  let next: string
  if (m?.[4]) next = line.replace(/\[([ xX])\]/, (_, c: string) => (c === ' ' ? '[x]' : '[ ]'))
  else if (m) next = line.slice(0, m[0].length) + '[ ] ' + line.slice(m[0].length)
  else next = line.replace(/^(\s*)/, '$1- [ ] ')
  replaceRange(ta, start, end, next, caret + (next.length - line.length))
}

export function format(ta: HTMLTextAreaElement, kind: Format) {
  if (kind === 'link') makeLink(ta)
  else if (kind === 'task') toggleTask(ta)
  else toggleWrap(ta, ...MARKS[kind])
  toolbar.update()
}

function openFence(v: string) {
  return (v.match(/^\s*(```|~~~)/gm)?.length ?? 0) % 2 === 1
}

function handleEnter(ta: HTMLTextAreaElement, hooks: EditorHooks): boolean {
  const v = ta.value
  const s = ta.selectionStart
  if (s !== ta.selectionEnd) return false
  const { start, end } = lineBounds(v, s)
  const line = v.slice(start, end)

  if (!openFence(v.slice(0, s))) {
    const m = LIST.exec(line)
    if (m && s >= start + m[0].length) {
      if (line.slice(m[0].length).trim() === '') {
        replaceRange(ta, start, end, '', start) // empty item ends the list
        return true
      }
      const num = /^(\d+)([.)])$/.exec(m[2])
      const marker = num ? `${Number(num[1]) + 1}${num[2]}` : m[2]
      replaceRange(ta, s, s, `\n${m[1]}${marker}${m[3]}${m[4] ? '[ ] ' : ''}`)
      return true
    }
    const q = /^(\s*(?:>\s?)+)/.exec(line)
    if (q && s >= start + q[0].length) {
      if (line.slice(q[0].length).trim() === '') replaceRange(ta, start, end, '', start)
      else replaceRange(ta, s, s, '\n' + q[1])
      return true
    }
  }

  if (!hooks.onEnterAtEnd || s !== v.length || openFence(v)) return false
  // A heading is one line, so Enter moves on. Elsewhere, a blank line does.
  if ((/^#{1,6}\s/.test(v) && !v.includes('\n')) || v.endsWith('\n')) return hooks.onEnterAtEnd()
  return false
}

function indentLines(ta: HTMLTextAreaElement, dir: 1 | -1): boolean {
  const v = ta.value
  const s = ta.selectionStart
  const e = ta.selectionEnd
  const first = lineBounds(v, s).start
  const last = lineBounds(v, e).end
  const rows = v.slice(first, last).split('\n')
  const isList = rows.some((r) => LIST.test(r))
  if (!isList) {
    if (dir > 0 && s === e) {
      replaceRange(ta, s, e, '  ')
      return true
    }
    return dir < 0 // swallow shift-tab so focus stays put
  }
  const indentOf = (r: string) => /^\s*/.exec(r)![0].length
  const above = v.slice(0, Math.max(0, first - 1)).split('\n')
  const cur = indentOf(rows[0])
  let target: number
  if (dir > 0) {
    const parent = above[above.length - 1] ?? ''
    const m = LIST.exec(parent)
    target = m ? m[1].length + m[2].length + m[3].length : cur + 2
    if (target <= cur) target = cur + 2
  } else {
    const parent = [...above].reverse().find((r) => r.trim() && indentOf(r) < cur)
    target = parent ? indentOf(parent) : 0
  }
  const delta = target - cur
  const next = rows
    .map((r) => (delta >= 0 ? ' '.repeat(delta) + r : r.slice(Math.min(-delta, indentOf(r)))))
    .join('\n')
  replaceRange(ta, first, last, next, Math.max(first, s + delta), Math.max(first, e + delta * rows.length))
  return true
}

// ---------------------------------------------------------- caret geometry

const MIRROR = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight',
  'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
  'letterSpacing', 'wordSpacing', 'tabSize', 'direction',
] as const

/** Viewport position of a character offset inside a textarea. */
export function caretRect(ta: HTMLTextAreaElement, pos: number) {
  const cs = getComputedStyle(ta)
  const div = document.createElement('div')
  for (const p of MIRROR) div.style[p] = cs[p]
  Object.assign(div.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', height: 'auto',
  })
  div.textContent = ta.value.slice(0, pos)
  const span = document.createElement('span')
  span.textContent = ta.value.slice(pos) || '.'
  div.appendChild(span)
  document.body.appendChild(div)
  const r = ta.getBoundingClientRect()
  const lh = parseFloat(cs.lineHeight) || span.offsetHeight
  const out = {
    top: r.top + span.offsetTop + parseFloat(cs.borderTopWidth) - ta.scrollTop,
    left: r.left + span.offsetLeft + parseFloat(cs.borderLeftWidth) - ta.scrollLeft,
    height: lh,
  }
  div.remove()
  return out
}

function onEdgeLine(ta: HTMLTextAreaElement, edge: 'first' | 'last') {
  if (ta.selectionStart !== ta.selectionEnd) return false
  const cs = getComputedStyle(ta)
  const r = ta.getBoundingClientRect()
  const c = caretRect(ta, ta.selectionStart)
  if (edge === 'first') return c.top - r.top - parseFloat(cs.paddingTop) < c.height * 0.8
  return r.bottom - parseFloat(cs.paddingBottom) - (c.top + c.height) < c.height * 0.8
}

// ------------------------------------------------------------- slash menu

interface SlashItem {
  label: string
  syntax: string
  insert: string
  after?: string
}

const SLASH: SlashItem[] = [
  { label: 'Heading 1', syntax: '#', insert: '# ' },
  { label: 'Heading 2', syntax: '##', insert: '## ' },
  { label: 'Heading 3', syntax: '###', insert: '### ' },
  { label: 'Bulleted list', syntax: '-', insert: '- ' },
  { label: 'Numbered list', syntax: '1.', insert: '1. ' },
  { label: 'To-do', syntax: '- [ ]', insert: '- [ ] ' },
  { label: 'Quote', syntax: '>', insert: '> ' },
  { label: 'Callout', syntax: '> [!note]', insert: '> [!note] ' },
  { label: 'Code block', syntax: '```', insert: '```\n', after: '\n```' },
  { label: 'Table', syntax: '| |', insert: '| Column | Column |\n| --- | --- |\n| ', after: ' |  |' },
  { label: 'Divider', syntax: '---', insert: '---\n' },
  { label: 'Image', syntax: '![]()', insert: '![](', after: ')' },
  { label: 'Line break', syntax: '<br>', insert: '<br>\n' },
]

const slash = (() => {
  const el = document.createElement('div')
  el.className = 'popover slash'
  el.id = 'slash-menu'
  el.setAttribute('role', 'listbox')
  el.setAttribute('aria-label', 'Insert block')
  let ta: HTMLTextAreaElement | null = null
  let at = -1
  let items: SlashItem[] = []
  let index = 0

  el.addEventListener('mousedown', (e) => e.preventDefault())
  el.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')
    if (row) choose(Number(row.dataset.i))
  })
  el.addEventListener('mousemove', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')
    if (row && Number(row.dataset.i) !== index) {
      index = Number(row.dataset.i)
      paint()
    }
  })

  function paint() {
    el.innerHTML = items.length
      ? items
          .map(
            (it, i) =>
              `<div class="row${i === index ? ' on' : ''}" id="slash-${i}" data-i="${i}" role="option" aria-selected="${i === index}"><span>${it.label}</span><code>${it.syntax.replace(/</g, '&lt;')}</code></div>`,
          )
          .join('')
      : '<div class="none">No matches</div>'
    // Focus stays in the textarea; the highlighted row is announced through it.
    if (ta && items.length) ta.setAttribute('aria-activedescendant', `slash-${index}`)
    else ta?.removeAttribute('aria-activedescendant')
    el.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }

  function place() {
    if (!ta) return
    const c = caretRect(ta, at)
    el.style.left = `${Math.max(8, Math.min(c.left - 10, innerWidth - 248))}px`
    const below = c.top + c.height + 6
    const h = el.offsetHeight || 280
    el.style.top = `${below + h > innerHeight - 8 ? Math.max(8, c.top - h - 6) : below}px`
  }

  function open(target: HTMLTextAreaElement, pos: number) {
    ta = target
    at = pos
    index = 0
    target.setAttribute('aria-controls', el.id)
    if (!el.isConnected) document.body.appendChild(el)
    el.hidden = false
    update()
  }

  function close() {
    ta?.removeAttribute('aria-activedescendant')
    ta?.removeAttribute('aria-controls')
    el.hidden = true
    ta = null
    at = -1
  }

  function update() {
    if (!ta) return
    const caret = ta.selectionStart
    const q = ta.value.slice(at + 1, caret)
    if (caret <= at || ta.value[at] !== '/' || /\s/.test(q) || q.length > 20) return close()
    const ql = q.toLowerCase()
    items = SLASH.filter((it) => it.label.toLowerCase().includes(ql) || it.syntax.includes(q))
    index = Math.min(index, Math.max(0, items.length - 1))
    paint()
    place()
  }

  function choose(i: number) {
    const it = items[i]
    const t = ta
    if (!it || !t) return close()
    const start = at
    const end = t.selectionStart
    close()
    replaceRange(t, start, end, it.insert + (it.after ?? ''), start + it.insert.length)
  }

  function handleKey(e: KeyboardEvent): boolean {
    if (el.hidden) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (items.length) index = (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      paint()
      return true
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && items.length) {
      choose(index)
      return true
    }
    if (e.key === 'Escape') {
      close()
      return true
    }
    return false
  }

  /** Opens when "/" is typed at the start of a line. */
  function maybeOpen(target: HTMLTextAreaElement, data: string | null) {
    if (!data?.includes('/')) return
    const caret = target.selectionStart
    const lineStart = target.value.lastIndexOf('\n', caret - 1) + 1
    const m = /^\s*\/[^\s/]*$/.exec(target.value.slice(lineStart, caret))
    if (m) open(target, lineStart + m[0].indexOf('/'))
  }

  return { el, close, update, handleKey, maybeOpen, get isOpen() { return !el.hidden && !!ta } }
})()

// ---------------------------------------------------------- format toolbar

const TOOLS: [Format, string, string][] = [
  ['bold', '<b>B</b>', 'Bold ⌘B'],
  ['italic', '<i>I</i>', 'Italic ⌘I'],
  ['strike', '<s>S</s>', 'Strikethrough ⇧⌘X'],
  ['code', '<code>{}</code>', 'Code ⇧⌘C'],
  ['highlight', '<mark>H</mark>', 'Highlight ⇧⌘H'],
  ['link', '<u>Link</u>', 'Link ⌘K'],
]

const toolbar = (() => {
  const el = document.createElement('div')
  el.className = 'popover toolbar'
  el.hidden = true
  el.setAttribute('role', 'toolbar')
  el.setAttribute('aria-label', 'Format')
  el.innerHTML = TOOLS.map(
    ([k, html, title]) => `<button type="button" data-f="${k}" title="${title}" aria-label="${title.replace(/ [⇧⌘].*$/, '')}">${html}</button>`,
  ).join('')
  el.addEventListener('mousedown', (e) => e.preventDefault())
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-f]')
    if (b && active) format(active, b.dataset.f as Format)
  })

  function update() {
    const ta = active
    if (!ta || plainEditors.has(ta) || ta.selectionStart === ta.selectionEnd || slash.isOpen || document.activeElement !== ta) {
      el.hidden = true
      return
    }
    if (!el.isConnected) document.body.appendChild(el)
    el.hidden = false
    const c = caretRect(ta, ta.selectionStart)
    const top = c.top - el.offsetHeight - 8
    el.style.top = `${top < 8 ? c.top + c.height + 8 : top}px`
    el.style.left = `${Math.max(8, Math.min(c.left - 12, innerWidth - el.offsetWidth - 8))}px`
  }
  return { el, update, hide: () => (el.hidden = true) }
})()

addEventListener('scroll', () => toolbar.hide(), { passive: true })

export function closePopovers() {
  slash.close()
  toolbar.hide()
}

// ------------------------------------------------------------------ attach

const PAIRS: Record<string, string> = { '*': '*', _: '_', '`': '`', '~': '~', '=': '=', '(': ')', '[': ']', '"': '"' }

export function attachEditor(ta: HTMLTextAreaElement, hooks: EditorHooks): () => void {
  const plain = !!hooks.plain
  if (plain) plainEditors.add(ta)
  const onKey = (e: KeyboardEvent) => {
    if (slash.handleKey(e)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    const mod = e.metaKey || e.ctrlKey
    const handled = ((): boolean => {
      if (mod && !e.altKey && plain) {
        if (e.code === 'ArrowUp' && e.shiftKey && hooks.onMove) { hooks.onMove(-1); return true }
        if (e.code === 'ArrowDown' && e.shiftKey && hooks.onMove) { hooks.onMove(1); return true }
        return false
      }
      if (mod && !e.altKey) {
        switch (e.code) {
          case 'KeyB': if (!e.shiftKey) { format(ta, 'bold'); return true } break
          case 'KeyI': if (!e.shiftKey) { format(ta, 'italic'); return true } break
          case 'KeyK': format(ta, 'link'); return true
          case 'KeyX': if (e.shiftKey) { format(ta, 'strike'); return true } break
          case 'KeyC': if (e.shiftKey) { format(ta, 'code'); return true } break
          case 'KeyH': if (e.shiftKey) { format(ta, 'highlight'); return true } break
          case 'Enter': format(ta, 'task'); return true
          case 'ArrowUp': if (e.shiftKey && hooks.onMove) { hooks.onMove(-1); return true } break
          case 'ArrowDown': if (e.shiftKey && hooks.onMove) { hooks.onMove(1); return true } break
        }
        return false
      }
      if (mod || e.altKey || e.isComposing) return false
      switch (e.key) {
        case 'Escape':
          if (!hooks.onEscape) return false
          hooks.onEscape()
          return true
        case 'Enter':
          if (plain) {
            // A blank line ends the paragraph, as it does in the file.
            const at = ta.selectionStart
            return !e.shiftKey && at === ta.selectionEnd && at === ta.value.length && ta.value.endsWith('\n') && !!hooks.onEnterAtEnd && hooks.onEnterAtEnd()
          }
          return !e.shiftKey && handleEnter(ta, hooks)
        case 'Tab':
          return indentLines(ta, e.shiftKey ? -1 : 1)
        case 'ArrowUp':
          return !e.shiftKey && !!hooks.onExitUp && onEdgeLine(ta, 'first') && hooks.onExitUp()
        case 'ArrowDown':
          return !e.shiftKey && !!hooks.onExitDown && onEdgeLine(ta, 'last') && hooks.onExitDown()
        case 'Backspace':
          return ta.value === '' && !!hooks.onDeleteEmpty && hooks.onDeleteEmpty()
      }
      if (!plain && ta.selectionStart !== ta.selectionEnd && PAIRS[e.key]) {
        const s = ta.selectionStart
        const e2 = ta.selectionEnd
        const inner = ta.value.slice(s, e2)
        replaceRange(ta, s, e2, e.key + inner + PAIRS[e.key], s + 1, e2 + 1)
        return true
      }
      return false
    })()
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  const onInput = (e: Event) => {
    if (plain) {
      hooks.onInput?.()
      return
    }
    if (!slash.isOpen) slash.maybeOpen(ta, (e as InputEvent).data ?? null)
    else slash.update()
    hooks.onInput?.()
    toolbar.update()
  }
  const onSelect = () => {
    if (slash.isOpen) slash.update()
    toolbar.update()
  }
  const onFocus = () => (active = ta)
  const onBlur = () => setTimeout(() => {
    if (document.activeElement !== ta) {
      if (active === ta) active = null
      closePopovers()
    }
  })

  ta.addEventListener('keydown', onKey)
  ta.addEventListener('input', onInput)
  ta.addEventListener('mouseup', onSelect)
  ta.addEventListener('keyup', onSelect)
  ta.addEventListener('select', onSelect)
  ta.addEventListener('focus', onFocus)
  ta.addEventListener('blur', onBlur)
  active = ta
  return () => {
    ta.removeEventListener('keydown', onKey)
    ta.removeEventListener('input', onInput)
    ta.removeEventListener('mouseup', onSelect)
    ta.removeEventListener('keyup', onSelect)
    ta.removeEventListener('select', onSelect)
    ta.removeEventListener('focus', onFocus)
    ta.removeEventListener('blur', onBlur)
    if (active === ta) active = null
    closePopovers()
  }
}

/** Grows a textarea to fit its text without moving the page. */
export function autosize(ta: HTMLTextAreaElement) {
  const y = scrollY
  ta.style.height = 'auto'
  ta.style.height = `${ta.scrollHeight}px`
  if (scrollY !== y) scrollTo(0, y)
}
