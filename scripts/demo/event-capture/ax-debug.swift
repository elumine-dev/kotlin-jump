// scripts/demo/event-capture/ax-debug.swift
//
// Diagnostic + automation CLI for the kjdemo event-tap pipeline.
//
//   ax-debug ax <x> <y>            full AX dump at coordinate
//   ax-debug click <x> <y> [right] synthesize a mouse click
//   ax-debug click-and-dump <x> <y>  click + 150ms wait + ax dump
//   ax-debug type "<text>"         synthesize keystrokes
//   ax-debug focused               dump system / app focused element
//   ax-debug tree <pid>            full AX tree of an app
//
// Output is JSON to stdout. Errors / exit code 2 = accessibility denied.

import Foundation
import Cocoa
import ApplicationServices

// =================================================================== helpers

func axString(_ el: AXUIElement, _ attr: CFString) -> String? {
    var v: AnyObject?
    guard AXUIElementCopyAttributeValue(el, attr, &v) == .success,
          let s = v as? String, !s.isEmpty else { return nil }
    return s
}

func axBool(_ el: AXUIElement, _ attr: CFString) -> Bool? {
    var v: AnyObject?
    guard AXUIElementCopyAttributeValue(el, attr, &v) == .success else { return nil }
    return (v as? NSNumber)?.boolValue
}

func axParent(_ el: AXUIElement) -> AXUIElement? {
    var v: AnyObject?
    guard AXUIElementCopyAttributeValue(el, kAXParentAttribute as CFString, &v) == .success,
          let p = v, CFGetTypeID(p) == AXUIElementGetTypeID()
    else { return nil }
    return (p as! AXUIElement)
}

func axElementArray(_ el: AXUIElement, _ attr: CFString) -> [AXUIElement] {
    var v: AnyObject?
    guard AXUIElementCopyAttributeValue(el, attr, &v) == .success,
          let arr = v as? NSArray else { return [] }
    var out: [AXUIElement] = []
    for item in arr {
        let cf = item as CFTypeRef
        if CFGetTypeID(cf) == AXUIElementGetTypeID() {
            out.append(cf as! AXUIElement)
        }
    }
    return out
}

func axChildren(_ el: AXUIElement) -> [AXUIElement] {
    let kids = axElementArray(el, kAXChildrenAttribute as CFString)
    if !kids.isEmpty { return kids }
    let visible = axElementArray(el, kAXVisibleChildrenAttribute as CFString)
    if !visible.isEmpty { return visible }
    return axElementArray(el, "AXContents" as CFString)
}

func axFrame(_ el: AXUIElement) -> CGRect? {
    var posV: AnyObject?
    var szV:  AnyObject?
    guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &posV) == .success,
          AXUIElementCopyAttributeValue(el, kAXSizeAttribute     as CFString, &szV)  == .success
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

func axAllAttributes(_ el: AXUIElement) -> [String] {
    var arr: CFArray?
    guard AXUIElementCopyAttributeNames(el, &arr) == .success,
          let names = arr as? [String] else { return [] }
    return names
}

func axAllParameterized(_ el: AXUIElement) -> [String] {
    var arr: CFArray?
    guard AXUIElementCopyParameterizedAttributeNames(el, &arr) == .success,
          let names = arr as? [String] else { return [] }
    return names
}

func axAllActions(_ el: AXUIElement) -> [String] {
    var arr: CFArray?
    guard AXUIElementCopyActionNames(el, &arr) == .success,
          let names = arr as? [String] else { return [] }
    return names
}

// =================================================================== element summary

