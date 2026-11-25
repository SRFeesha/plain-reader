import AppKit

/// One Markdown file. NSDocument gives us open, save, autosave, versions,
/// Open Recent, tabs and the "Edited" title for free.
@objc(MarkdownDocument)
final class MarkdownDocument: NSDocument {
    private(set) var text = ""

    // Saving an untitled file, Rename and Move To all change the location.
    override var fileURL: URL? {
        didSet { DispatchQueue.main.async { [weak self] in self?.plainWindow?.sendLocation() } }
    }

    override init() {
        super.init()
        hasUndoManager = false // undo lives in the web view
    }

    override class var autosavesInPlace: Bool { true }

    override func makeWindowControllers() {
        addWindowController(DocumentWindowController(document: self))
    }

    var plainWindow: DocumentWindowController? { windowControllers.first as? DocumentWindowController }

    override func read(from data: Data, ofType typeName: String) throws {
        guard let string = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .macOSRoman) else {
            throw CocoaError(.fileReadInapplicableStringEncoding)
        }
        text = string
        plainWindow?.sendDocument(reload: true)
    }

    override func data(ofType typeName: String) throws -> Data {
        Data(text.utf8)
    }

    func textDidChange(_ newText: String) {
        guard newText != text else { return }
        text = newText
        updateChangeCount(.changeDone)
    }

    // Reload when another app (an editor, git, an agent) changes the file,
    // as long as there is nothing unsaved here.
    override func presentedItemDidChange() {
        super.presentedItemDidChange()
        DispatchQueue.main.async { [weak self] in self?.reloadIfChangedOnDisk() }
    }

    private func reloadIfChangedOnDisk() {
        guard let url = fileURL, !isDocumentEdited,
              let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate,
              let known = fileModificationDate, modified > known
        else { return }
        try? revert(toContentsOf: url, ofType: fileType ?? "net.daringfireball.markdown")
    }
}
