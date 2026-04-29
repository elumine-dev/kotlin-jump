// scripts/demo/event-capture/event-tap.swift
//
// Standalone Swift CLI that taps the macOS event stream (mouse-down, key-down)
// and emits one JSON line per event on stdout. Used by kjdemo manual-record
// to collect timing hints for overlay annotations.
//
// Build: see ./build.sh   (swiftc -O -o ../../../dist/demo/bin/event-tap event-tap.swift)
// Run:   ./event-tap   then click + type. SIGINT to stop.
//
// Output (NDJSON, one object per line):
//   {"type":"ready","wall_ms":1714312345678}
//   {"type":"click","button":"left","x":640,"y":360,"wall_ms":1714312346123}
//   {"type":"keystroke","key":"Cmd+Shift+P","wall_ms":1714312347456}
//
// Errors go to stderr. Exit code 2 = accessibility denied.

import Foundation
import Cocoa
import CoreGraphics
import ApplicationServices

// ---------------------------------------------------------------- output

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

func wallMs() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
}

// ---------------------------------------------------------------- AX element

func axString(_ el: AXUIElement, _ attr: CFString) -> String? {
    var v: AnyObject?
    guard AXUIElementCopyAttributeValue(el, attr, &v) == .success else { return nil }
    guard let s = v as? String, !s.isEmpty else { return nil }
    return s
}

func axParent(_ el: AXUIElement) -> AXUIElement? {
    var v: AnyObject?
    guard AXUIElementCopyAttributeValue(el, kAXParentAttribute as CFString, &v) == .success else { return nil }
    guard CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
    return (v as! AXUIElement)
}

func axElementArray(_ el: AXUIElement, _ attr: CFString) -> [AXUIElement] {
    var v: AnyObject?
    guard AXUIElementCopyAttributeValue(el, attr, &v) == .success,
          let array = v as? NSArray
    else { return [] }
    var out: [AXUIElement] = []
    for item in array {
        let cf = item as CFTypeRef
        if CFGetTypeID(cf) == AXUIElementGetTypeID() {
            out.append(cf as! AXUIElement)
        }
    }
    return out
}

// Try several attributes for the children of a node — Chromium's AX bridge
// occasionally exposes content via VisibleChildren or Contents instead of
// the standard Children attribute.
func axChildren(_ el: AXUIElement) -> [AXUIElement] {
    let kids = axElementArray(el, kAXChildrenAttribute as CFString)
    if !kids.isEmpty { return kids }
    let visible = axElementArray(el, kAXVisibleChildrenAttribute as CFString)
    if !visible.isEmpty { return visible }
    return axElementArray(el, "AXContents" as CFString)
}

func axFrame(_ el: AXUIElement) -> CGRect? {
    var posV: AnyObject?
    var szV: AnyObject?
    guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &posV) == .success,
          AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &szV) == .success
    else { return nil }
    guard let pv = posV, CFGetTypeID(pv) == AXValueGetTypeID(),
          let sv = szV,  CFGetTypeID(sv) == AXValueGetTypeID()
    else { return nil }
    var p = CGPoint.zero
    var s = CGSize.zero
    AXValueGetValue(pv as! AXValue, .cgPoint, &p)
    AXValueGetValue(sv as! AXValue, .cgSize,  &s)
    return CGRect(origin: p, size: s)
}

// Recursive descent picking the smallest in-frame descendant. Bounded by
// depth and a wall-clock deadline. Returns the deepest valid container
// (or `root` if no child has a frame containing the point).
func recursiveSmallestUnder(root: AXUIElement, point: CGPoint, deadline: Date) -> AXUIElement {
    var current = root
    var depth = 0
    while depth < 24 && Date() < deadline {
        var bestChild: AXUIElement?
        var bestArea = CGFloat.infinity
        for child in axChildren(current) {
            if Date() >= deadline { break }
            guard let f = axFrame(child) else { continue }
            if f.contains(point) {
                let area = f.width * f.height
                if area < bestArea { bestArea = area; bestChild = child }
            }
        }
        guard let next = bestChild else { break }
        current = next
        depth  += 1
    }
    return current
}

