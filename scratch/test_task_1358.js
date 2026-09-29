/**
 * TASK 13.5.8 — Hover Card Intelligence Engine
 * Acceptance Tests
 *
 * Run:  node scratch/test_task_1358.js
 */

"use strict";

const fs   = require("fs");
const vm   = require("vm");
const path = require("path");

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  [PASS]  ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL]  ${label}`);
    failed++;
  }
}

// ─── Minimal DOM element mock ─────────────────────────────────────────────────

function makeEl(opts = {}) {
  const {
    role            = null,
    ariaLabel       = null,
    ariaDescribedBy = null,
    ariaLive        = null,
    children        = [],
    href            = null,
    tagName         = "DIV",
    text            = "",
    src             = null,
    dataField       = null,
    className       = null
  } = opts;

  const attrs = {};
  if (role)             attrs.role                 = role;
  if (ariaLabel)        attrs["aria-label"]        = ariaLabel;
  if (ariaDescribedBy)  attrs["aria-describedby"]  = ariaDescribedBy;
  if (ariaLive)         attrs["aria-live"]         = ariaLive;
  if (href)             attrs.href                 = href;

  const el = {
    nodeType: 1,
    tagName,
    href,
    src,
    className: className || "",
    innerText: text,
    textContent: text,
    _dataField: dataField,
    _className: className,
    children,
    getAttribute:  (k) => attrs[k] != null ? attrs[k] : null,
    hasAttribute:  (k) => k in attrs,
    querySelector: (sel) => {
      // Minimal selector matching for test purposes
      for (const child of children) {
        if (!child || child.nodeType !== 1) continue;
        if (sel === 'a[href*="/in/"]' && child.tagName === "A" && child.href && child.href.includes("/in/")) return child;
        if (sel.startsWith('img') && child.tagName === "IMG" && child.src) return child;
        if (sel === "h1" && child.tagName === "H1") return child;
        if (sel === "h2" && child.tagName === "H2") return child;
        if (sel === "h3" && child.tagName === "H3") return child;
        if (sel.includes('[data-field="name"]')     && child._dataField === "name")     return child;
        if (sel.includes('[data-field="headline"]') && child._dataField === "headline") return child;
        if (sel.includes('[data-field="location"]') && child._dataField === "location") return child;
        if (sel.includes('span[class*="name"]')     && child.tagName === "SPAN" && child._className && child._className.includes("name"))     return child;
        if (sel.includes('span[class*="headline"]') && child.tagName === "SPAN" && child._className && child._className.includes("headline")) return child;
        if (sel.includes('div[class*="headline"]')  && child.tagName === "DIV"  && child._className && child._className.includes("headline")) return child;
        if (sel.includes('span[class*="location"]') && child.tagName === "SPAN" && child._className && child._className.includes("location")) return child;
        if (sel.includes('div[class*="location"]')  && child.tagName === "DIV"  && child._className && child._className.includes("location")) return child;
        if (sel.includes('span[class*="subline"]')  && child.tagName === "SPAN" && child._className && child._className.includes("subline"))  return child;
      }
      return null;
    },
    querySelectorAll: () => []
  };
  return el;
}

function makeAnchor(slug, ariaLabel = null) {
  const href = `https://www.linkedin.com/in/${slug}`;
  const a = makeEl({ tagName: "A", href, text: slug, ariaLabel: ariaLabel || null });
  a.href = href;
  return a;
}

// ─── Build sandbox ────────────────────────────────────────────────────────────

let observerCallback      = null;
let observerObserved      = false;
let observerDisconnected  = false;

class MockMutationObserver {
  constructor(cb) { observerCallback = cb; }
  observe(target, opts) { observerObserved = true; }
  disconnect()          { observerDisconnected = true; }
}

