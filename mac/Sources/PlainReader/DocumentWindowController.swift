import AppKit
import WebKit

enum Theme {
    /// Parses the "rgb(r, g, b)" that getComputedStyle returns.
    static func color(css: String) -> NSColor? {
        let n = css.split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
        guard n.count >= 3 else { return nil }
        return NSColor(srgbRed: n[0] / 255, green: n[1] / 255, blue: n[2] / 255, alpha: 1)
    }

    /// Matches --bg in the web UI so the title bar and page read as one surface.
    static let background = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0x1C / 255, green: 0x19 / 255, blue: 0x17 / 255, alpha: 1)
            : NSColor(srgbRed: 0xFA / 255, green: 0xFA / 255, blue: 0xF9 / 255, alpha: 1)
    }
}

/// Avoids the retain cycle between WKUserContentController and its handler.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(c, didReceive: message)
    }
}

final class DocumentWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    let webView: WKWebView
    private let assets = AssetSchemeHandler()
    private var pageReady = false

    var markdownDocument: MarkdownDocument? { document as? MarkdownDocument }

    init(document: MarkdownDocument) {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(assets, forURLScheme: "plain-app")
        config.setURLSchemeHandler(assets, forURLScheme: "plain-doc")
        config.userContentController = WKUserContentController()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1040, height: 780), configuration: config)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1040, height: 780),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.backgroundColor = Theme.background
        window.minSize = NSSize(width: 420, height: 320)
        window.tabbingMode = .preferred // linked notes open as tabs, not stacked windows
        window.contentView = webView
        window.center()

        super.init(window: window)
        shouldCascadeWindows = true
        window.delegate = self

        assets.documentURL = { [weak document] in document?.fileURL }
        config.userContentController.add(WeakMessageHandler(self), name: "plain")
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        webView.load(URLRequest(url: URL(string: "plain-app://app/index.html")!))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    // MARK: Web → native

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            pageReady = true
            sendDocument(reload: false)
        case "change":
            if let text = body["text"] as? String { markdownDocument?.textDidChange(text) }
        case "openExternal":
            if let s = body["url"] as? String, let url = URL(string: s) { NSWorkspace.shared.open(url) }
        case "openLink":
            if let href = body["href"] as? String { openLink(href) }
        case "reveal":
            if let path = body["path"] as? String {
                var isDir: ObjCBool = false
                let url = URL(fileURLWithPath: path)
                if FileManager.default.fileExists(atPath: path, isDirectory: &isDir), isDir.boolValue {
                    NSWorkspace.shared.open(url)
                } else {
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                }
            }
        case "theme":
            applyTheme(body)
        case "copy":
            if let text = body["text"] as? String {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            }
        default:
            break
        }
    }

    // MARK: Native → web

    func sendDocument(reload: Bool) {
        guard pageReady, let doc = markdownDocument else { return }
        let payload: [String: Any] = [
            "text": doc.text, "name": doc.displayName ?? "Untitled", "reload": reload,
            "kind": Resolver.kind(of: doc.fileURL),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.plain && window.plain.open(\(json))")
        DocumentWindowController.broadcastLocation()
    }

    /// Where the file lives, how it reads, and which readable files sit next to it.
    /// Every window refreshes its sidebar, so each one marks the files open in any window or tab.
    static func broadcastLocation() {
        for case let doc as MarkdownDocument in NSDocumentController.shared.documents {
            doc.plainWindow?.sendLocation()
        }
    }

    func sendLocation() {
        guard pageReady else { return }
        var payload: [String: Any] = ["home": NSHomeDirectory(), "kind": Resolver.kind(of: markdownDocument?.fileURL)]
        if let url = markdownDocument?.fileURL {
            let dir = url.deletingLastPathComponent()
            let siblings = ((try? FileManager.default.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]
            )) ?? [])
                .filter(Resolver.isMarkdown)
                .map(\.lastPathComponent)
                .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
                .prefix(500)
            payload["path"] = url.path
            payload["siblings"] = Array(siblings)
            payload["open"] = NSDocumentController.shared.documents.compactMap { $0.fileURL?.path }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.plain && window.plain.location(\(json))")
    }

    func windowDidBecomeKey(_ notification: Notification) {
        sendLocation() // pick up files added or renamed while away
        updateTitlebar()
    }

    /// One window: the title bar melts into the page. Several tabs: it goes back to the
    /// system's own material, so the selected tab stands out from the others.
    private func updateTitlebar() {
        guard let window else { return }
        let tabbed = (window.tabbedWindows?.count ?? 0) > 1
        for w in window.tabbedWindows ?? [window] where w.titlebarAppearsTransparent == tabbed {
            w.titlebarAppearsTransparent = !tabbed
        }
    }

    private func run(_ command: String) {
        webView.evaluateJavaScript("window.plain && window.plain.command('\(command)')")
    }

    /// Menu items carry the web command name as their representedObject.
    @objc func plainCommand(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        run(name)
    }

    @objc func showInFinder(_ sender: Any?) {
        guard let url = markdownDocument?.fileURL else { return NSSound.beep() }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    private func openLink(_ href: String) {
        if let url = URL(string: href), let scheme = url.scheme, !scheme.isEmpty {
            NSWorkspace.shared.open(url)
            return
        }
        let raw = href.components(separatedBy: "#").first ?? href
        let path = raw.removingPercentEncoding ?? raw
        guard !path.isEmpty,
              let target = Resolver.resolve(path, relativeTo: markdownDocument?.fileURL, preferMarkdown: true)
        else {
            let name = (path as NSString).lastPathComponent
            return notice("Couldn’t find “\(name)” next to this file or in its folder tree. Check the link, or create the file.")
        }
        if Resolver.isMarkdown(target) {
            NSDocumentController.shared.openDocument(withContentsOf: target, display: true) { _, _, _ in }
        } else {
            NSWorkspace.shared.open(target)
        }
    }

    private func notice(_ text: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [text]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.plain && window.plain.notice(\(json)[0])")
    }

    /// Matches the title bar to the page, and its appearance to light or dark themes.
    private func applyTheme(_ body: [String: Any]) {
        guard let window else { return }
        let follows = body["followsSystem"] as? Bool ?? true
        let dark = body["dark"] as? Bool ?? false
        window.appearance = follows ? nil : NSAppearance(named: dark ? .darkAqua : .aqua)
        if follows {
            window.backgroundColor = Theme.background
        } else if let css = body["bg"] as? String, let color = Theme.color(css: css) {
            window.backgroundColor = color
        }
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == "plain-app" || url.scheme == "plain-doc" || url.absoluteString == "about:blank" {
            return decisionHandler(.allow)
        }
        decisionHandler(.cancel)
        if url.isFileURL {
            // A file dropped on the window opens as its own document.
            NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
        } else if ["http", "https", "mailto"].contains(url.scheme ?? "") {
            NSWorkspace.shared.open(url)
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageReady = false
        webView.reload()
    }
}
