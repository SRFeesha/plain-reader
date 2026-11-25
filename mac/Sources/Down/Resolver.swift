import Foundation
import UniformTypeIdentifiers

/// Finds files a document points to: relative paths first, then by name
/// anywhere in its vault (the nearest folder with .obsidian or .git).
enum Resolver {
    static let markdownExtensions: Set<String> = ["md", "markdown", "mdown", "mkd", "mdx", "txt"]

    static func isMarkdown(_ url: URL) -> Bool {
        markdownExtensions.contains(url.pathExtension.lowercased())
    }

    private static var cache: [String: URL] = [:]
    private static let lock = NSLock()

    static func resolve(_ path: String, relativeTo document: URL?, preferMarkdown: Bool) -> URL? {
        let fm = FileManager.default
        var candidates: [URL] = []
        if path.hasPrefix("/") {
            candidates.append(URL(fileURLWithPath: path))
        } else if path.hasPrefix("~") {
            candidates.append(URL(fileURLWithPath: (path as NSString).expandingTildeInPath))
        } else if let dir = document?.deletingLastPathComponent() {
            candidates.append(dir.appendingPathComponent(path).standardizedFileURL)
        }
        if preferMarkdown {
            candidates += candidates.filter { !isMarkdown($0) }.map { $0.appendingPathExtension("md") }
        }
        if let hit = candidates.first(where: { fm.fileExists(atPath: $0.path) }) { return hit }

        guard let document else { return nil }
        let name = (path as NSString).lastPathComponent
        let names = preferMarkdown && !isMarkdown(URL(fileURLWithPath: name)) ? [name + ".md", name] : [name]
        return search(names: names, from: document)
    }

    static func vaultRoot(for document: URL) -> URL {
        let fm = FileManager.default
        let start = document.deletingLastPathComponent()
        var dir = start
        for _ in 0..<6 {
            if fm.fileExists(atPath: dir.appendingPathComponent(".obsidian").path)
                || fm.fileExists(atPath: dir.appendingPathComponent(".git").path) {
                return dir
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        return start
    }

    private static func search(names: [String], from document: URL) -> URL? {
        let root = vaultRoot(for: document)
        let wanted = Set(names.map { $0.lowercased() })
        let key = root.path + "|" + names.joined(separator: "|")
        lock.lock()
        if let hit = cache[key], FileManager.default.fileExists(atPath: hit.path) { lock.unlock(); return hit }
        lock.unlock()

        guard let walker = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else { return nil }
        var seen = 0
        for case let url as URL in walker {
            seen += 1
            if seen > 60_000 { break }
            if url.lastPathComponent == "node_modules" { walker.skipDescendants(); continue }
            if wanted.contains(url.lastPathComponent.lowercased()) {
                lock.lock(); cache[key] = url; lock.unlock()
                return url
            }
        }
        return nil
    }

    static func mimeType(for url: URL) -> String {
        if url.pathExtension.lowercased() == "html" { return "text/html; charset=utf-8" }
        return UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }
}