// Read role/subrole/id/role_desc from the leaf, then walk up to 8 ancestors
// looking for a usable label (title / description / value). VS Code uses
// `description` rather than `title` on its toolbar buttons, so the fallback
// is necessary.
func summariseLeaf(_ el: AXUIElement) -> [String: Any] {
    var out: [String: Any] = [:]
    if let s = axString(el, kAXRoleAttribute            as CFString) { out["role"]      = s }
    if let s = axString(el, kAXSubroleAttribute         as CFString) { out["subrole"]   = s }
    if let s = axString(el, kAXIdentifierAttribute      as CFString) { out["id"]        = s }
    if let s = axString(el, kAXRoleDescriptionAttribute as CFString) { out["role_desc"] = s }

    var current: AXUIElement? = el
    var walkDepth = 0
    while let e = current, walkDepth < 8 {
        if let s = axString(e, kAXTitleAttribute       as CFString) { out["title"] = s; break }
        if let s = axString(e, kAXDescriptionAttribute as CFString) { out["title"] = s; break }
        if let s = axString(e, kAXValueAttribute       as CFString) { out["value"] = s; break }
        current = axParent(e)
        walkDepth += 1
    }
    out["walk_depth"] = walkDepth
    return out
}

// A label is "useful" if it's a non-empty title/value AND not the VS Code
// window-title pattern (`<file> — <workspace> — Code`) bubbling up from a
// generic container role. The pattern check rejects results where the
// leaf has no real label and the walk-up reached the window title.
func hasUsefulLabel(_ d: [String: Any]) -> Bool {
    let title = d["title"] as? String ?? ""
    let value = d["value"] as? String ?? ""
    let label = !title.isEmpty ? title : value
    if label.isEmpty { return false }

    let role = d["role"] as? String ?? ""
    let isGenericContainer = (role == "AXScrollArea" || role == "AXGroup"
                          || role == "AXWindow"     || role == "AXWebArea")
    if isGenericContainer && label.contains(" — ") { return false }
    return true
}

// =================================================================== strategies

// Strategy 1 (primary for Chromium/Electron): start from the focused
// application's focused window, descend the AX tree picking the smallest
// in-frame child at each level. Empirically reaches AXButton-with-description
// for VS Code toolbar / status bar at depth ~17.
// Get the frontmost application's AXUIElement via NSWorkspace (which works
// without AX permission and is reliable on background queues, unlike
// kAXFocusedApplicationAttribute on the system-wide element which returns
// kAXErrorCannotComplete intermittently from non-main threads).
func frontmostAppAXElement() -> AXUIElement? {
    guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
    let pid = app.processIdentifier
    let el  = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(el, 0.5)
    return el
}

func strategy_descentFromWindow(at p: CGPoint, deadline: Date) -> [String: Any]? {
    guard let app = frontmostAppAXElement() else {
        FileHandle.standardError.write("descent_window: no frontmost app\n".data(using: .utf8)!)
        return nil
    }

    var winV: AnyObject?
    let winRes = AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &winV)
    guard winRes == .success, let w = winV, CFGetTypeID(w) == AXUIElementGetTypeID() else {
        // Fall back to the app's first window if focused-window isn't set.
        var winsV: AnyObject?
        if AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &winsV) == .success,
           let arr = winsV as? NSArray, arr.count > 0,
           let first = arr[0] as CFTypeRef?, CFGetTypeID(first) == AXUIElementGetTypeID() {
            let leaf = recursiveSmallestUnder(root: first as! AXUIElement, point: p, deadline: deadline)
            return summariseLeaf(leaf)
        }
        FileHandle.standardError.write("descent_window: focused-window err=\(winRes.rawValue), no fallback\n".data(using: .utf8)!)
        return nil
    }
    let win = w as! AXUIElement

    let leaf = recursiveSmallestUnder(root: win, point: p, deadline: deadline)
    return summariseLeaf(leaf)
}