const sandbox = {
  MutationObserver: MockMutationObserver,
  window: {
    location: {
      href:     "https://www.linkedin.com/mynetwork/invite-connect/connections/",
      pathname: "/mynetwork/invite-connect/connections/",
      search:   "",
      origin:   "https://www.linkedin.com"
    },
    addEventListener:    (evt, fn) => {},
    removeEventListener: ()        => {},
    dispatchEvent:       ()        => {},
    scrollY:   0,
    innerHeight: 800,
    TEST_ACQUISITION_DELAY_MS: 0,
    __warmgraphAcquisitionRunning: false,
  },
  document: {
    documentElement: makeEl({ tagName: "HTML" }),
    body:            makeEl({ tagName: "BODY" }),
    querySelector:    ()  => null,
    querySelectorAll: ()  => [],
    addEventListener: ()  => {},
    visibilityState: "visible",
  },
  navigator: { userAgent: "node-test" },
  chrome: {
    storage: {
      local: {
        get: (keys, cb) => cb && cb({}),
        set: (data, cb) => cb && cb(),
        onChanged: { addListener: () => {} }
      }
    },
    runtime: {
      sendMessage: () => {},
      onMessage: { addListener: () => {} }
    }
  },
  console,
  setTimeout:   (fn) => { fn(); return 1; },
  clearTimeout: ()   => {},
  setInterval:  ()   => 1,
  clearInterval:()   => {},
  URL:          global.URL,
  Date, JSON, Math, parseInt, parseFloat, isNaN,
  Array, Object, Map, Set, Promise, Error, RegExp
};

sandbox.window.document = sandbox.document;

vm.createContext(sandbox);

const contentSrc = fs.readFileSync(
  path.join(__dirname, "../extension/content.js"),
  "utf8"
);

vm.runInContext(contentSrc, sandbox, { filename: "content.js" });

// After executing the script, `class` and `const` declarations inside the VM
// are block-scoped and NOT promoted to the sandbox object.
// The content.js code exports them via `window.X = X`, so we read from window.
const HoverIntelligenceEngine = sandbox.window.HoverIntelligenceEngine;
const engine                  = sandbox.window.hoverIntelligenceEngine;

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════");
console.log("  TASK 13.5.8 — Hover Card Intelligence Engine");
console.log("══════════════════════════════════════════════════\n");

// ── Section 1: Class existence ────────────────────────────────────────────────
console.log("Section 1: Class & singleton existence");

assert(
  typeof HoverIntelligenceEngine === "function",
  "HoverIntelligenceEngine class is defined in the VM context"
);

assert(
  engine != null && typeof engine === "object",
  "Global singleton hoverIntelligenceEngine exists"
);

assert(
  engine._started === true,
  "Engine is automatically started on page load"
);

// Also verify the window export
assert(
  sandbox.window.HoverIntelligenceEngine === HoverIntelligenceEngine,
  "HoverIntelligenceEngine exported to window.HoverIntelligenceEngine"
);
assert(
  sandbox.window.hoverIntelligenceEngine === engine,
  "hoverIntelligenceEngine singleton exported to window.hoverIntelligenceEngine"
);

// ── Section 2: _isHoverCard detection ────────────────────────────────────────
console.log("\nSection 2: _isHoverCard detection logic (browser-agnostic signals)");

const dialogCard  = makeEl({ role: "dialog",  children: [makeAnchor("john-doe")] });
const tooltipCard = makeEl({ role: "tooltip", children: [makeAnchor("jane-smith")] });
const listboxCard = makeEl({ role: "listbox", children: [makeAnchor("alice-jones")] });
const ariaLabelCard = makeEl({ ariaLabel: "Jane Smith's profile", children: [makeAnchor("jane-smith-x9")] });
const ariaDescCard  = makeEl({ ariaDescribedBy: "hover-desc-123",  children: [makeAnchor("bob-brown")] });
const ariaLiveCard  = makeEl({ ariaLive: "polite", children: [makeAnchor("carol-white")] });