func summariseElement(_ el: AXUIElement, deep: Bool = true) -> [String: Any] {
    var out: [String: Any] = [:]
    if let s = axString(el, kAXRoleAttribute            as CFString) { out["role"]             = s }
    if let s = axString(el, kAXSubroleAttribute         as CFString) { out["subrole"]          = s }
    if let s = axString(el, kAXRoleDescriptionAttribute as CFString) { out["role_description"] = s }
    if let s = axString(el, kAXTitleAttribute           as CFString) { out["title"]            = s }
    if let s = axString(el, kAXValueAttribute           as CFString) { out["value"]            = s }
    if let s = axString(el, kAXDescriptionAttribute     as CFString) { out["description"]      = s }
    if let s = axString(el, kAXIdentifierAttribute      as CFString) { out["identifier"]       = s }
    if let s = axString(el, kAXHelpAttribute            as CFString) { out["help"]             = s }
    if let s = axString(el, kAXSelectedTextAttribute    as CFString) { out["selected_text"]    = s }
    if let s = axString(el, "AXLabel"                   as CFString) { out["label"]            = s }
    if let s = axString(el, "AXDOMClassList"            as CFString) { out["dom_classes"]      = s }
    if let s = axString(el, "AXDOMIdentifier"           as CFString) { out["dom_id"]           = s }

    if let f = axFrame(el) {
        out["frame"] = ["x": f.origin.x, "y": f.origin.y, "w": f.size.width, "h": f.size.height]
    }
    if let b = axBool(el, kAXFocusedAttribute as CFString) { out["focused_attr"] = b }
    if let b = axBool(el, kAXEnabledAttribute as CFString) { out["enabled"]      = b }
    if let b = axBool(el, kAXMainAttribute    as CFString) { out["main"]         = b }

    out["children_count"]         = axElementArray(el, kAXChildrenAttribute        as CFString).count
    out["visible_children_count"] = axElementArray(el, kAXVisibleChildrenAttribute as CFString).count
    out["contents_count"]         = axElementArray(el, "AXContents"                as CFString).count

    if deep {
        out["all_attributes"]   = axAllAttributes(el)
        out["all_parameterized"] = axAllParameterized(el)
        out["all_actions"]      = axAllActions(el)
    }
    return out
}

// =================================================================== tree dump

class TreeDumper {
    var counter = 0
    let maxNodes: Int
    let maxDepth: Int
    let probePoint: CGPoint?
    var nodes: [[String: Any]] = []
    var smallest: AXUIElement?
    var smallestArea: CGFloat = .infinity
    var smallestPath: [String] = []

    init(maxDepth: Int = 12, maxNodes: Int = 500, point: CGPoint? = nil) {
        self.maxDepth   = maxDepth
        self.maxNodes   = maxNodes
        self.probePoint = point
    }

    func walk(_ el: AXUIElement, depth: Int, path: [String]) {
        guard counter < maxNodes && depth <= maxDepth else { return }
        counter += 1
        let summary = summariseElement(el, deep: false)
        var node = summary
        node["depth"] = depth
        node["path_idx"] = path.joined(separator: " > ")
        nodes.append(node)

        if let p = probePoint, let f = axFrame(el), f.contains(p) {
            let area = f.width * f.height
            if area < smallestArea {
                smallestArea = area
                smallest     = el
                smallestPath = path
            }
        }
        for (i, child) in axChildren(el).enumerated() {
            let role = (summary["role"] as? String) ?? "?"
            walk(child, depth: depth + 1, path: path + ["[\(i)]\(role)"])
        }
    }

    func report(includeNodes: Bool = false) -> [String: Any] {
        var out: [String: Any] = [
            "node_count": counter,
            "max_depth":  maxDepth,
            "max_nodes":  maxNodes,
        ]
        if let s = smallest {
            out["smallest_under_point"] = summariseElement(s, deep: true)
            out["smallest_path"]        = smallestPath.joined(separator: " > ")
        }
        if includeNodes {
            out["nodes"] = nodes
        }
        return out
    }
}

// =================================================================== sub-commands