// Strategy 2: focused element after click (two-step app→focused). Useful
// when focus moves to the clicked widget but it's not at the bottom of
// the visible AX hierarchy.
func strategy_focusedAfterClick() -> [String: Any]? {
    guard let app = frontmostAppAXElement() else { return nil }
    var fEl: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &fEl) == .success,
          let f = fEl, CFGetTypeID(f) == AXUIElementGetTypeID()
    else { return nil }
    return summariseLeaf(f as! AXUIElement)
}

// Strategy 3 (last resort): direct hit-test. Works for native apps where
// AXUIElementCopyElementAtPosition properly returns the leaf. Useless for
// Chromium where it returns a phantom container.
func strategy_hitTest(at p: CGPoint, deadline: Date) -> [String: Any]? {
    let sw = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(sw, 0.5)
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(sw, Float(p.x), Float(p.y), &hit) == .success,
          let h = hit
    else { return nil }
    return summariseLeaf(h)
}

// Orchestrator: try strategies in order, pick the first with a useful
// label. Always emits an `attempts` array describing what each strategy
// returned (role + label + had_label) so the JSON sidecar reveals why we
// fell back to coords if all strategies failed.
func bestEffortElement(at p: CGPoint, deadline: Date) -> [String: Any] {
    var attempts: [[String: Any]] = []
    var winner: [String: Any]?
    var winnerStrategy = "none"

    func tryStrategy(_ name: String, _ fn: () -> [String: Any]?) {
        guard Date() < deadline else {
            attempts.append(["name": name, "had_label": false, "skipped": "deadline"])
            return
        }
        guard let r = fn() else {
            attempts.append(["name": name, "had_label": false, "skipped": "no_result"])
            return
        }
        let useful = hasUsefulLabel(r)
        attempts.append([
            "name":      name,
            "had_label": useful,
            "role":      r["role"]  as? String ?? "",
            "label":     (r["title"] as? String) ?? (r["value"] as? String) ?? "",
        ])
        if winner == nil && useful {
            winner = r
            winnerStrategy = name
        }
    }

    // Order is empirically derived (see media/ax-debug-harvest/summary.md):
    //   1. hit_test wins for VS Code title bar / status bar (it returns the
    //      actual AXButton with description). It also works for native apps.
    //   2. descent_window wins for Chromium content where hit_test returns
    //      a phantom AXScrollArea (rejected by hasUsefulLabel because the
    //      walk-up only finds the window title).
    //   3. focused is a last-resort safety net.
    tryStrategy("hit_test")       { strategy_hitTest(at: p, deadline: deadline) }
    tryStrategy("descent_window") { strategy_descentFromWindow(at: p, deadline: deadline) }
    tryStrategy("focused")        { strategy_focusedAfterClick() }

    var out: [String: Any] = winner ?? [:]
    out["winner_strategy"] = winnerStrategy
    out["attempts"]        = attempts
    return out
}

// ---------------------------------------------------------------- text-at-cursor

// Background queue for AX text queries that must wait ~80ms post-click
// for VS Code to update its selection/cursor state. Running on the tap
// callback thread would queue subsequent events behind that wait.
let textQueryQueue = DispatchQueue(label: "kj.event-tap.text", qos: .userInitiated)

let clickIdLock = NSLock()
var nextClickId: Int64 = 0
func mintClickId() -> Int64 {
    clickIdLock.lock()
    defer { clickIdLock.unlock() }
    nextClickId += 1
    return nextClickId
}

func extractWord(from text: String, atIndex idx: Int) -> String? {
    let chars = Array(text)
    guard !chars.isEmpty, idx >= 0 else { return nil }
    let probe = min(idx, chars.count - 1)

    func isIdent(_ c: Character) -> Bool {
        return c.isLetter || c.isNumber || c == "_" || c == "$"
    }

    // If the cursor is on whitespace, peek one char left (common case: cursor
    // ends just after the word that was clicked).
    var anchor = probe
    if !isIdent(chars[anchor]) {
        if anchor > 0 && isIdent(chars[anchor - 1]) { anchor -= 1 }
        else { return nil }
    }

    var start = anchor
    while start > 0 && isIdent(chars[start - 1]) { start -= 1 }
    var end = anchor + 1
    while end < chars.count && isIdent(chars[end]) { end += 1 }

    let word = String(chars[start..<end])
    return word.isEmpty ? nil : word
}

