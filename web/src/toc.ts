import type { Heading } from './markdown'

// The margin: the file's folder with its sibling Markdown files, then the
// contents. A quiet column on wide windows; on narrow ones a rail of short
// dashes on the right that opens on hover.

/** Document text in the left-to-right chrome: isolated, so Hebrew or Arabic names read right, rows still align left. */
function bdi(text: string) {
  const el = document.createElement('bdi')
  el.textContent = text
  return el
}

export class Toc {
  private list: HTMLOListElement
  private files: HTMLOListElement
  private elsewhere: HTMLOListElement
  private folderTitle: HTMLElement
  private rail: HTMLElement
  private items: { h: Heading; a: HTMLAnchorElement; dash: HTMLElement }[] = []
  private signature = ''
  private activeId = ''
  private hasFolder = false
  private hasElsewhere = false
  private hasHeadings = false

  constructor(
    private nav: HTMLElement,
    private onPick: (h: Heading) => void,
    private onOpenFile: (path: string) => void,
  ) {
    // The rail repeats the panel in miniature, so screen readers skip it.
    nav.innerHTML = `<div class="toc-panel">
      <section class="toc-elsewhere" aria-labelledby="toc-elsewhere-title" hidden><div class="toc-title" id="toc-elsewhere-title">Also open</div><ol class="toc-files toc-open"></ol></section>
      <section class="toc-folder" aria-labelledby="toc-folder-title" hidden><div class="toc-title" id="toc-folder-title"></div><ol class="toc-files"></ol></section>
      <section class="toc-contents" aria-labelledby="toc-contents-title"><div class="toc-title" id="toc-contents-title">Contents</div><ol class="toc-list"></ol></section>
    </div><div class="toc-rail" aria-hidden="true"><span class="rail-folder" hidden></span><div class="rail-dashes"></div></div>`
    this.list = nav.querySelector('.toc-list')!
    this.files = nav.querySelector('.toc-folder .toc-files')!
    this.elsewhere = nav.querySelector('.toc-open')!
    this.folderTitle = nav.querySelector('.toc-folder .toc-title')!
    this.rail = nav.querySelector('.rail-dashes')!
    nav.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      const file = t.closest<HTMLElement>('[data-path]')
      if (file) {
        e.preventDefault()
        if (!file.classList.contains('on')) this.onOpenFile(file.dataset.path!)
        return
      }
      const a = t.closest<HTMLElement>('[data-i]')
      if (!a) return
      e.preventDefault()
      const item = this.items[Number(a.dataset.i)]
      if (item) this.onPick(item.h)
    })
  }

  private refreshVisibility() {
    this.nav.classList.toggle('few', !this.hasHeadings && !this.hasFolder && !this.hasElsewhere)
    this.nav.querySelector<HTMLElement>('.toc-contents')!.hidden = !this.hasHeadings
    this.nav.querySelector<HTMLElement>('.toc-folder')!.hidden = !this.hasFolder
    this.nav.querySelector<HTMLElement>('.rail-folder')!.hidden = !this.hasFolder
  }

  setFolder(path: string | undefined, siblings: string[] = [], open: string[] = []) {
    const openSet = new Set(open)
    this.hasFolder = !!path
    this.files.innerHTML = ''
    this.renderElsewhere(path, open)
    if (path) {
      const slash = path.lastIndexOf('/')
      const dir = path.slice(0, slash)
      const current = path.slice(slash + 1)
      this.folderTitle.replaceChildren(bdi(dir.slice(dir.lastIndexOf('/') + 1) || '/'))
      this.folderTitle.title = dir
      for (const name of siblings.length ? siblings : [current]) {
        const li = document.createElement('li')
        const a = document.createElement('a')
        a.href = '#'
        a.dataset.path = `${dir}/${name}`
        a.append(bdi(name.replace(/\.md$/i, ''))) // other extensions stay, so notes.md and notes.json differ
        a.title = name
        if (openSet.has(a.dataset.path) || name === current) {
          // A dot marks every file open in a window or tab; the current one is also bold.
          a.classList.add('open')
          a.title = `${name}: open`
          const note = document.createElement('span')
          note.className = 'sr'
          note.textContent = ', open'
          a.append(note)
        }
        if (name === current) {
          a.classList.add('on')
          a.setAttribute('aria-current', 'page')
        }
        li.append(a)
        this.files.append(li)
      }
      this.files.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
    }
    this.refreshVisibility()
  }

  /** Files open in other windows or tabs that live outside this file's folder. */
  private renderElsewhere(path: string | undefined, open: string[]) {
    const dir = path ? path.slice(0, path.lastIndexOf('/')) : null
    const others = open.filter((p) => p !== path && p.slice(0, p.lastIndexOf('/')) !== dir)
    this.elsewhere.innerHTML = ''
    for (const p of others) {
      const parts = p.split('/')
      const name = parts[parts.length - 1]
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.href = '#'
      a.dataset.path = p
      a.className = 'open'
      a.title = `${p}: open`
      a.append(bdi(name.replace(/\.md$/i, '')))
      const where = bdi(parts[parts.length - 2] ?? '/')
      where.className = 'where'
      const note = document.createElement('span')
      note.className = 'sr'
      note.textContent = ', open'
      a.append(where, note)
      li.append(a)
      this.elsewhere.append(li)
    }
    this.nav.querySelector<HTMLElement>('.toc-elsewhere')!.hidden = others.length === 0
    this.hasElsewhere = others.length > 0
  }

  set(all: Heading[], title = 'Contents') {
    this.nav.querySelector('.toc-contents .toc-title')!.textContent = title
    const headings = all.filter((h) => h.level <= 4)
    this.hasHeadings = headings.length >= 2
    this.refreshVisibility()
    const sig = headings.map((h) => `${h.level}${h.id}\u0000${h.text}`).join('\u0001')
    if (sig === this.signature) {
      this.items.forEach((it, i) => (it.h = headings[i]))
      return
    }
    this.signature = sig
    const min = Math.min(...headings.map((h) => h.level))
    this.list.innerHTML = ''
    this.rail.innerHTML = ''
    this.items = headings.map((h, i) => {
      const depth = h.level - min
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.href = `#${h.id}`
      a.dataset.i = String(i)
      a.append(bdi(h.text || 'Untitled'))
      a.title = h.text
      li.style.setProperty('--depth', String(depth))
      li.append(a)
      this.list.append(li)
      const dash = document.createElement('span')
      dash.dataset.i = String(i)
      dash.style.setProperty('--depth', String(depth))
      this.rail.append(dash)
      return { h, a, dash }
    })
    this.activeId = ''
  }

  setActive(id: string) {
    if (id === this.activeId) return
    this.activeId = id
    for (const it of this.items) {
      const on = it.h.id === id
      it.a.classList.toggle('on', on)
      it.dash.classList.toggle('on', on)
      if (on) it.a.setAttribute('aria-current', 'location')
      else it.a.removeAttribute('aria-current')
      if (on) it.a.scrollIntoView({ block: 'nearest' })
    }
  }

  get headings() {
    return this.items.map((it) => it.h)
  }
}
