/**
 * HOTFIX 13.5.10 — Automatic Next Page Traversal
 * Acceptance Tests
 *
 * Run: node scratch/test_task_13510.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}`);
    failed++;
  }
}

console.log("\n══════════════════════════════════════════════════");
console.log("  HOTFIX 13.5.10 — Automatic Next Page Traversal");
console.log("══════════════════════════════════════════════════\n");

const contentJsPath = path.join(__dirname, "..", "extension", "content.js");
const overlayJsPath = path.join(__dirname, "..", "extension", "overlay.js");

const contentCode = fs.readFileSync(contentJsPath, "utf8");
const overlayCode = fs.readFileSync(overlayJsPath, "utf8");

// ── Section 1: Code Audit for Navigation Helpers ────────────────────────────────
console.log("Section 1: Code Audit for Next Page Traversal Helpers");

assert(
  contentCode.includes("function navigateToNextPageAndWait"),
  "content.js defines navigateToNextPageAndWait helper"
);

assert(
  contentCode.includes("function waitForNewPageRender"),
  "content.js defines waitForNewPageRender helper"
);

assert(
  contentCode.includes("a.artdeco-pagination__button--next") || contentCode.includes("a[aria-label*=\"Next\"]"),
  "findPaginationNextButton supports both <button> and <a> pagination selectors"
);

assert(
  contentCode.includes("navigatingLabel") && contentCode.includes("isNavigating"),
  "session state tracks isNavigating and navigatingLabel"
);

// ── Section 2: Unit Test for findPaginationNextButton ───────────────────────────
console.log("\nSection 2: Testing findPaginationNextButton Selector Logic");

class MockElement {
  constructor(tagName = "DIV", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = "";
    this.classList = { contains: (c) => this.className.includes(c) };
    this.attributes = {};
    this.children = [];
    this.clicked = false;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; }
  hasAttribute(k) { return k in this.attributes; }
  querySelector(sel) { return this.children.find(c => c.matches(sel)) || null; }
  querySelectorAll(sel) { return this.children.filter(c => c.matches(sel)); }
  appendChild(child) { this.children.push(child); return child; }
  click() { this.clicked = true; }
  addEventListener() {}
  removeEventListener() {}
  matches(sel) {
    if (sel.startsWith("button.")) return this.tagName === "BUTTON" && this.className.includes(sel.slice(7));
    if (sel.startsWith("a.")) return this.tagName === "A" && this.className.includes(sel.slice(2));
    if (sel.includes('aria-label*="Next"')) return this.getAttribute("aria-label")?.includes("Next");
    if (sel.includes('aria-label*="next"')) return this.getAttribute("aria-label")?.includes("next");
    if (sel.includes('aria-label="Next"')) return this.getAttribute("aria-label") === "Next";
    return false;
  }
}

class MockMutationObserver {
  observe() {}
  disconnect() {}
}

const mockDoc = new MockElement("DOCUMENT");
const contentSandbox = {
  MutationObserver: MockMutationObserver,
  window: {
    location: { href: "https://www.linkedin.com/search/results/people/?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D&page=10" },
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  document: {
    querySelector: (sel) => mockDoc.querySelector(sel),
    querySelectorAll: (sel) => mockDoc.querySelectorAll(sel),
    body: new MockElement("BODY"),
    documentElement: new MockElement("HTML")
  },
  chrome: {
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    runtime: { sendMessage: () => {}, onMessage: { addListener: () => {} } }
  },
  console,
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout: () => {},
  setInterval: () => 1,
  clearInterval: () => {},
  URL: global.URL, Date, Math, JSON, Map, Set, Promise, Array, Object, RegExp, parseInt, isNaN
};
contentSandbox.self = contentSandbox.window;

vm.createContext(contentSandbox);
vm.runInContext(contentCode, contentSandbox);

// Test enabled Next button detection
const enabledBtn = new MockElement("BUTTON");
enabledBtn.className = "artdeco-pagination__button--next";
enabledBtn.setAttribute("aria-label", "Next");
mockDoc.children.push(enabledBtn);

const foundBtn = contentSandbox.findPaginationNextButton();
assert(foundBtn === enabledBtn, "findPaginationNextButton detects enabled artdeco-pagination__button--next");

// Test disabled Next button ignoring
enabledBtn.setAttribute("disabled", "true");
const foundDisabled = contentSandbox.findPaginationNextButton();
assert(foundDisabled === null, "findPaginationNextButton returns null when Next button is disabled");

// ── Section 3: Test Overlay UI during Navigation (Page 10 → Page 11) ───────────
console.log("\nSection 3: Testing Overlay Navigation Rendering");

class OverlayMockElement extends MockElement {
  constructor(tagName = "DIV", id = "") {
    super(tagName, id);
    this._textContent = "";
    this.style = {};
  }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = String(v); }
  get innerHTML() { return this._innerHTML || ""; }
  set innerHTML(v) { this._innerHTML = String(v); }
  querySelector(sel) {
    if (sel.startsWith("#")) return getMockEl(sel.slice(1));
    if (sel.startsWith(".")) return getMockEl(sel.slice(1));
    return getMockEl("generic");
  }
}

const mockStore = new Map();
function getMockEl(id) {
  if (!mockStore.has(id)) {
    mockStore.set(id, new OverlayMockElement("DIV", id));
  }
  return mockStore.get(id);
}

const mockOverlayBody = new OverlayMockElement("BODY");

const overlaySandbox = {
  window: {
    location: { href: "https://www.linkedin.com/search/results/people/?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D&page=10" },
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  document: {
    getElementById: (id) => getMockEl(id),
    createElement: (tag) => new OverlayMockElement(tag),
    head: new OverlayMockElement("HEAD"),
    body: mockOverlayBody,
    querySelector: (sel) => {
      if (sel.startsWith("#")) return getMockEl(sel.slice(1));
      if (sel.startsWith(".")) return getMockEl(sel.slice(1));
      return getMockEl("generic");
    },
    querySelectorAll: () => [],
    addEventListener: () => {}
  },
  chrome: {
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    runtime: { sendMessage: () => {} }
  },
  console,
  setTimeout, clearTimeout, setInterval, clearInterval
};

vm.createContext(overlaySandbox);
vm.runInContext(overlayCode, overlaySandbox);

const manager = overlaySandbox.window.WarmGraphOverlay;

// Render Navigating state (Page 10 -> Page 11)
manager.update({
  state: "navigating",
  isNavigating: true,
  engineType: "PEOPLE_SEARCH",
  extractedConnections: 186,
  actualProfiles: 0,
  totalConnections: 0,
  progressPercent: 0,
  pageCount: 10,
  currentPage: 10,
  navigatingLabel: "Page 10 → Page 11",
  statusMessage: "Navigating to next results..."
});

const navHeroMetric    = getMockEl("warmgraph-hero-metric").textContent;
const navHeroRemaining = getMockEl("warmgraph-hero-remaining").textContent;
const navPillBadge     = getMockEl("warmgraph-status-text").textContent;

assert(navHeroMetric === "186", `Hero metric during navigation shows extracted count '186', got '${navHeroMetric}'`);
assert(navHeroRemaining?.includes("Page 10 → Page 11"), `Hero remaining includes 'Page 10 → Page 11', got '${navHeroRemaining}'`);
assert(navHeroRemaining?.includes("Navigating to next results..."), `Hero remaining includes 'Navigating to next results...', got '${navHeroRemaining}'`);
assert(navPillBadge === "🟢 Auto Extracting", `Status badge shows '🟢 Auto Extracting', got '${navPillBadge}'`);

// Render post-navigation state (Page 11)
manager.update({
  state: "acquiring",
  isNavigating: false,
  engineType: "PEOPLE_SEARCH",
  extractedConnections: 196,
  actualProfiles: 0,
  totalConnections: 0,
  progressPercent: 0,
  pageCount: 11,
  currentPage: 11,
  paginationLabel: "Page 11"
});

const loadedHeroMetric    = getMockEl("warmgraph-hero-metric").textContent;
const loadedHeroRemaining = getMockEl("warmgraph-hero-remaining").textContent;

assert(loadedHeroMetric === "196", `Hero metric on Page 11 loaded shows '196', got '${loadedHeroMetric}'`);
assert(loadedHeroRemaining?.includes("Page 11"), `Hero remaining shows 'Page 11', got '${loadedHeroRemaining}'`);
assert(loadedHeroRemaining?.includes("Auto Extracting"), `Hero remaining shows 'Auto Extracting', got '${loadedHeroRemaining}'`);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════");
console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log("══════════════════════════════════════════════════\n");

if (failed > 0) process.exit(1);
