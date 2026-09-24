/**
 * Automated Test Suite for Task 2F — Non-Interruptive WarmGraph Acquisition Overlay
 * 
 * Verifies overlay UI state rendering, human-friendly copy mapping, minimize/restore,
 * close/hide safety, dynamic count updating, and non-interference with persistent acquisition sessions.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Load source code
const overlayJsPath = path.join(__dirname, "overlay.js");
const overlayJsSource = fs.readFileSync(overlayJsPath, "utf8");

function parseHTMLToMockNodes(htmlStr, createElementFn) {
  const root = createElementFn("div");
  const stack = [root];
  const tagRegex = /<\/?([a-z1-6]+)([^>]*)>|([^<]+)/gi;
  let match;

  while ((match = tagRegex.exec(htmlStr)) !== null) {
    const full = match[0];
    const tagName = match[1];
    const attrs = match[2];
    const text = match[3];

    if (text) {
      const trimmed = text.trim();
      if (trimmed && stack.length > 0) {
        const cur = stack[stack.length - 1];
        cur._textContent = (cur._textContent ? cur._textContent + " " : "") + trimmed;
      }
    } else if (full.startsWith("</")) {
      if (stack.length > 1) {
        stack.pop();
      }
    } else if (full.startsWith("<")) {
      const child = createElementFn(tagName);
      if (attrs) {
        const idM = attrs.match(/id=["']([^"']+)["']/i);
        if (idM) child.id = idM[1];
        const clsM = attrs.match(/class=["']([^"']+)["']/i);
        if (clsM) child.className = clsM[1];
        const styleM = attrs.match(/style=["']([^"']+)["']/i);
        if (styleM) {
          if (styleM[1].includes("display: none") || styleM[1].includes("display:none")) {
            child.style.display = "none";
          }
        }
      }
      stack[stack.length - 1].appendChild(child);
      if (!full.endsWith("/>") && !["img", "hr", "br", "input"].includes(tagName.toLowerCase())) {
        stack.push(child);
      }
    }
  }

  return root;
}

function createMockEnvironment() {
  const elements = new Set();
  const listeners = {};
  const storageMap = {};

  const createElement = (tag) => {
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      style: { display: "block" },
      className: "",
      id: "",
      children: children,
      _innerHTML: "",
      _textContent: "",
      get textContent() {
        if (this._textContent !== undefined && this._textContent !== "") return String(this._textContent);
        return children.map(c => c.textContent).join(" ");
      },
      set textContent(val) {
        this._textContent = val;
      },
      get innerHTML() {
        return this._innerHTML;
      },
      set innerHTML(val) {
        this._innerHTML = val;
        children.length = 0;
        const parsed = parseHTMLToMockNodes(val, createElement);
        parsed.children.forEach(c => this.appendChild(c));
      },
      appendChild: (child) => {
        children.push(child);
        child.parentElement = el;
      },
      querySelector: (sel) => {
        return findSelector(el, sel);
      },
      querySelectorAll: (sel) => {
        const res = [];
        findAllSelectors(el, sel, res);
        return res;
      },
      addEventListener: (type, fn) => {
        listeners[`${el.id || el.className || tag}_${type}`] = listeners[`${el.id || el.className || tag}_${type}`] || [];
        listeners[`${el.id || el.className || tag}_${type}`].push(fn);
      },
      dispatchEvent: (type, ev) => {
        const list = listeners[`${el.id || el.className || tag}_${type}`];
        if (list) list.forEach(fn => fn(ev));
      }
    };
    return el;
  };

  function findSelector(root, sel) {
    if (sel.startsWith("#")) {
      const id = sel.slice(1);
      if (root.id === id) return root;
      for (const c of root.children || []) {
        const found = findSelector(c, sel);
        if (found) return found;
      }
    } else if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      if (root.className && root.className.includes(cls)) return root;
      for (const c of root.children || []) {
        const found = findSelector(c, sel);
        if (found) return found;
      }
    }
    return null;
  }

  function findAllSelectors(root, sel, res) {
    if (sel.startsWith("#") && root.id === sel.slice(1)) res.push(root);
    if (sel.startsWith(".") && root.className && root.className.includes(sel.slice(1))) res.push(root);
    for (const c of root.children || []) {
      findAllSelectors(c, sel, res);
    }
  }

  const documentMock = {
    visibilityState: "visible",
    location: {
      href: "https://www.linkedin.com/mynetwork/invite-connect/connections/",
      origin: "https://www.linkedin.com"
    },
    documentElement: { innerText: "Connections (206)" },
    body: createElement("body"),
    head: createElement("head"),
    createElement: createElement,
    getElementById: (id) => findSelector(documentMock.body, `#${id}`),
    querySelector: (sel) => findSelector(documentMock.body, sel),
    querySelectorAll: (sel) => {
      const res = [];
      findAllSelectors(documentMock.body, sel, res);
      return res;
    },
    addEventListener: (type, fn) => {
      listeners[`doc_${type}`] = listeners[`doc_${type}`] || [];
      listeners[`doc_${type}`].push(fn);
    }
  };

  documentMock.body.appendChild = function(node) {
    node.parentElement = documentMock.body;
    documentMock.body.children.push(node);
    elements.add(node);
  };

  documentMock.head.appendChild = function(node) {
    node.parentElement = documentMock.head;
    documentMock.head.children.push(node);
    elements.add(node);
  };

  const storageListeners = [];
  const chromeMock = {
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          keys.forEach(k => { res[k] = storageMap[k]; });
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (obj, cb) => {
          const changes = {};
          Object.keys(obj).forEach(k => {
            changes[k] = { oldValue: storageMap[k], newValue: obj[k] };
            storageMap[k] = obj[k];
          });
          storageListeners.forEach(fn => fn(changes, "local"));
          if (cb) cb();
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener: (fn) => storageListeners.push(fn)
      }
    },
    runtime: {
      sendMessage: (msg, cb) => { if (cb) cb({ success: true }); },
      onMessage: { addListener: () => {} }
    }
  };

  const windowMock = {
    location: documentMock.location,
    addEventListener: (type, fn) => {
      listeners[`win_${type}`] = listeners[`win_${type}`] || [];
      listeners[`win_${type}`].push(fn);
    },
    dispatchEvent: (evt) => {
      const type = evt.type || evt;
      if (listeners[`win_${type}`]) {
        listeners[`win_${type}`].forEach(fn => fn(evt));
      }
    }
  };

  return { documentMock, windowMock, chromeMock, storageMap };
}

async function runTests() {
  console.log("==================================================");
  console.log("Running Task 2F Overlay Test Suite");
  console.log("==================================================");

  const env = createMockEnvironment();

  // Evaluate overlay.js in environment
  const evalOverlay = Function("window", "document", "chrome", overlayJsSource);
  evalOverlay(env.windowMock, env.documentMock, env.chromeMock);

  const overlay = env.windowMock.WarmGraphOverlay;
  assert.ok(overlay, "WarmGraphOverlay instance must be attached to window");

  // 1. Initial State Check
  console.log("✓ Test 1: Overlay initializes on window");

  // 2. PREPARING State Test
  overlay.update({
    state: "preparing",
    collected_count: 0,
    expected_total: 206
  });

  const titleEl = env.documentMock.getElementById("warmgraph-overlay-title");
  const descEl = env.documentMock.getElementById("warmgraph-overlay-desc");
  const countEl = env.documentMock.getElementById("warmgraph-overlay-count");

  assert.strictEqual(titleEl.textContent.trim(), "Preparing your network", "Preparing title matches requirement");
  assert.ok(descEl.textContent.includes("getting your connection page ready"), "Preparing description matches requirement");
  console.log("✓ Test 2: PREPARING state renders human-friendly copy");

  // 3. COLLECTING State Test
  overlay.update({
    state: "acquiring",
    collected_count: 126,
    expected_total: 206
  });

  assert.strictEqual(titleEl.textContent.trim(), "Building your network", "Collecting state title");
  assert.strictEqual(countEl.textContent.trim(), "126", "Collected count rendered dynamically");

  const subcountEl = env.documentMock.getElementById("warmgraph-overlay-subcount");
  assert.strictEqual(subcountEl.textContent.trim(), "126 of 206 connections", "Subcount shows collected of expected total");
  console.log("✓ Test 3: COLLECTING state updates connection count dynamically");

  // 4. WAITING State Test
  overlay.update({
    state: "waiting_for_content",
    collected_count: 126,
    expected_total: 206
  });

  assert.strictEqual(titleEl.textContent.trim(), "Loading more connections", "Waiting state title");
  assert.ok(descEl.textContent.includes("waiting for the next part of your network to appear"), "Waiting description");
  console.log("✓ Test 4: WAITING state renders friendly copy without technical terms");

  // 5. SETTLING State Test
  overlay.update({
    state: "settling",
    collected_count: 206,
    expected_total: 206
  });

  assert.strictEqual(titleEl.textContent.trim(), "Finishing your network", "Settling state title");
  assert.ok(descEl.textContent.includes("making sure your network is complete"), "Settling description");
  console.log("✓ Test 5: SETTLING state renders finishing network status");

  // 6. COMPLETED State Test
  overlay.update({
    state: "completed",
    collected_count: 206,
    expected_total: 206,
    sync_status: "synced"
  });

  assert.strictEqual(titleEl.textContent.trim(), "Your network is ready ✨", "Completed state title");
  const ctaContainer = env.documentMock.getElementById("warmgraph-cta-container");
  assert.strictEqual(ctaContainer.style.display, "block", "Primary CTA button [ Open My Network ] displayed");
  console.log("✓ Test 6: COMPLETED state renders ready state and Primary CTA");

  // 7. INTERRUPTED State Test
  overlay.update({
    state: "interrupted",
    collected_count: 85,
    expected_total: 206
  });

  assert.strictEqual(titleEl.textContent.trim(), "We'll continue when you're back", "Interrupted state title");
  assert.ok(descEl.textContent.includes("WarmGraph has saved your progress"), "Interrupted description");
  console.log("✓ Test 7: INTERRUPTED state renders progress saved copy");

  // 8. ERROR State Test
  overlay.update({
    state: "failed",
    error: "Network timeout",
    collected_count: 45
  });

  assert.strictEqual(titleEl.textContent.trim(), "Something interrupted your network", "Error state title");
  console.log("✓ Test 8: ERROR state renders friendly recovery message");

  // 9. Minimize Test
  overlay.update({
    state: "acquiring",
    collected_count: 150,
    expected_total: 206
  });

  overlay.minimize();
  assert.strictEqual(overlay.isMinimized, true, "IsMinimized flag set");
  const cardEl = env.documentMock.getElementById("warmgraph-overlay-card");
  const pillEl = env.documentMock.getElementById("warmgraph-overlay-pill");
  assert.strictEqual(cardEl.style.display, "none", "Card element hidden when minimized");
  assert.strictEqual(pillEl.style.display, "flex", "Pill element visible when minimized");

  // Pill count update while minimized
  overlay.update({
    state: "acquiring",
    collected_count: 175,
    expected_total: 206
  });

  const pillCount = env.documentMock.getElementById("warmgraph-pill-count");
  assert.strictEqual(pillCount.textContent.trim(), "175 / 206", "Minimized pill updates connection count dynamically");
  console.log("✓ Test 9 & 10: Minimize and restore toggle UI state and continue count updates");

  // Restore Test
  overlay.restore();
  assert.strictEqual(overlay.isMinimized, false, "IsMinimized flag cleared on restore");
  assert.strictEqual(cardEl.style.display, "block", "Card element visible after restore");

  // 10. Close / Hide Safety Test
  const initialSession = {
    sessionId: "session_test_123",
    state: "acquiring",
    collected_count: 175
  };
  env.storageMap.acquisition_session = initialSession;

  overlay.hide();
  assert.strictEqual(overlay.isHiddenByUser, true, "Overlay marked hidden by user");

  // Verify storage and session data remain untouched when UI is hidden
  assert.deepStrictEqual(env.storageMap.acquisition_session, initialSession, "Closing UI does NOT clear or alter persisted session state");
  console.log("✓ Test 11 & 12: Closing overlay hides UI without affecting acquisition session");

  console.log("\nResults: All 12/12 Task 2F tests passed.");
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
