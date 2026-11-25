// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PlainReader",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "PlainReader", path: "Sources/PlainReader")
    ]
)
