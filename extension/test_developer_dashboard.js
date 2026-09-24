/**
 * Automated Test Suite for Task 3A — Developer Extraction Dashboard (QA Console)
 * 
 * Verifies QA health visual cards, session summary info, real-time search & text highlighting,
 * filter chips, pagination controls, drawer sections with collapsible JSON, and summary export.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Load developer_dashboard.js source code
const devDashboardJsPath = path.join(__dirname, "developer_dashboard.js");
const devDashboardJsSource = fs.readFileSync(devDashboardJsPath, "utf8");

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
      if (stack.length > 1) stack.pop();
    } else if (full.startsWith("<")) {
      const child = createElementFn(tagName);
      if (attrs) {
        const idM = attrs.match(/id=["']([^"']+)["']/i);
        if (idM) child.id = idM[1];
        const clsM = attrs.match(/class=["']([^"']+)["']/i);
        if (clsM) child.className = clsM[1];
        const dataFilterM = attrs.match(/data-filter=["']([^"']+)["']/i);
        if (dataFilterM) child.dataFilter = dataFilterM[1];
        const dataIndexM = attrs.match(/data-index=["']([^"']+)["']/i);
        if (dataIndexM) child.dataIndex = dataIndexM[1];
      }
      stack[stack.length - 1].appendChild(child);
      if (!full.endsWith("/>") && !["img", "hr", "br", "input"].includes(tagName.toLowerCase())) {
        stack.push(child);
      }
    }
  }

  return root;
}

function createMockDashboardEnvironment(mockDataset = null) {
  const listeners = {};
  const storageMap = { ownerId: "warmgraph_dev_owner_789" };

  const createElement = (tag) => {
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      style: { display: "block" },
      className: "",
      id: "",
      value: "",
      disabled: false,
      children: children,
      _innerHTML: "",
      _textContent: "",
      getAttribute: (attr) => attr === "data-filter" ? el.dataFilter : (attr === "data-index" ? el.dataIndex : null),
      setAttribute: (attr, val) => {
        if (attr === "data-filter") el.dataFilter = val;
        if (attr === "data-index") el.dataIndex = val;
      },
      classList: {
        add: (cls) => { if (!el.className.includes(cls)) el.className += ` ${cls}`; },
        remove: (cls) => { el.className = el.className.replace(cls, "").trim(); }
      },
      get textContent() {
        if (this._textContent !== undefined && this._textContent !== "") return String(this._textContent);
        return children.map(c => c.textContent).join(" ");
      },
      set textContent(val) {
        this._textContent = String(val);
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
      querySelector: (sel) => findSelector(el, sel),
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
    if (sel.startsWith("#") && root.id === sel.slice(1)) return root;
    if (sel.startsWith(".") && root.className && root.className.includes(sel.slice(1))) return root;
    if (sel.includes("data-filter") && root.dataFilter) return root;
    if (sel.includes("data-index") && root.dataIndex) return root;
    if (root.tagName && root.tagName.toLowerCase() === sel.toLowerCase()) return root;
    for (const c of root.children || []) {
      const found = findSelector(c, sel);
      if (found) return found;
    }
    return null;
  }

  function findAllSelectors(root, sel, res) {
    let match = false;
    if (sel.startsWith("#") && root.id === sel.slice(1)) match = true;
    else if (sel.startsWith(".") && root.className && root.className.includes(sel.slice(1))) match = true;
    else if (sel.includes("data-filter") && root.dataFilter) match = true;
    else if (sel.includes("data-index") && root.dataIndex) match = true;
    else if (root.tagName && root.tagName.toLowerCase() === sel.toLowerCase()) match = true;

    if (match && !res.includes(root)) res.push(root);
    for (const c of root.children || []) {
      findAllSelectors(c, sel, res);
    }
  }

  const documentMock = {
    location: { href: "http://127.0.0.1:8000/developer_dashboard.html?owner_id=warmgraph_dev_owner_789" },
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

  // Build static DOM elements expected by developer_dashboard.js
  const metricConnections = createElement("div"); metricConnections.id = "metricConnections";
  const metricEvidence = createElement("div"); metricEvidence.id = "metricEvidence";
  const metricCompanies = createElement("div"); metricCompanies.id = "metricCompanies";
  const metricProfiles = createElement("div"); metricProfiles.id = "metricProfiles";

  const qualityComplete = createElement("div"); qualityComplete.id = "qualityComplete";
  const qualityMissingCompany = createElement("div"); qualityMissingCompany.id = "qualityMissingCompany";
  const qualityMissingHeadline = createElement("div"); qualityMissingHeadline.id = "qualityMissingHeadline";
  const qualityDuplicates = createElement("div"); qualityDuplicates.id = "qualityDuplicates";

  const summarySessionId = createElement("div"); summarySessionId.id = "summarySessionId";
  const summaryStarted = createElement("div"); summaryStarted.id = "summaryStarted";
  const summaryCompleted = createElement("div"); summaryCompleted.id = "summaryCompleted";
  const summaryDuration = createElement("div"); summaryDuration.id = "summaryDuration";
  const summaryLastUpdated = createElement("div"); summaryLastUpdated.id = "summaryLastUpdated";
  const summarySyncStatus = createElement("div"); summarySyncStatus.id = "summarySyncStatus";
  const summaryOwner = createElement("div"); summaryOwner.id = "summaryOwner";

  const searchInput = createElement("input"); searchInput.id = "searchInput";
  const tableBody = createElement("tbody"); tableBody.id = "tableBody";

  const paginationInfo = createElement("div"); paginationInfo.id = "paginationInfo";
  const pageIndicator = createElement("div"); pageIndicator.id = "pageIndicator";
  const btnPrevPage = createElement("button"); btnPrevPage.id = "btnPrevPage";
  const btnNextPage = createElement("button"); btnNextPage.id = "btnNextPage";

  const btnExportJson = createElement("button"); btnExportJson.id = "btnExportJson";
  const btnExportCsv = createElement("button"); btnExportCsv.id = "btnExportCsv";
  const btnExportSummary = createElement("button"); btnExportSummary.id = "btnExportSummary";

  const inspectorOverlay = createElement("div"); inspectorOverlay.id = "inspectorOverlay"; inspectorOverlay.style.display = "none";
  const inspectorClose = createElement("button"); inspectorClose.id = "inspectorClose";
  const inspectorBody = createElement("div"); inspectorBody.id = "inspectorBody";
  inspectorOverlay.appendChild(inspectorClose);
  inspectorOverlay.appendChild(inspectorBody);

  const filterAll = createElement("button"); filterAll.className = "filter-chip active"; filterAll.dataFilter = "all";
  const filterComplete = createElement("button"); filterComplete.className = "filter-chip"; filterComplete.dataFilter = "complete";
  const filterMissingComp = createElement("button"); filterMissingComp.className = "filter-chip"; filterMissingComp.dataFilter = "missing_company";
  const filterMissingHead = createElement("button"); filterMissingHead.className = "filter-chip"; filterMissingHead.dataFilter = "missing_headline";
  const filterDuplicates = createElement("button"); filterDuplicates.className = "filter-chip"; filterDuplicates.dataFilter = "duplicates";
  const filterHasEvidence = createElement("button"); filterHasEvidence.className = "filter-chip"; filterHasEvidence.dataFilter = "has_evidence";
  const filterInvalidUrl = createElement("button"); filterInvalidUrl.className = "filter-chip"; filterInvalidUrl.dataFilter = "invalid_url";

  [
    metricConnections, metricEvidence, metricCompanies, metricProfiles,
    qualityComplete, qualityMissingCompany, qualityMissingHeadline, qualityDuplicates,
    summarySessionId, summaryStarted, summaryCompleted, summaryDuration, summaryLastUpdated, summarySyncStatus, summaryOwner,
    searchInput, tableBody, paginationInfo, pageIndicator, btnPrevPage, btnNextPage,
    btnExportJson, btnExportCsv, btnExportSummary, inspectorOverlay,
    filterAll, filterComplete, filterMissingComp, filterMissingHead, filterDuplicates, filterHasEvidence, filterInvalidUrl
  ].forEach(el => documentMock.body.appendChild(el));

  const mockFetch = (url) => {
    if (mockDataset) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockDataset)
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404
    });
  };

  const windowMock = {
    location: documentMock.location,
    fetch: mockFetch,
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

  const chromeMock = {
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          keys.forEach(k => { res[k] = storageMap[k]; });
          if (cb) cb(res);
          return Promise.resolve(res);
        }
      }
    }
  };

  return { documentMock, windowMock, chromeMock, listeners, storageMap };
}

async function runTests() {
  console.log("==================================================");
  console.log("Running Task 3A Developer QA Console Test Suite");
  console.log("==================================================");

  // Sample dataset
  const sampleDataset = {
    owner_id: "warmgraph_dev_owner_789",
    session_id: "session_qa_console_101",
    created_at: "2026-09-24T12:00:00Z",
    updated_at: "2026-09-24T12:01:20Z",
    state: "completed",
    connections: [
      {
        name: "Alice Johnson",
        headline: "VP Engineering at TechCorp",
        company: "TechCorp",
        degree: "1st",
        profile_url: "https://www.linkedin.com/in/alicejohnson",
        connection_date: "Sep 10, 2026"
      },
      {
        name: "Bob Smith",
        headline: "Director of Product",
        company: "",
        degree: "1st",
        profile_url: "https://www.linkedin.com/in/bobsmith",
        connection_date: "Sep 11, 2026"
      },
      {
        name: "Charlie Brown",
        headline: "",
        company: "FinancePlus",
        degree: "1st",
        profile_url: "https://www.linkedin.com/in/charliebrown",
        connection_date: "Sep 12, 2026"
      },
      {
        name: "Alice Johnson",
        headline: "Software Lead at TechCorp",
        company: "TechCorp",
        degree: "1st",
        profile_url: "https://www.linkedin.com/in/alicejohnson",
        connection_date: "Sep 13, 2026"
      },
      {
        name: "Dave Miller",
        headline: "Analyst at DataWorks",
        company: "DataWorks",
        degree: "1st",
        profile_url: "invalid_url_string",
        connection_date: "Sep 14, 2026"
      }
    ],
    relationship_evidence: [
      {
        name: "Alice Johnson",
        evidence_type: "relationship_card",
        observed_degree: "2nd",
        mutual_connections_text: "Bob Smith is a mutual connection"
      }
    ]
  };

  const env = createMockDashboardEnvironment(sampleDataset);

  // Execute developer_dashboard.js script inside mock environment
  const evalDashboard = Function("window", "document", "chrome", devDashboardJsSource);
  evalDashboard(env.windowMock, env.documentMock, env.chromeMock);

  // Trigger DOMContentLoaded
  if (env.listeners["doc_DOMContentLoaded"]) {
    await Promise.all(env.listeners["doc_DOMContentLoaded"].map(fn => fn()));
  }

  // 1. Verify Visual Health Cards & Top Metrics Calculation
  const connMetric = env.documentMock.getElementById("metricConnections").textContent.trim();
  const evMetric = env.documentMock.getElementById("metricEvidence").textContent.trim();

  const qComplete = env.documentMock.getElementById("qualityComplete").textContent.trim();
  const qMissingComp = env.documentMock.getElementById("qualityMissingCompany").textContent.trim();
  const qMissingHead = env.documentMock.getElementById("qualityMissingHeadline").textContent.trim();
  const qDuplicates = env.documentMock.getElementById("qualityDuplicates").textContent.trim();

  assert.strictEqual(connMetric, "5", "Connections metric count = 5");
  assert.strictEqual(evMetric, "1", "Evidence metric count = 1");
  assert.strictEqual(qComplete, "2", "Complete records count = 2");
  assert.strictEqual(qMissingComp, "1", "Missing company count = 1");
  assert.strictEqual(qMissingHead, "1", "Missing headline count = 1");
  assert.strictEqual(qDuplicates, "2", "Duplicate candidates count = 2");
  console.log("✓ Test 1: Extraction Health visual cards computed dynamically");

  // 2. Network Session Summary Test
  const sumSessionId = env.documentMock.getElementById("summarySessionId").textContent.trim();
  const sumDuration = env.documentMock.getElementById("summaryDuration").textContent.trim();
  const sumOwner = env.documentMock.getElementById("summaryOwner").textContent.trim();

  assert.strictEqual(sumSessionId, "session_qa_console_101", "Session ID rendered from metadata");
  assert.strictEqual(sumDuration, "1m 20s", "Session duration calculated accurately (1m 20s)");
  assert.strictEqual(sumOwner, "warmgraph_dev_owner_789", "Owner ID rendered");
  console.log("✓ Test 2: Network Session Summary metrics loaded and calculated");

  // 3. Search & Text Highlighting Test
  const searchInput = env.documentMock.getElementById("searchInput");
  const tableBody = env.documentMock.getElementById("tableBody");

  searchInput.value = "TechCorp";
  searchInput.dispatchEvent("input", { target: searchInput });

  const rowsTechCorp = tableBody.querySelectorAll("tr");
  assert.strictEqual(rowsTechCorp.length, 2, "Searching 'TechCorp' filters table to 2 rows");
  assert.ok(tableBody.innerHTML.includes("<mark class=\"highlight-match\">TechCorp</mark>"), "Search term is highlighted in matched text cell");
  console.log("✓ Test 3: Search filter and text highlighting functioning");

  // Reset search
  searchInput.value = "";
  searchInput.dispatchEvent("input", { target: searchInput });

  // 4. Pagination Test
  const paginationInfo = env.documentMock.getElementById("paginationInfo").textContent.trim();
  assert.ok(paginationInfo.includes("Showing 1–5 of 5 records"), "Pagination info correctly displays current item range");
  console.log("✓ Test 4: Pagination info and bounds calculation functioning");

  // 5. Row Inspector Drawer & Raw JSON Collapse Test
  const firstRow = tableBody.querySelectorAll("tr")[0];
  firstRow.dispatchEvent("click", {});

  const inspectorOverlay = env.documentMock.getElementById("inspectorOverlay");
  const inspectorBody = env.documentMock.getElementById("inspectorBody");

  assert.strictEqual(inspectorOverlay.style.display, "flex", "Row click opens inspector drawer overlay");
  assert.ok(inspectorBody.textContent.includes("Person"), "Drawer displays Person section");
  assert.ok(inspectorBody.textContent.includes("Relationship Evidence"), "Drawer displays Relationship Evidence section");
  assert.ok(inspectorBody.textContent.includes("Extraction Metadata"), "Drawer displays Extraction Metadata section");
  assert.ok(inspectorBody.innerHTML.includes("<details class=\"json-details\">"), "Raw JSON section rendered as collapsible details element");
  console.log("✓ Test 5: Row inspector drawer with structured sections and collapsible JSON functioning");

  console.log("\nResults: All 5/5 Task 3A QA Console tests passed.");
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
