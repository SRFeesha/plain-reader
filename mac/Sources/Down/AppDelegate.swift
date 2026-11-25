import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let recentMenu = NSMenu(title: "Open Recent")
    private var openedFiles = false

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = buildMenu()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            if !self.openedFiles && NSDocumentController.shared.documents.isEmpty {
                NSDocumentController.shared.openDocument(nil)
            }
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        openedFiles = true
        for url in urls {
            NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, error in
                if let error { NSLog("Down: could not open %@: %@", url.path, error.localizedDescription) }
            }
        }
    }

    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { NSDocumentController.shared.openDocument(nil) }
        return false
    }

    // MARK: Open Recent

    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu === recentMenu else { return }
        menu.removeAllItems()
        for url in NSDocumentController.shared.recentDocumentURLs {
            let item = NSMenuItem(title: url.lastPathComponent, action: #selector(openRecent(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = url
            item.image = NSWorkspace.shared.icon(forFile: url.path)
            item.image?.size = NSSize(width: 16, height: 16)
            item.toolTip = url.path
            menu.addItem(item)
        }
        if !menu.items.isEmpty { menu.addItem(.separator()) }
        menu.addItem(NSMenuItem(title: "Clear Menu", action: #selector(NSDocumentController.clearRecentDocuments(_:)), keyEquivalent: ""))
    }

    @objc private func openRecent(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
    }

    /// Sends a web command to the front document window, even when no window is key.
    @objc func downCommand(_ sender: NSMenuItem) {
        let windows = [NSApp.keyWindow, NSApp.mainWindow].compactMap { $0 } + NSApp.orderedWindows
        let controller = windows.lazy.compactMap { $0.windowController as? DocumentWindowController }.first
        controller?.downCommand(sender)
    }

    // MARK: Menu

    private func buildMenu() -> NSMenu {
        let main = NSMenu()

        func menu(_ title: String, _ build: (NSMenu) -> Void) -> NSMenu {
            let item = NSMenuItem()
            let m = NSMenu(title: title)
            build(m)
            item.submenu = m
            main.addItem(item)
            return m
        }
        @discardableResult
        func item(_ m: NSMenu, _ title: String, _ action: String?, _ key: String = "",
                  _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action.map(NSSelectorFromString), keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            m.addItem(i)
            return i
        }
        // Commands handled by the web UI.
        func web(_ m: NSMenu, _ title: String, _ command: String, _ key: String = "",
                 _ mods: NSEvent.ModifierFlags = .command) {
            let i = item(m, title, "downCommand:", key, mods)
            i.representedObject = command
            i.target = self
        }

        _ = menu("Down") { m in
            item(m, "About Down", "orderFrontStandardAboutPanel:")
            m.addItem(.separator())
            let services = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
            services.submenu = NSMenu(title: "Services")
            NSApp.servicesMenu = services.submenu
            m.addItem(services)
            m.addItem(.separator())
            item(m, "Hide Down", "hide:", "h")
            item(m, "Hide Others", "hideOtherApplications:", "h", [.command, .option])
            item(m, "Show All", "unhideAllApplications:")
            m.addItem(.separator())
            item(m, "Quit Down", "terminate:", "q")
        }

        _ = menu("File") { m in
            item(m, "New", "newDocument:", "n")
            item(m, "Open…", "openDocument:", "o")
            let recent = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
            recentMenu.delegate = self
            recent.submenu = recentMenu
            m.addItem(recent)
            m.addItem(.separator())
            item(m, "Close", "performClose:", "w")
            item(m, "Save", "saveDocument:", "s")
            item(m, "Duplicate", "duplicateDocument:", "s", [.command, .shift])
            item(m, "Rename…", "renameDocument:")
            item(m, "Move To…", "moveDocument:")
            item(m, "Revert To Saved", "revertDocumentToSaved:")
            m.addItem(.separator())
            item(m, "Show in Finder", "showInFinder:", "r", [.command, .option])
        }

        _ = menu("Edit") { m in
            item(m, "Undo", "undo:", "z")
            item(m, "Redo", "redo:", "z", [.command, .shift])
            m.addItem(.separator())
            item(m, "Cut", "cut:", "x")
            item(m, "Copy", "copy:", "c")
            item(m, "Paste", "paste:", "v")
            item(m, "Paste and Match Style", "pasteAsPlainText:", "v", [.command, .option, .shift])
            item(m, "Select All", "selectAll:", "a")
            m.addItem(.separator())
            web(m, "Find…", "find", "f")
            web(m, "Find Next", "findNext", "g")
            web(m, "Find Previous", "findPrevious", "g", [.command, .shift])
        }

        _ = menu("Format") { m in
            web(m, "Bold", "bold", "b")
            web(m, "Italic", "italic", "i")
            web(m, "Strikethrough", "strike", "x", [.command, .shift])
            web(m, "Inline Code", "code", "c", [.command, .shift])
            web(m, "Highlight", "highlight", "h", [.command, .shift])
            web(m, "Link", "link", "k")
            m.addItem(.separator())
            web(m, "Toggle To-do", "task", "\r")
        }

        _ = menu("View") { m in
            web(m, "Reading / Editing", "toggleEdit", "e")
            web(m, "Source", "toggleSource", "e", [.command, .shift])
            web(m, "Contents", "toggleToc", "\\")
            let themes = NSMenuItem(title: "Theme", action: nil, keyEquivalent: "")
            themes.submenu = NSMenu(title: "Theme")
            for (title, id) in [("Stone", "stone"), ("Olive", "olive"), ("Olive Night", "olive-night"),
                                ("Terracotta", "terracotta"), ("Graphite", "graphite")] {
                web(themes.submenu!, title, "theme:\(id)")
            }
            m.addItem(themes)
            m.addItem(.separator())
            web(m, "Bigger", "zoomIn", "+")
            web(m, "Smaller", "zoomOut", "-")
            web(m, "Actual Size", "zoomReset", "0")
            m.addItem(.separator())
            item(m, "Enter Full Screen", "toggleFullScreen:", "f", [.command, .control])
        }

        let window = menu("Window") { m in
            item(m, "Minimize", "performMiniaturize:", "m")
            item(m, "Zoom", "performZoom:")
            m.addItem(.separator())
            item(m, "Bring All to Front", "arrangeInFront:")
        }
        NSApp.windowsMenu = window

        let help = menu("Help") { m in
            web(m, "Keyboard Shortcuts", "shortcuts", "/")
        }
        NSApp.helpMenu = help

        return main
    }
}
