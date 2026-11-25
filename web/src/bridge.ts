// Talks to the native Mac shell when there is one. In a plain browser every
// call falls back to something sensible, so the UI can be built with Vite.

type Handler = { postMessage(message: unknown): void }

declare global {
  interface Window {
    webkit?: { messageHandlers?: { down?: Handler } }
  }
}

const handler = window.webkit?.messageHandlers?.down

const hasScheme = (s: string) => /^[a-z][a-z0-9+.-]*:/i.test(s)

function safeDecode(s: string) {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

export const bridge = {
  native: !!handler,

  post(message: Record<string, unknown>) {
    handler?.postMessage(message)
  },

  /** Rewrites a relative image path so the native shell can serve it from next to the file. */
  assetURL(src: string, search = false): string {
    if (!handler || !src || hasScheme(src) || src.startsWith('#') || src.startsWith('//')) return src
    const clean = encodeURI(safeDecode(src))
    if (search) return 'down-doc://local/' + clean
    if (src.startsWith('/')) return 'down-doc://abs' + clean
    return 'down-doc://local/' + clean.replace(/^\.\//, '')
  },

  copy(text: string) {
    if (handler) handler.postMessage({ type: 'copy', text })
    else void navigator.clipboard?.writeText(text)
  },
}
