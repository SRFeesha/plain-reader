#!/bin/zsh
# Builds Leaf.app. Pass --install to copy it to ~/Applications.
set -euo pipefail
MAC="${0:A:h}"
ROOT="${MAC:h}"

echo "→ web UI"
(cd "$ROOT/web" && npm run build --silent >/dev/null)

echo "→ native shell"
cd "$MAC"
swift build -c release 2>&1 | grep -v "search path" | tail -1
BIN="$(swift build -c release --show-bin-path)/Leaf"

if [[ ! -f "$MAC/AppIcon.icns" ]]; then
  echo "→ icon"
  TMP="$(mktemp -d)"
  swift "$MAC/scripts/make-icon.swift" "$TMP/icon.png"
  mkdir -p "$TMP/AppIcon.iconset"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$TMP/icon.png" --out "$TMP/AppIcon.iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$TMP/icon.png" --out "$TMP/AppIcon.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$TMP/AppIcon.iconset" -o "$MAC/AppIcon.icns"
  rm -rf "$TMP"
fi

APP="$MAC/build/Leaf.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp "$BIN" "$APP/Contents/MacOS/Leaf"
cp "$MAC/Info.plist" "$APP/Contents/Info.plist"
cp "$MAC/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cp "$ROOT/web/dist/index.html" "$APP/Contents/Resources/web/index.html"
codesign --force --sign - "$APP" 2>/dev/null
echo "✓ $APP"

if [[ "${1:-}" == "--install" ]]; then
  DEST="$HOME/Applications/Leaf.app"
  mkdir -p "$HOME/Applications"
  rm -rf "$DEST"
  cp -R "$APP" "$DEST"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST"
  echo "✓ installed to $DEST"
fi