func cmdAx(x: Int, y: Int) {
    let sw = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(sw, 0.5)

    var out: [String: Any] = ["click_point": ["x": x, "y": y]]
    var timings: [String: Int] = [:]

    // 1. Hit-test + ancestor chain
    let t0 = Date()
    var hit: AXUIElement?
    let err = AXUIElementCopyElementAtPosition(sw, Float(x), Float(y), &hit)
    timings["hit_test"] = Int(Date().timeIntervalSince(t0) * 1000)
    if err == .success, let h = hit {
        var chain: [[String: Any]] = []
        var cur: AXUIElement? = h
        var d = 0
        while let el = cur, d < 12 {
            chain.append(summariseElement(el, deep: false))
            cur = axParent(el)
            d  += 1
        }
        out["hit_test_chain"] = chain
    } else {
        out["hit_test_error"] = "code \(err.rawValue)"
    }

    // 2. System-wide focused element
    let t1 = Date()
    var focusedV: AnyObject?
    if AXUIElementCopyAttributeValue(sw, kAXFocusedUIElementAttribute as CFString, &focusedV) == .success,
       let f = focusedV, CFGetTypeID(f) == AXUIElementGetTypeID() {
        out["system_focused_element"] = summariseElement(f as! AXUIElement, deep: true)
    } else {
        out["system_focused_element"] = NSNull()
    }
    timings["system_focused"] = Int(Date().timeIntervalSince(t1) * 1000)

    // 3. Focused application + its focused element + its focused window
    let t2 = Date()
    var appV: AnyObject?
    if AXUIElementCopyAttributeValue(sw, kAXFocusedApplicationAttribute as CFString, &appV) == .success,
       let a = appV, CFGetTypeID(a) == AXUIElementGetTypeID() {
        let app = a as! AXUIElement
        AXUIElementSetMessagingTimeout(app, 0.5)
        out["focused_app"] = summariseElement(app, deep: false)

        var afv: AnyObject?
        if AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &afv) == .success,
           let f = afv, CFGetTypeID(f) == AXUIElementGetTypeID() {
            out["app_focused_element"] = summariseElement(f as! AXUIElement, deep: true)
        }

        var winV: AnyObject?
        if AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &winV) == .success,
           let w = winV, CFGetTypeID(w) == AXUIElementGetTypeID() {
            let win = w as! AXUIElement
            out["focused_window"] = summariseElement(win, deep: false)

            // 4. Recursive descent from the window, looking for smallest under point
            let t3 = Date()
            let dumper = TreeDumper(maxDepth: 16, maxNodes: 2000, point: CGPoint(x: x, y: y))
            dumper.walk(win, depth: 0, path: ["AXWindow"])
            out["window_descent"] = dumper.report()
            timings["window_descent"] = Int(Date().timeIntervalSince(t3) * 1000)
        }
    }
    timings["focused_app_total"] = Int(Date().timeIntervalSince(t2) * 1000)

    out["timings_ms"] = timings
    printJson(out)
}

func cmdClick(x: Int, y: Int, button: CGMouseButton = .left) {
    let p = CGPoint(x: x, y: y)
    let downType: CGEventType = (button == .left) ? .leftMouseDown : .rightMouseDown
    let upType:   CGEventType = (button == .left) ? .leftMouseUp   : .rightMouseUp
    let down = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: p, mouseButton: button)
    let up   = CGEvent(mouseEventSource: nil, mouseType: upType,   mouseCursorPosition: p, mouseButton: button)
    down?.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.03)
    up?.post(tap: .cghidEventTap)
}

func cmdClickAndDump(x: Int, y: Int) {
    cmdClick(x: x, y: y)
    Thread.sleep(forTimeInterval: 0.15)
    cmdAx(x: x, y: y)
}

func cmdType(_ text: String) {
    for ch in text {
        let s = String(ch)
        let utf16 = Array(s.utf16)
        let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
        let up   = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
        utf16.withUnsafeBufferPointer { buf in
            down?.keyboardSetUnicodeString(stringLength: buf.count, unicodeString: buf.baseAddress)
            up?.keyboardSetUnicodeString(stringLength: buf.count, unicodeString: buf.baseAddress)
        }
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.02)
    }
}

