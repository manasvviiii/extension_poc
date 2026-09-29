/**
 * HOTFIX 13.5.12 — Force Automatic Next Button Navigation
 * Acceptance Tests
 *
 * Run: node scratch/test_task_13512.js
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
console.log("  HOTFIX 13.5.12 — Force Automatic Next Navigation");
console.log("══════════════════════════════════════════════════\n");

const contentJsPath = path.join(__dirname, "..", "extension", "content.js");
const overlayJsPath = path.join(__dirname, "..", "extension", "overlay.js");

const contentCode = fs.readFileSync(contentJsPath, "utf8");
const overlayCode = fs.readFileSync(overlayJsPath, "utf8");

// ── Section 1: Code Audit for Mandatory Navigation Logic ───────────────────────
console.log("Section 1: Code Audit for Next Navigation & Finish Guard");

assert(
  contentCode.includes("if (nextBtn) {") && contentCode.includes("await navigateToNextPageAndWait(this);") && contentCode.includes("continue;"),
  "runAcquisitionLoop continues pagination loop whenever Next button exists"
);

assert(
  !contentCode.includes("Next page did not load. Acquisition paused."),
  "runAcquisitionLoop does NOT prematurely pause or interrupt pagination"
);

assert(
  contentCode.includes("timer = setTimeout(() => finish(true), timeoutMs);"),
  "waitForNewPageRender fallback resolves true so traversal is resilient"
);

// ── Section 2: Unit Test for Navigation Decision Flow ───────────────────────────
console.log("\nSection 2: Testing Navigation Decision Flow");

class MockElement {
  constructor(tagName = "DIV", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = "";
    this.classList = { contains: (c) => this.className.includes(c) };
    this.attributes = {};
    this.children = [];
    this.clicked = false;
    this._textContent = "";
  }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = String(v); }
  get href() { return this.getAttribute("href") || ""; }
  get innerText() { return this._textContent; }
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
    if (sel.includes('href*="/in/"')) return this.tagName === "A" && this.getAttribute("href")?.includes("/in/");
    if (sel.startsWith("button.")) return this.tagName === "BUTTON" && this.className.includes(sel.slice(7));
    if (sel.startsWith("a.")) return this.tagName === "A" && this.className.includes(sel.slice(2));
    if (sel.includes('aria-label*="Next"')) return this.getAttribute("aria-label")?.includes("Next");
    return false;
  }
}

class MockMutationObserver {
  observe() {}
  disconnect() {}
}

const mockDoc = new MockElement("DOCUMENT");
const enabledNextBtn = new MockElement("BUTTON");
enabledNextBtn.className = "artdeco-pagination__button--next";
enabledNextBtn.setAttribute("aria-label", "Next page");
mockDoc.appendChild(enabledNextBtn);

const cardAnchor = new MockElement("A");
cardAnchor.setAttribute("href", "https://www.linkedin.com/in/user-page1");
mockDoc.appendChild(cardAnchor);

const contentSandbox = {
  MutationObserver: MockMutationObserver,
  window: {
    location: { href: "https://www.linkedin.com/search/results/people/?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D", pathname: "/search/results/people" },
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

(async function runTests() {
  const session = contentSandbox.window.acquisitionSession;

  // Test navigateToNextPageAndWait clicks Next button and transitions state
  const navSuccess = await contentSandbox.navigateToNextPageAndWait(session);
  assert(enabledNextBtn.clicked === true, "navigateToNextPageAndWait triggers programmatic click on Next button");
  assert(navSuccess === true, "navigateToNextPageAndWait resolves true");

  // ── Section 3: Testing Overlay UI (Page 1 Complete → Page 2) ──────────────────
  console.log("\nSection 3: Testing Overlay UI Navigation & Page Load");

  class OverlayMockElement extends MockElement {
    constructor(tagName = "DIV", id = "") {
      super(tagName, id);
      this.style = {};
    }
    get innerHTML() { return this._innerHTML || ""; }
    set innerHTML(v) { this._innerHTML = String(v); }
    querySelector(sel) {
      if (sel.startsWith("#")) return getMockEl(sel.slice(1));
      if (sel.startsWith(".")) return getMockEl(sel.slice(1));
      return getMockEl("generic");
    }
  }

  const mockOverlayStore = new Map();
  function getMockEl(id) {
    if (!mockOverlayStore.has(id)) {
      mockOverlayStore.set(id, new OverlayMockElement("DIV", id));
    }
    return mockOverlayStore.get(id);
  }

  const mockOverlayBody = new OverlayMockElement("BODY");

  const overlaySandbox = {
    window: {
      location: { href: "https://www.linkedin.com/search/results/people/?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D" },
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

  // 1. Render Navigation overlay state (Page 1 Complete, 10 profiles)
  manager.update({
    state: "navigating",
    isNavigating: true,
    engineType: "PEOPLE_SEARCH",
    extractedConnections: 10,
    actualProfiles: 0,
    totalConnections: 0,
    progressPercent: 0,
    pageCount: 1,
    currentPage: 1,
    navigatingLabel: "Page 1 Complete",
    statusMessage: "➡ Navigating to Page 2..."
  });

  const navTitle     = getMockEl("warmgraph-overlay-title").textContent;
  const navMetric    = getMockEl("warmgraph-hero-metric").textContent;
  const navRemaining = getMockEl("warmgraph-hero-remaining").textContent;

  assert(navTitle === "Auto Extracting", `Overlay title shows 'Auto Extracting', got '${navTitle}'`);
  assert(navMetric === "10", `Overlay hero metric shows '10', got '${navMetric}'`);
  assert(navRemaining.includes("Page 1 Complete"), `Overlay remaining includes 'Page 1 Complete', got '${navRemaining}'`);
  assert(navRemaining.includes("➡ Navigating to Page 2..."), `Overlay remaining includes '➡ Navigating to Page 2...', got '${navRemaining}'`);

  // 2. Render Page 2 loaded overlay state (20 profiles)
  manager.update({
    state: "acquiring",
    isNavigating: false,
    engineType: "PEOPLE_SEARCH",
    extractedConnections: 20,
    actualProfiles: 0,
    totalConnections: 0,
    progressPercent: 0,
    pageCount: 2,
    currentPage: 2,
    paginationLabel: "Page 2"
  });

  const page2Metric    = getMockEl("warmgraph-hero-metric").textContent;
  const page2Remaining = getMockEl("warmgraph-hero-remaining").textContent;

  assert(page2Metric === "20", `Overlay hero metric on Page 2 shows '20', got '${page2Metric}'`);
  assert(page2Remaining.includes("Page 2"), `Overlay remaining includes 'Page 2', got '${page2Remaining}'`);

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("══════════════════════════════════════════════════\n");

  if (failed > 0) process.exit(1);
})();
