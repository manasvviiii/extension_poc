/**
 * HOTFIX 13.5.9 — Remove Hardcoded 350 & Fix Identity Warning
 * Acceptance Tests
 *
 * Run: node scratch/test_task_1359.js
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
console.log("  HOTFIX 13.5.9 — Remove 350 & Fix Identity Warning");
console.log("══════════════════════════════════════════════════\n");

const contentJsPath = path.join(__dirname, "..", "extension", "content.js");
const overlayJsPath = path.join(__dirname, "..", "extension", "overlay.js");
const popupJsPath   = path.join(__dirname, "..", "extension", "popup.js");

const contentCode = fs.readFileSync(contentJsPath, "utf8");
const overlayCode = fs.readFileSync(overlayJsPath, "utf8");
const popupCode   = fs.readFileSync(popupJsPath, "utf8");

// ── Section 1: Audit overlay.js & content.js for 350 removal in display ─────────
console.log("Section 1: Code Audit for 350 Removal");

assert(
  !overlayCode.includes("`350`") && !overlayCode.includes("'/350'"),
  "overlay.js has no hardcoded '/350' string literals"
);

assert(
  contentCode.includes('currentEngineType === "PEOPLE_SEARCH"'),
  "content.js checks currentEngineType === 'PEOPLE_SEARCH' during session initialization"
);

assert(
  contentCode.includes('this.actualProfiles = 0;') && contentCode.includes('this.totalConnections = 0;'),
  "content.js initializes totalConnections & actualProfiles to 0 for PEOPLE_SEARCH"
);

// ── Section 2: Test overlay.js rendering for PEOPLE_SEARCH active extraction ────
console.log("\nSection 2: Testing Overlay UI (PEOPLE_SEARCH Active Extraction)");

class MockElement {
  constructor(tagName = "DIV", id = "") {
    this.tagName = tagName;
    this.id = id;
    this.className = "";
    this._textContent = "";
    this._innerHTML = "";
    this.style = {};
    this.children = [];
    this.parentElement = null;
  }
  get textContent() { return this._textContent; }
  set textContent(val) { this._textContent = String(val); }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(val) {
    this._innerHTML = String(val);
    // Simple parser to instantiate child elements with id and className from html
    const matches = String(val).matchAll(/<([a-z0-9]+)([^>]*)>/gi);
    for (const match of matches) {
      const tag = match[1];
      const attrs = match[2];
      const idMatch = attrs.match(/id=["']([^"']+)["']/i);
      const classMatch = attrs.match(/class=["']([^"']+)["']/i);
      const child = new MockElement(tag.toUpperCase(), idMatch ? idMatch[1] : "");
      if (classMatch) child.className = classMatch[1];
      child.parentElement = this;
      this.children.push(child);
    }
  }

  querySelector(sel) {
    if (sel.startsWith("#")) {
      const targetId = sel.slice(1);
      return this.findElement(el => el.id === targetId);
    }
    if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      return this.findElement(el => el.className && el.className.includes(cls));
    }
    return this.findElement(el => el.tagName === sel.toUpperCase());
  }

  querySelectorAll(sel) {
    const results = [];
    this.findAllElements(sel, results);
    return results;
  }

  findElement(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child.findElement(predicate);
      if (found) return found;
    }
    return null;
  }

  findAllElements(sel, results) {
    for (const child of this.children) {
      if (sel.startsWith(".") && child.className && child.className.includes(sel.slice(1))) {
        results.push(child);
      }
      child.findAllElements(sel, results);
    }
  }

  addEventListener() {}
  removeEventListener() {}
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  setAttribute() {}
  getAttribute() { return null; }
  hasAttribute() { return false; }
}

const mockBody = new MockElement("BODY");

const overlaySandbox = {
  window: {
    location: { href: "https://www.linkedin.com/search/results/people/?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D" },
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  document: {
    getElementById: (id) => mockBody.querySelector("#" + id),
    createElement: (tag) => new MockElement(tag),
    head: new MockElement("HEAD"),
    body: mockBody,
    querySelector: (sel) => mockBody.querySelector(sel),
    querySelectorAll: (sel) => mockBody.querySelectorAll(sel),
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

// Active Extraction status status object
manager.update({
  state: "acquiring",
  engineType: "PEOPLE_SEARCH",
  extractedConnections: 138,
  actualProfiles: 0,
  totalConnections: 0,
  progressPercent: 0,
  pageCount: 14,
  currentPage: 14,
  paginationLabel: "Page 14"
});

const heroMetricText  = mockBody.querySelector("#warmgraph-hero-metric")?.textContent;
const pillCountText   = mockBody.querySelector("#warmgraph-pill-count")?.textContent;
const heroPercentText = mockBody.querySelector("#warmgraph-hero-percent")?.textContent;

assert(heroMetricText === "138", `Hero metric shows extracted count only ('138'), got '${heroMetricText}'`);
assert(heroMetricText && !heroMetricText.includes("/"), "Hero metric does NOT contain a denominator '/'");
assert(heroMetricText && !heroMetricText.includes("350"), "Hero metric does NOT contain '350'");
assert(pillCountText === "138", `Minimized pill count shows count only ('138'), got '${pillCountText}'`);
assert(heroPercentText === "138", `Ring center displays count ('138') during indeterminate active search, got '${heroPercentText}'`);

// ── Section 3: Test overlay.js rendering for PEOPLE_SEARCH Completion ───────────
console.log("\nSection 3: Testing Overlay UI (PEOPLE_SEARCH Completion)");

manager.update({
  state: "completed",
  engineType: "PEOPLE_SEARCH",
  extractedConnections: 347,
  actualProfiles: 347,
  totalConnections: 347,
  progressPercent: 100,
  page_count: 35,
  currentPage: 35,
  paginationLabel: "Page 35 of 35"
});

const completedHeroMetric    = mockBody.querySelector("#warmgraph-hero-metric")?.textContent;
const completedHeroRemaining = mockBody.querySelector("#warmgraph-hero-remaining")?.textContent;
const completedTitle         = mockBody.querySelector("#warmgraph-overlay-title")?.textContent;

assert(completedHeroMetric === "347 Total", `Hero metric on completion shows '347 Total', got '${completedHeroMetric}'`);
assert(completedHeroRemaining && completedHeroRemaining.includes("35 Pages Processed"), `Hero remaining shows '35 Pages Processed', got '${completedHeroRemaining}'`);
assert(completedHeroRemaining && completedHeroRemaining.includes("Last Sync: Just now"), `Hero remaining includes 'Last Sync: Just now', got '${completedHeroRemaining}'`);
assert(completedTitle === "Workspace Up To Date", `Overlay title shows 'Workspace Up To Date', got '${completedTitle}'`);

// ── Section 4: Identity Warning Suppression in popup.js ─────────────────────────
console.log("\nSection 4: Testing Identity Warning Suppression (popup.js)");

assert(
  popupCode.includes("shouldSuppressIdentityWarning"),
  "popup.js defines shouldSuppressIdentityWarning helper"
);

assert(
  popupCode.includes('engineType === "PEOPLE_SEARCH"') || popupCode.includes('engineType === "CONNECTIONS"'),
  "popup.js suppresses identity warning for PEOPLE_SEARCH and CONNECTIONS engines"
);

assert(
  popupCode.includes("isOnExtractionPage"),
  "popup.js checks whether open LinkedIn tabs are on approved extraction pages"
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════");
console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log("══════════════════════════════════════════════════\n");

if (failed > 0) process.exit(1);
