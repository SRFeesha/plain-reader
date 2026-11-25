import Foundation
import WebKit

/// Serves the bundled UI (leaf-app://app/index.html) and files next to the
/// open document (leaf-doc://local/images/a.png, leaf-doc://abs/Users/...).
final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    var documentURL: () -> URL? = { nil }
    private var stopped = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let document = documentURL()
        let id = ObjectIdentifier(task as AnyObject)
        DispatchQueue.global(qos: .userInitiated).async {
            let file = Self.file(for: url, document: document)
            let data = file.flatMap { try? Data(contentsOf: $0) }
            DispatchQueue.main.async {
                if self.stopped.remove(id) != nil { return }
                guard let file, let data else {
                    task.didFailWithError(URLError(.fileDoesNotExist))
                    return
                }
                let response = HTTPURLResponse(
                    url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                    headerFields: [
                        "Content-Type": Resolver.mimeType(for: file),
                        "Content-Length": String(data.count),
                        "Cache-Control": "no-cache",
                    ]
                )!
                task.didReceive(response)
                task.didReceive(data)
                task.didFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task as AnyObject))
    }

    private static func file(for url: URL, document: URL?) -> URL? {
        switch url.scheme {
        case "leaf-app":
            guard let resources = Bundle.main.resourceURL?.appendingPathComponent("web") else { return nil }
            let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
            let file = resources.appendingPathComponent(path).standardizedFileURL
            return file.path.hasPrefix(resources.path) ? file : nil
        case "leaf-doc":
            if url.host == "abs" { return URL(fileURLWithPath: url.path) }
            return Resolver.resolve(String(url.path.dropFirst()), relativeTo: document, preferMarkdown: false)
        default:
            return nil
        }
    }
}