func cmdFocused() {
    let sw = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(sw, 0.5)
    var out: [String: Any] = [:]

    var fv: AnyObject?
    if AXUIElementCopyAttributeValue(sw, kAXFocusedUIElementAttribute as CFString, &fv) == .success,
       let f = fv, CFGetTypeID(f) == AXUIElementGetTypeID() {
        out["system_focused"] = summariseElement(f as! AXUIElement, deep: true)
    } else {
        out["system_focused"] = NSNull()
    }

    var av: AnyObject?
    if AXUIElementCopyAttributeValue(sw, kAXFocusedApplicationAttribute as CFString, &av) == .success,
       let a = av, CFGetTypeID(a) == AXUIElementGetTypeID() {
        let app = a as! AXUIElement
        out["focused_app"] = summariseElement(app, deep: false)
        var afv: AnyObject?
        if AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &afv) == .success,
           let f = afv, CFGetTypeID(f) == AXUIElementGetTypeID() {
            out["app_focused"] = summariseElement(f as! AXUIElement, deep: true)
        }
    }
    printJson(out)
}

func cmdTree(pid: Int32, point: CGPoint? = nil) {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.5)
    let dumper = TreeDumper(maxDepth: 18, maxNodes: 5000, point: point)
    dumper.walk(app, depth: 0, path: ["AXApplication"])
    var report = dumper.report(includeNodes: true)
    report["pid"] = Int(pid)
    printJson(report)
}

// =================================================================== output helper

func printJson(_ obj: Any) {
    do {
        let data = try JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys])
        if let s = String(data: data, encoding: .utf8) {
            print(s)
            fflush(stdout)
        }
    } catch {
        FileHandle.standardError.write("ax-debug: json serialisation failed: \(error)\n".data(using: .utf8)!)
        exit(4)
    }
}

// =================================================================== main

let args = CommandLine.arguments
if args.count < 2 {
    FileHandle.standardError.write("""
    usage:
      ax-debug ax <x> <y>
      ax-debug click <x> <y> [right]
      ax-debug click-and-dump <x> <y>
      ax-debug type "<text>"
      ax-debug focused
      ax-debug tree <pid> [<x> <y>]

    """.data(using: .utf8)!)
    exit(1)
}

// Accessibility check
do {
    let opt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as NSString
    let options: [NSString: Any] = [opt: false]
    if !AXIsProcessTrustedWithOptions(options as CFDictionary) {
        FileHandle.standardError.write("ax-debug: accessibility-denied\n".data(using: .utf8)!)
        exit(2)
    }
}

switch args[1] {
case "ax":
    guard args.count == 4, let x = Int(args[2]), let y = Int(args[3]) else {
        FileHandle.standardError.write("usage: ax-debug ax <x> <y>\n".data(using: .utf8)!); exit(1)
    }
    cmdAx(x: x, y: y)
case "click":
    guard args.count >= 4, let x = Int(args[2]), let y = Int(args[3]) else {
        FileHandle.standardError.write("usage: ax-debug click <x> <y> [right]\n".data(using: .utf8)!); exit(1)
    }
    let button: CGMouseButton = (args.count >= 5 && args[4] == "right") ? .right : .left
    cmdClick(x: x, y: y, button: button)
case "click-and-dump":
    guard args.count == 4, let x = Int(args[2]), let y = Int(args[3]) else {
        FileHandle.standardError.write("usage: ax-debug click-and-dump <x> <y>\n".data(using: .utf8)!); exit(1)
    }
    cmdClickAndDump(x: x, y: y)
case "type":
    guard args.count == 3 else {
        FileHandle.standardError.write("usage: ax-debug type \"<text>\"\n".data(using: .utf8)!); exit(1)
    }
    cmdType(args[2])
case "focused":
    cmdFocused()
case "tree":
    guard args.count >= 3, let pid = Int32(args[2]) else {
        FileHandle.standardError.write("usage: ax-debug tree <pid> [<x> <y>]\n".data(using: .utf8)!); exit(1)
    }
    var point: CGPoint? = nil
    if args.count == 5, let x = Int(args[3]), let y = Int(args[4]) {
        point = CGPoint(x: x, y: y)
    }
    cmdTree(pid: pid, point: point)
default:
    FileHandle.standardError.write("unknown command: \(args[1])\n".data(using: .utf8)!)
    exit(1)
}
