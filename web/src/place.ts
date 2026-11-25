import { bridge } from './bridge'

// Where the file lives: a path breadcrumb above the document. Each folder
// opens in Finder, the file name reveals the file.

export interface Location {
  path?: string
  home: string
  siblings?: string[]
  open?: string[]
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function renderBreadcrumb(el: HTMLElement, loc: Location) {
  if (!loc.path) {
    el.hidden = true
    el.innerHTML = ''
    return
  }
  const inHome = loc.path.startsWith(loc.home + '/')
  const shown = inHome ? loc.path.slice(loc.home.length + 1) : loc.path.replace(/^\//, '')
  const parts = shown.split('/')
  const rootPath = inHome ? loc.home : ''
  const segs = parts.map((name, i) => ({
    name,
    path: `${rootPath}/${parts.slice(0, i + 1).join('/')}`,
    file: i === parts.length - 1,
  }))
  const crumbs = [{ name: inHome ? '~' : '/', path: rootPath || '/', file: false }, ...segs]

  // Long paths keep the start and the last three steps; the middle expands on click.
  const collapse = crumbs.length > 6
  const head = collapse ? crumbs.slice(0, 1) : crumbs
  const middle = collapse ? crumbs.slice(1, -3) : []
  const tail = collapse ? crumbs.slice(-3) : []

  const crumb = (c: (typeof crumbs)[number]) =>
    `<button type="button" class="crumb${c.file ? ' file' : ''}" data-path="${esc(c.path)}" title="${c.file ? 'Show in Finder' : 'Open in Finder'}: ${esc(c.path)}">${esc(c.name)}</button>`
  const sep = '<span class="sep" aria-hidden="true">/</span>'

  // "/" already reads as the root, so it needs no separator after it.
  const join = (list: typeof crumbs) => list.map((c, i) => crumb(c) + (i < list.length - 1 && c.name !== '/' ? sep : '')).join('')
  el.innerHTML =
    join(head) +
    (collapse
      ? `${head[0].name === '/' ? '' : sep}<button type="button" class="crumb more" title="${esc(middle.map((m) => m.name).join('/'))}" aria-label="Show full path">…</button><span class="middle" hidden>${sep}${join(middle)}</span>${sep}${join(tail)}`
      : '')
  el.hidden = false
}

export function wireBreadcrumb(el: HTMLElement) {
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    if (b.classList.contains('more')) {
      const middle = el.querySelector<HTMLElement>('.middle')
      if (middle) {
        const nodes = Array.from(middle.childNodes).slice(1) // drop its leading separator
        middle.remove()
        b.replaceWith(...nodes)
      }
      return
    }
    if (b.dataset.path) bridge.post({ type: 'reveal', path: b.dataset.path })
  })
}
