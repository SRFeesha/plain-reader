import { caretRect } from './editor'

// ⌘F: find in the rendered page (CSS highlights) or in the source textarea.

type HighlightRegistry = Map<string, unknown>
declare const Highlight: { new (...ranges: Range[]): unknown }

export class Finder {
  private bar: HTMLElement
  private input: HTMLInputElement
  private count: HTMLElement
  private ranges: Range[] = []
  private offsets: number[] = []
  private index = 0
  private highlights: HighlightRegistry | undefined = (CSS as unknown as { highlights?: HighlightRegistry }).highlights

  constructor(private root: () => HTMLElement, private sourceArea: () => HTMLTextAreaElement | null) {
    this.bar = document.createElement('div')
    this.bar.className = 'popover find'
    this.bar.hidden = true
    this.bar.innerHTML = `<input type="search" placeholder="Find" spellcheck="false" aria-label="Find"><span class="find-count" role="status"></span><button type="button" data-d="-1" title="Previous ⇧⌘G" aria-label="Previous match">↑</button><button type="button" data-d="1" title="Next ⌘G" aria-label="Next match">↓</button>`
    document.body.append(this.bar)
    this.input = this.bar.querySelector('input')!
    this.count = this.bar.querySelector('.find-count')!
    this.input.addEventListener('input', () => this.search())
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.step(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.close()
      }
    })
    this.bar.addEventListener('click', (e) => {
      const d = (e.target as HTMLElement).closest<HTMLElement>('[data-d]')?.dataset.d
      if (d) this.step(Number(d))
    })
  }

  get isOpen() {
    return !this.bar.hidden
  }

  open() {
    const sel = getSelection()?.toString()
    this.bar.hidden = false
    if (sel && !sel.includes('\n')) this.input.value = sel
    this.input.focus()
    this.input.select()
    this.search()
  }

  close() {
    this.bar.hidden = true
    this.clear()
  }

  refresh() {
    if (this.isOpen) this.search(false)
  }

  step(dir: number) {
    if (!this.isOpen) return this.open()
    const n = this.ranges.length || this.offsets.length
    if (!n) return
    this.index = (this.index + dir + n) % n
    this.show()
  }

  private clear() {
    this.highlights?.delete('find')
    this.highlights?.delete('find-current')
    this.ranges = []
    this.offsets = []
    this.count.textContent = ''
  }

  private search(jump = true) {
    this.clear()
    const q = this.input.value.toLowerCase()
    if (!q) return
    const ta = this.sourceArea()
    if (ta) {
      const text = ta.value.toLowerCase()
      for (let i = text.indexOf(q); i !== -1 && this.offsets.length < 2000; i = text.indexOf(q, i + q.length)) this.offsets.push(i)
    } else {
      const walker = document.createTreeWalker(this.root(), NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node && this.ranges.length < 2000; node = walker.nextNode()) {
        const text = node.textContent!.toLowerCase()
        for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + q.length)) {
          const r = new Range()
          r.setStart(node, i)
          r.setEnd(node, i + q.length)
          this.ranges.push(r)
        }
      }
      if (this.highlights && this.ranges.length) this.highlights.set('find', new Highlight(...this.ranges))
    }
    this.index = 0
    if (jump) this.show()
    else this.label()
  }

  private label() {
    const n = this.ranges.length || this.offsets.length
    this.count.textContent = n ? `${this.index + 1}/${n}` : this.input.value ? 'No matches' : ''
  }

  private show() {
    this.label()
    const ta = this.sourceArea()
    if (ta && this.offsets.length) {
      const at = this.offsets[this.index]
      const c = caretRect(ta, at)
      scrollBy({ top: c.top - innerHeight / 3 })
      ta.setSelectionRange(at, at + this.input.value.length)
      return
    }
    const r = this.ranges[this.index]
    if (!r) return
    // A match inside a folded JSON node unfolds it.
    for (let d = r.startContainer.parentElement?.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])'))
      (d as HTMLDetailsElement).open = true
    this.highlights?.set('find-current', new Highlight(r))
    const box = r.getBoundingClientRect()
    if (box.top < 60 || box.bottom > innerHeight - 60) scrollBy({ top: box.top - innerHeight / 3 })
  }
}
