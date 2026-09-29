/**
 * TASK 13.6.0 — Dual Acquisition + Hover Enrichment (Production Workflow)
 * Acceptance Tests
 *
 * Run: node scratch/test_task_1360.js
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
console.log("  TASK 13.6.0 — Dual Acquisition + Hover Enrichment");
console.log("══════════════════════════════════════════════════\n");

const contentJsPath = path.join(__dirname, "..", "extension", "content.js");
const overlayJsPath = path.join(__dirname, "..", "extension", "overlay.js");

const contentCode = fs.readFileSync(contentJsPath, "utf8");
const overlayCode = fs.readFileSync(overlayJsPath, "utf8");

// ── Section 1: Code Audit for Phase A & Hover Enrichment ─────────────────────────
console.log("Section 1: Code Audit for Dual Acquisition & Hover Enrichment");

assert(
  contentCode.includes('engineType === "CONNECTIONS"') && contentCode.includes('connections_ready'),
  "content.js handles Phase A CONNECTIONS page initialization with state 'connections_ready'"
);

assert(
  contentCode.includes('education: education || null'),
  "HoverIntelligenceEngine extracts 'education' field from hover card"
);

assert(
  contentCode.includes("detectAndPersistOwnerIdentity"),
  "Phase A resolves owner identity on Connections page initialization"
);

// ── Section 2: Phase A — Connections Initialization ─────────────────────────────
console.log("\nSection 2: Testing Phase A (Connections Page Initialization)");

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
    if (sel.includes('education')) return this.getAttribute("data-field") === "education" || this.className.includes("education");
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
// Mock Connections header element with "486 Connections"
const connHeaderEl = new MockElement("H1");
connHeaderEl.textContent = "Connections (486)";
mockDoc.appendChild(connHeaderEl);

const contentSandbox = {
  MutationObserver: MockMutationObserver,
  window: {
    location: { href: "https://www.linkedin.com/mynetwork/invite-connect/connections/", pathname: "/mynetwork/invite-connect/connections/" },
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  document: {
    querySelector: (sel) => mockDoc.querySelector(sel) || connHeaderEl,
    querySelectorAll: () => [connHeaderEl],
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

const session = contentSandbox.window.acquisitionSession;

(async function runTests() {
// Run Phase A auto-start initialization on Connections page
await contentSandbox.maybeAutoStartAcquisition();
assert(session.state === "connections_ready", "Connections page initialization sets state to 'connections_ready'");
assert(session.totalConnections === 486, "Connections page reads total connection count '486' from DOM");

// ── Section 3: Overlay UI (Connections Page vs Filtered Search vs Completion) ────
console.log("\nSection 3: Testing Overlay UI States");

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
    location: { href: "https://www.linkedin.com/mynetwork/invite-connect/connections/" },
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

// 1. Render Connections Ready state
manager.update({
  state: "connections_ready",
  engineType: "CONNECTIONS",
  totalConnections: 486,
  extractedConnections: 0,
  actualProfiles: 486
});

const connTitle     = getMockEl("warmgraph-overlay-title").textContent;
const connMetric    = getMockEl("warmgraph-hero-metric").textContent;
const connRemaining = getMockEl("warmgraph-hero-remaining").textContent;

assert(connTitle === "Workspace Ready", `Connections page title shows 'Workspace Ready', got '${connTitle}'`);
assert(connMetric.includes("486 Total Connections"), `Connections page metric shows '486 Total Connections', got '${connMetric}'`);
assert(connRemaining === "Waiting for LinkedIn filters...", `Connections page remaining shows 'Waiting for LinkedIn filters...', got '${connRemaining}'`);

// 2. Render Filtered Search Active Extraction state (Page 14, 138 profiles)
manager.update({
  state: "collecting",
  engineType: "PEOPLE_SEARCH",
  extractedConnections: 138,
  actualProfiles: 0,
  totalConnections: 486,
  progressPercent: 0,
  pageCount: 14,
  currentPage: 14,
  paginationLabel: "Page 14"
});

const searchTitle     = getMockEl("warmgraph-overlay-title").textContent;
const searchMetric    = getMockEl("warmgraph-hero-metric").textContent;
const searchRemaining = getMockEl("warmgraph-hero-remaining").textContent;

assert(searchTitle === "Auto Extracting", `Filtered search title shows 'Auto Extracting', got '${searchTitle}'`);
assert(searchMetric === "138", `Filtered search metric shows extracted count '138', got '${searchMetric}'`);
assert(searchRemaining.includes("Page 14"), `Filtered search remaining includes 'Page 14', got '${searchRemaining}'`);
assert(searchRemaining.includes("Hover Enrichment Active"), `Filtered search remaining includes 'Hover Enrichment Active', got '${searchRemaining}'`);

// 3. Render Completion state (347 profiles indexed, 486 total)
manager.update({
  state: "completed",
  engineType: "PEOPLE_SEARCH",
  extractedConnections: 347,
  actualProfiles: 347,
  totalConnections: 486,
  progressPercent: 100,
  page_count: 35,
  currentPage: 35,
  paginationLabel: "Page 35 of 35"
});

const completedTitle     = getMockEl("warmgraph-overlay-title").textContent;
const completedMetric    = getMockEl("warmgraph-hero-metric").textContent;
const completedRemaining = getMockEl("warmgraph-hero-remaining").textContent;

assert(completedTitle === "Workspace Up To Date", `Completion title shows 'Workspace Up To Date', got '${completedTitle}'`);
assert(completedMetric.includes("347 Profiles Indexed"), `Completion metric shows '347 Profiles Indexed', got '${completedMetric}'`);
assert(completedRemaining.includes("486 Total Connections"), `Completion remaining includes '486 Total Connections', got '${completedRemaining}'`);
assert(completedRemaining.includes("Last Sync: Just now"), `Completion remaining includes 'Last Sync: Just now', got '${completedRemaining}'`);

// ── Section 4: Hover Card Education & Repository Merge Rules ────────────────────
console.log("\nSection 4: Hover Card Education & Fill-Missing-Only Merge Rules");

const HoverIntelligenceEngine = contentSandbox.window.HoverIntelligenceEngine;
const engine = new HoverIntelligenceEngine();

const hoverCardEl = new MockElement("DIV");
hoverCardEl.setAttribute("role", "dialog");
hoverCardEl.setAttribute("aria-label", "Jane Doe");

const profileAnchor = new MockElement("A");
profileAnchor.setAttribute("href", "https://www.linkedin.com/in/jane-doe-12345");
hoverCardEl.appendChild(profileAnchor);

const eduSpan = new MockElement("SPAN");
eduSpan.setAttribute("data-field", "education");
eduSpan.textContent = "Stanford University";
hoverCardEl.appendChild(eduSpan);

const extractedHoverData = engine._extractFromHoverCard(hoverCardEl);
assert(extractedHoverData !== null, "Extracts data object from hover card");
assert(extractedHoverData?.education === "Stanford University", `Extracts education 'Stanford University', got '${extractedHoverData?.education}'`);

// Test fill-missing-only merge
const existingRecord = {
  name: "Jane Doe",
  profile_url: "https://www.linkedin.com/in/jane-doe-12345",
  company: "Google",        // populated — MUST NOT be overwritten
  education: null            // empty — SHOULD be filled
};

const mergedRecord = contentSandbox.mergeRecord(extractedHoverData, existingRecord);
assert(mergedRecord.company === "Google", "Populated company field 'Google' is NOT overwritten");
assert(mergedRecord.education === "Stanford University", "Missing education field IS filled from hover data");

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════");
console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log("══════════════════════════════════════════════════\n");

if (failed > 0) process.exit(1);
})();