func wordAtCursor(_ el: AXUIElement) -> String? {
    var rangeV: AnyObject?
    guard AXUIElementCopyAttributeValue(el, kAXSelectedTextRangeAttribute as CFString, &rangeV) == .success,
          let rv = rangeV, CFGetTypeID(rv) == AXValueGetTypeID()
    else { return nil }
    var range = CFRange(location: 0, length: 0)
    AXValueGetValue(rv as! AXValue, .cfRange, &range)

    // Read a window of text centred on the cursor position.
    let WINDOW = 80
    let half   = WINDOW / 2
    let start  = max(0, range.location - half)
    var qr     = CFRange(location: start, length: WINDOW)
    guard let qrValue = AXValueCreate(.cfRange, &qr) else { return nil }

    var textV: CFTypeRef?
    let r = AXUIElementCopyParameterizedAttributeValue(
        el,
        kAXStringForRangeParameterizedAttribute as CFString,
        qrValue,
        &textV
    )
    guard r == .success, let t = textV as? String, !t.isEmpty else { return nil }

    let cursorInWindow = range.location - start
    return extractWord(from: t, atIndex: cursorInWindow)
}

func queryTextAtCursor() -> [String: Any]? {
    // Use NSWorkspace path (same reasoning as in strategy_descentFromWindow).
    guard let app = frontmostAppAXElement() else { return nil }
    var fEl: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &fEl) == .success,
          let f = fEl, CFGetTypeID(f) == AXUIElementGetTypeID()
    else { return nil }
    let element = f as! AXUIElement

    var out: [String: Any] = [:]
    if let sel = axString(element, kAXSelectedTextAttribute as CFString) {
        out["selected"] = sel
    }
    if let word = wordAtCursor(element) {
        out["word"] = word
    }
    return out.isEmpty ? nil : out
}

// Combined background work for a click. Runs the multi-strategy
// orchestrator (`bestEffortElement`) for the UI element + the text-at-cursor
// query (independent — works on focused AXTextArea regardless of which
// strategy identified the clicked element). Both go on a single click_meta
// line so the Node side has one merge per click.
func emitClickMeta(id: Int64, x: Int, y: Int) {
    var meta: [String: Any] = ["type":"click_meta","click_id":id]
    // Wait for the click to be delivered and focus/selection to update.
    // 200ms is a sweet spot for Chromium — shorter and the focused app query
    // races with click delivery; longer and rapid clicks queue up.
    Thread.sleep(forTimeInterval: 0.2)

    let deadline = Date(timeIntervalSinceNow: 2.0)
    let elem = bestEffortElement(at: CGPoint(x: x, y: y), deadline: deadline)
    if !elem.isEmpty { meta["element"] = elem }
    if let text = queryTextAtCursor() { meta["text"] = text }
    emit(meta)
}

// ---------------------------------------------------------------- key decoding