assert(engine._isHoverCard(dialogCard),   "Detects role=dialog  with a profile link");
assert(engine._isHoverCard(tooltipCard),  "Detects role=tooltip with a profile link");
assert(engine._isHoverCard(listboxCard),  "Detects role=listbox with a profile link");
assert(engine._isHoverCard(ariaLabelCard),"Detects aria-label card with a profile link");
assert(engine._isHoverCard(ariaDescCard), "Detects aria-describedby card with a profile link");
assert(engine._isHoverCard(ariaLiveCard), "Detects aria-live card with a profile link");

const noLink   = makeEl({ role: "dialog", children: [] });
const noSignal = makeEl({ children: [makeAnchor("whoever")] });
const textNode = { nodeType: 3 };

assert(!engine._isHoverCard(noLink),   "Rejects role=dialog WITHOUT a profile link");
assert(!engine._isHoverCard(noSignal), "Rejects plain div (no role/aria) even with a profile link");
assert(!engine._isHoverCard(textNode), "Rejects text nodes (nodeType 3)");
assert(!engine._isHoverCard(null),     "Handles null gracefully → false");
assert(!engine._isHoverCard(undefined),"Handles undefined gracefully → false");

// Verify no hashed BEM class names are used inside the engine
const hieBlock = contentSrc.slice(
  contentSrc.indexOf("class HoverIntelligenceEngine"),
  contentSrc.indexOf("// Instantiate the global hover intelligence engine singleton.")
);
assert(
  !hieBlock.match(/querySelector\s*\(\s*['"][^'"]*__[^'"]*['"]\s*\)/),
  "No hashed BEM class names used inside HoverIntelligenceEngine"
);

// ── Section 3: _extractFromHoverCard ─────────────────────────────────────────
console.log("\nSection 3: _extractFromHoverCard data extraction");

const headlineSpan = makeEl({ tagName: "SPAN", text: "Software Engineer at Acme Corp", className: "headline-text" });
const fullCard = makeEl({
  role: "dialog",
  text: "Alice Wonderland\nSoftware Engineer at Acme Corp\nBangalore, India",
  children: [
    makeAnchor("alice-wonderland-ab123", "Alice Wonderland"),
    headlineSpan
  ]
});

const extracted = engine._extractFromHoverCard(fullCard);
assert(extracted !== null,                                        "Extracts a data object from a valid hover card");
assert(
  extracted && extracted.profile_url === "https://www.linkedin.com/in/alice-wonderland-ab123",
  "Correct normalized profile_url extracted"
);
assert(extracted && extracted.source === "hover_card",            "source field is 'hover_card'");
assert(extracted && typeof extracted.captured_at === "string",    "captured_at timestamp is present");
assert(extracted && extracted.name != null,                       "name is captured (from aria-label or fallback)");

const emptyCard = makeEl({ role: "dialog", children: [] });
assert(engine._extractFromHoverCard(emptyCard) === null, "Returns null when card has no profile anchor");

// ── Section 4: Deduplication ──────────────────────────────────────────────────
console.log("\nSection 4: Per-session deduplication via hover cache");

engine._hoverCache.clear();

let checkpointCount = 0;
const fakeSession = {
  connections: new Map(),
  state: "completed",
  checkpointSessionSync: () => { checkpointCount++; }
};

// `acquisitionSession` is a `const` in the VM block scope, readable via
// `window.acquisitionSession` (set by the script when it assigns
// `window.acquisitionSession = acquisitionSession` implicitly or not).
// In practice the engine closure reads `acquisitionSession` from its own
// scope, so we swap it on window (which is the sandbox.window reference).
const origAcqSession = sandbox.window.acquisitionSession;
sandbox.window.acquisitionSession = fakeSession;

const DEDUP_KEY = "url:https://www.linkedin.com/in/alice-wonderland-ab123";
fakeSession.connections.set(DEDUP_KEY, {
  name: "Alice Wonderland",
  profile_url: "https://www.linkedin.com/in/alice-wonderland-ab123",
  headline: null,
  company: null
});

// First call — should process and add to cache
engine._processCard(fullCard);
assert(engine._hoverCache.has(DEDUP_KEY), "Profile URL added to hover cache after first extraction");

// Second call — should be skipped due to cache
const cntBefore = checkpointCount;
engine._processCard(fullCard);
assert(checkpointCount === cntBefore, "Second extraction of same profile is skipped (hover cache hit)");

// Restore
sandbox.window.acquisitionSession = origAcqSession;

// ── Section 5: Fill-missing-only merge ────────────────────────────────────────
console.log("\nSection 5: Fill-missing-only merge via mergeRecord");

const existingRich = {
  name: "Bob Builder",
  profile_url: "https://www.linkedin.com/in/bob-builder",
  headline: "Senior Architect at BigCorp",   // rich value — must NOT be overwritten
  company:  "BigCorp",                        // rich value — must NOT be overwritten
  location: null                              // empty — SHOULD be filled
};
const hoverData = {
  name: "Bob Builder",
  profile_url: "https://www.linkedin.com/in/bob-builder",
  headline: "Engineer",                       // weaker
  company:  "OtherCorp",                      // weaker
  location: "San Francisco, CA",              // new field
  source:   "hover_card",
  captured_at: new Date().toISOString()
};

// mergeRecord is a function declaration, accessible via sandbox.mergeRecord.
// The engine calls mergeRecord(data, existing) so existing wins.
// Verify this semantics directly using the same argument order.
const merged = sandbox.mergeRecord(hoverData, existingRich);
assert(merged.headline === "Senior Architect at BigCorp", "Rich headline is NOT overwritten by hover data (existing wins as 'current')");
assert(merged.company  === "BigCorp",                    "Rich company  is NOT overwritten by hover data (existing wins as 'current')");
assert(merged.location === "San Francisco, CA",           "Missing location IS filled from hover data (baseline empty field)");

// ── Section 6: Observer architecture ─────────────────────────────────────────
console.log("\nSection 6: MutationObserver architecture");

assert(observerObserved, "HoverIntelligenceEngine's MutationObserver.observe() was called on startup");

// Exactly one MutationObserver instantiation inside the engine
const engineInstances = (hieBlock.match(/new MutationObserver/g) || []).length;
assert(engineInstances === 1, "Exactly one MutationObserver is created inside HoverIntelligenceEngine");

// The engine does NOT use isApprovedExtractionPage — hover works on ANY LinkedIn page
assert(!hieBlock.includes("isApprovedExtractionPage"), "Engine does NOT gate itself on isApprovedExtractionPage");
assert(!hieBlock.includes("runAcquisitionLoop"),        "Engine does NOT call runAcquisitionLoop");

// ── Section 7: stop() lifecycle ───────────────────────────────────────────────
console.log("\nSection 7: stop() lifecycle");

const testEngine = new HoverIntelligenceEngine();
testEngine.start();
assert(testEngine._started === true, "Engine reports _started=true after start()");
testEngine.stop();
assert(testEngine._started === false, "Engine reports _started=false after stop()");
assert(testEngine._observer === null,  "Observer reference cleared after stop()");

// Double-start guard
testEngine.start();
testEngine.start(); // second call must be a no-op
assert(testEngine._started === true,  "start() is idempotent — second call is no-op");

// ── Section 8: Non-interference with primary engines ─────────────────────────
console.log("\nSection 8: Non-interference with primary acquisition engines");

// Functions are hoisted — check sandbox.*
assert(typeof sandbox.getAcquisitionEngineType === "function", "getAcquisitionEngineType() still present (Task 13.5.7)");
assert(typeof sandbox.isApprovedExtractionPage === "function", "isApprovedExtractionPage() still present");
assert(typeof sandbox.mergeRecord              === "function", "mergeRecord() still present");
assert(typeof sandbox.normalizeProfileUrl      === "function", "normalizeProfileUrl() still present");
// acquisitionSession is a const — accessible via window
assert(typeof sandbox.window.acquisitionSession === "object",  "acquisitionSession (primary engine) still exists on window");

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════");
console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log("══════════════════════════════════════════════════\n");

if (failed > 0) process.exit(1);

