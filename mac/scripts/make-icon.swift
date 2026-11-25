// Draws the app icon: a warm paper tile with M↓, Markdown's own mark, set in type.
// Usage: swift scripts/make-icon.swift out.png [arrow|md]
import AppKit

let variant = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "arrow"
let size: CGFloat = 1024
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
let ctx = NSGraphicsContext.current!.cgContext

let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
let path = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: NSColor(white: 0, alpha: 0.22).cgColor)
NSColor(srgbRed: 0.98, green: 0.98, blue: 0.976, alpha: 1).setFill()
path.fill()
ctx.restoreGState()

NSGradient(colors: [
  NSColor(srgbRed: 1.0, green: 1.0, blue: 0.996, alpha: 1),
  NSColor(srgbRed: 0.937, green: 0.929, blue: 0.918, alpha: 1),
])!.draw(in: path, angle: -90)
NSColor(srgbRed: 0.84, green: 0.827, blue: 0.82, alpha: 1).setStroke()
path.lineWidth = 3
path.stroke()

let ink = NSColor(srgbRed: 0.11, green: 0.098, blue: 0.09, alpha: 1)
let soft = NSColor(srgbRed: 0.66, green: 0.635, blue: 0.62, alpha: 1)

func draw(_ parts: [(String, NSColor)], weight: NSFont.Weight, size pt: CGFloat, y: CGFloat) {
  let font = NSFont.monospacedSystemFont(ofSize: pt, weight: weight)
  let s = NSMutableAttributedString()
  for (text, color) in parts {
    s.append(NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color, .kern: -pt * 0.04]))
  }
  let b = s.size()
  s.draw(at: NSPoint(x: (size - b.width) / 2, y: y))
}

if variant == "arrow" {
  // M and a down arrow: Markdown's own mark, set in type.
  draw([("M", ink), ("↓", soft)], weight: .semibold, size: 330, y: 300)
} else {
  // The extension itself, the dot quieter than the letters.
  draw([(".", soft), ("md", ink)], weight: .semibold, size: 300, y: 330)
  // Three short lines of text below, so it still reads as a page.
  for (i, w) in [CGFloat(300), 240].enumerated() {
    soft.withAlphaComponent(0.55).setFill()
    NSBezierPath(roundedRect: NSRect(x: (size - w) / 2, y: 270 - CGFloat(i) * 52, width: w, height: 22), xRadius: 11, yRadius: 11).fill()
  }
}

image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