// Build a human-readable label like "Cmd+Shift+P" from a CGEvent key-down.
func describeKeyDown(_ cgEvent: CGEvent) -> String {
    var parts: [String] = []
    let flags = cgEvent.flags

    if flags.contains(.maskCommand)   { parts.append("Cmd")    }
    if flags.contains(.maskAlternate) { parts.append("Option") }
    if flags.contains(.maskControl)   { parts.append("Ctrl")   }
    if flags.contains(.maskShift)     { parts.append("Shift")  }

    let keyCode = cgEvent.getIntegerValueField(.keyboardEventKeycode)

    let specialKey: String? = {
        switch keyCode {
        case 36:  return "Return"
        case 48:  return "Tab"
        case 49:  return "Space"
        case 51:  return "Backspace"
        case 53:  return "Esc"
        case 76:  return "Enter"
        case 117: return "Delete"
        case 115: return "Home"
        case 119: return "End"
        case 116: return "PageUp"
        case 121: return "PageDown"
        case 123: return "Left"
        case 124: return "Right"
        case 125: return "Down"
        case 126: return "Up"
        case 122: return "F1"
        case 120: return "F2"
        case 99:  return "F3"
        case 118: return "F4"
        case 96:  return "F5"
        case 97:  return "F6"
        case 98:  return "F7"
        case 100: return "F8"
        case 101: return "F9"
        case 109: return "F10"
        case 103: return "F11"
        case 111: return "F12"
        default:  return nil
        }
    }()

    if let s = specialKey {
        parts.append(s)
    } else if let nsEvent = NSEvent(cgEvent: cgEvent),
              let chars = nsEvent.charactersIgnoringModifiers, !chars.isEmpty {
        parts.append(chars.uppercased())
    } else {
        parts.append("key#\(keyCode)")
    }

    return parts.joined(separator: "+")
}

// ---------------------------------------------------------------- tap callback

// Forward declaration so the C-style callback can re-enable the tap if macOS
// disables it under load.
var globalTap: CFMachPort?

let eventCallback: CGEventTapCallBack = { _, type, event, _ in
    let now = wallMs()
    switch type {
    case .leftMouseDown:
        let loc = event.location
        let x = Int(loc.x), y = Int(loc.y)
        let id = mintClickId()
        emit(["type":"click","click_id":id,"button":"left","x":x,"y":y,"wall_ms":now])
        textQueryQueue.async { emitClickMeta(id: id, x: x, y: y) }
    case .rightMouseDown:
        let loc = event.location
        let x = Int(loc.x), y = Int(loc.y)
        let id = mintClickId()
        emit(["type":"click","click_id":id,"button":"right","x":x,"y":y,"wall_ms":now])
        textQueryQueue.async { emitClickMeta(id: id, x: x, y: y) }
    case .keyDown:
        emit(["type":"keystroke","key":describeKeyDown(event),"wall_ms":now])
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        if let t = globalTap { CGEvent.tapEnable(tap: t, enable: true) }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

// ---------------------------------------------------------------- accessibility

func hasAccessibility() -> Bool {
    let opt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as NSString
    let options: [NSString: Any] = [opt: false]
    return AXIsProcessTrustedWithOptions(options as CFDictionary)
}

// ---------------------------------------------------------------- main

if !hasAccessibility() {
    FileHandle.standardError.write("event-tap: accessibility-denied\n".data(using: .utf8)!)
    exit(2)
}

let mask = (1 << CGEventType.leftMouseDown.rawValue)
         | (1 << CGEventType.rightMouseDown.rawValue)
         | (1 << CGEventType.keyDown.rawValue)

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: CGEventMask(mask),
    callback: eventCallback,
    userInfo: nil
) else {
    FileHandle.standardError.write("event-tap: tapCreate-failed\n".data(using: .utf8)!)
    exit(3)
}

globalTap = tap

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

// SIGINT/SIGTERM via DispatchSource. The `signal(.., SIG_IGN)` is required so
// the default handler doesn't fire before our DispatchSource has a chance.
// On signal: stop the tap, drain any pending text queries (so the last
// clicks don't lose their click_text follow-up), then exit.
let drainAndExit: () -> Void = {
    if let t = globalTap { CGEvent.tapEnable(tap: t, enable: false) }
    CFRunLoopStop(CFRunLoopGetMain())
    textQueryQueue.sync {}
    exit(0)
}
let sigInt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
sigInt.setEventHandler(handler: drainAndExit)
sigInt.resume()
let sigTerm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigTerm.setEventHandler(handler: drainAndExit)
sigTerm.resume()
signal(SIGINT,  SIG_IGN)
signal(SIGTERM, SIG_IGN)

emit(["type":"ready","wall_ms":wallMs()])

CFRunLoopRun()
