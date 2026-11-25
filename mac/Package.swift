// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Leaf",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "Leaf", path: "Sources/Leaf")
    ]
)
