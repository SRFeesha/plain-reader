// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Down",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "Down", path: "Sources/Down")
    ]
)
