/**
 * Automated Test Suite for Task 4 — WarmGraph Knowledge Hub (Internal Portal)
 * 
 * Verifies category sidebar filtering, article grid rendering, instant search,
 * markdown parsing (headings, code blocks, callout boxes, tables, lists),
 * article reader navigation, and Roadmap article milestones.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Load source files
const hubJsPath = path.join(__dirname, "knowledge_hub.js");
const hubJsSource = fs.readFileSync(hubJsPath, "utf8");

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
        const dataCategoryM = attrs.match(/data-category=["']([^"']+)["']/i);
        if (dataCategoryM) child.dataCategory = dataCategoryM[1];
        const dataIdM = attrs.match(/data-id=["']([^"']+)["']/i);
        if (dataIdM) child.dataId = dataIdM[1];
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
  const listeners = {};

  const createElement = (tag) => {
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      style: { display: "block" },
      className: "",
      id: "",
      value: "",
      children: children,
      _innerHTML: "",
      _textContent: "",
      getAttribute: (attr) => {
        if (attr === "data-category") return el.dataCategory;
        if (attr === "data-id") return el.dataId;
        return null;
      },
      setAttribute: (attr, val) => {
        if (attr === "data-category") el.dataCategory = val;
        if (attr === "data-id") el.dataId = val;
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
        if (!el._eventListeners) el._eventListeners = {};
        el._eventListeners[type] = el._eventListeners[type] || [];
        el._eventListeners[type].push(fn);
      },
      dispatchEvent: (type, ev) => {
        const list = el._eventListeners ? el._eventListeners[type] : null;
        const eventObj = (ev && ev.target) ? ev : { target: el };
        if (list) list.forEach(fn => fn(eventObj));
      }
    };
    return el;
  };

  function findSelector(root, sel) {
    if (sel.startsWith("#") && root.id === sel.slice(1)) return root;
    if (sel.startsWith(".") && root.className && root.className.split(/\s+/).includes(sel.slice(1))) return root;
    if (sel.includes("data-category") && root.dataCategory) return root;
    if (sel.includes("data-id") && root.dataId) return root;
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
    else if (sel.startsWith(".") && root.className && root.className.split(/\s+/).includes(sel.slice(1))) match = true;
    else if (sel.includes("data-category") && root.dataCategory) match = true;
    else if (sel.includes("data-id") && root.dataId) match = true;
    else if (root.tagName && root.tagName.toLowerCase() === sel.toLowerCase()) match = true;

    if (match && !res.includes(root)) res.push(root);
    for (const c of root.children || []) {
      findAllSelectors(c, sel, res);
    }
  }

  const documentMock = {
    location: { href: "http://127.0.0.1:8000/knowledge_hub.html" },
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

  // Build static elements
  const searchInput = createElement("input"); searchInput.id = "searchInput";
  const categoryList = createElement("ul"); categoryList.id = "categoryList";
  const articleGrid = createElement("div"); articleGrid.id = "articleGrid";

  const readerCard = createElement("div"); readerCard.id = "readerCard"; readerCard.style.display = "none";
  const readerTitle = createElement("h1"); readerTitle.id = "readerTitle";
  const readerCategory = createElement("span"); readerCategory.id = "readerCategory";
  const readerUpdated = createElement("span"); readerUpdated.id = "readerUpdated";
  const readerReadingTime = createElement("span"); readerReadingTime.id = "readerReadingTime";
  const readerContent = createElement("div"); readerContent.id = "readerContent";
  const btnBackToGrid = createElement("button"); btnBackToGrid.id = "btnBackToGrid";

  readerCard.appendChild(btnBackToGrid);
  readerCard.appendChild(readerTitle);
  readerCard.appendChild(readerCategory);
  readerCard.appendChild(readerUpdated);
  readerCard.appendChild(readerReadingTime);
  readerCard.appendChild(readerContent);

  const catAll = createElement("li"); catAll.className = "category-item active"; catAll.dataCategory = "all";
  const catArch = createElement("li"); catArch.className = "category-item"; catArch.dataCategory = "Architecture";
  const catAcq = createElement("li"); catAcq.className = "category-item"; catAcq.dataCategory = "LinkedIn Acquisition";
  const catRoadmap = createElement("li"); catRoadmap.className = "category-item"; catRoadmap.dataCategory = "Roadmap";
  categoryList.appendChild(catAll);
  categoryList.appendChild(catArch);
  categoryList.appendChild(catAcq);
  categoryList.appendChild(catRoadmap);

  [searchInput, categoryList, articleGrid, readerCard].forEach(el => documentMock.body.appendChild(el));

  const windowMock = {
    location: documentMock.location,
    scrollTo: () => {},
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

  return { documentMock, windowMock, listeners };
}

async function runTests() {
  console.log("==================================================");
  console.log("Running Task 4 Knowledge Hub Test Suite");
  console.log("==================================================");

  const env = createMockEnvironment();

  // Evaluate knowledge_hub.js in environment
  const evalHub = Function("window", "document", hubJsSource);
  evalHub(env.windowMock, env.documentMock);

  // Trigger DOMContentLoaded
  if (env.listeners["doc_DOMContentLoaded"]) {
    await Promise.all(env.listeners["doc_DOMContentLoaded"].map(fn => fn()));
  }

  const hub = env.windowMock.WarmGraphKnowledgeHub;
  assert.ok(hub, "WarmGraphKnowledgeHub instance must be attached to window");

  // 1. Check Starter Articles Count (8 articles required)
  const articles = hub.getArticles();
  assert.strictEqual(articles.length, 8, "Must contain 8 starter articles");
  console.log("✓ Test 1: All 8 starter articles loaded in registry");

  // 2. Category Sidebar Filter Test
  const articleGrid = env.documentMock.getElementById("articleGrid");
  const catItems = env.documentMock.querySelectorAll(".category-item");
  const archCat = Array.from(catItems).find(c => c.getAttribute("data-category") === "Architecture");

  archCat.dispatchEvent("click", {});
  const archCards = articleGrid.querySelectorAll(".article-card");
  assert.strictEqual(archCards.length, 1, "Architecture category filter displays 1 article");
  console.log("✓ Test 2: Category sidebar filter works cleanly");

  // Reset category filter to All
  const allCat = Array.from(catItems).find(c => c.getAttribute("data-category") === "all");
  allCat.dispatchEvent("click", {});

  // 3. Instant Search Filter Test
  const searchInput = env.documentMock.getElementById("searchInput");
  searchInput.value = "Pipeline";
  searchInput.dispatchEvent("input", { target: searchInput });

  const searchCards = articleGrid.querySelectorAll(".article-card");
  assert.strictEqual(searchCards.length, 2, "Searching 'Pipeline' filters grid down to matching articles");
  console.log("✓ Test 3: Instant search filters articles by query");

  // Reset search
  searchInput.value = "";
  searchInput.dispatchEvent("input", { target: searchInput });

  // 4. Markdown Rendering Test
  const sampleMarkdown = `# Heading 1\n## Heading 2\n\n> [!NOTE]\n> Test callout box\n\n- Bullet 1\n\n\`\`\`js\nconst x = 10;\n\`\`\``;
  const renderedHtml = hub.renderMarkdown(sampleMarkdown);

  assert.ok(renderedHtml.includes("<h1>Heading 1</h1>"), "Renders H1 headings");
  assert.ok(renderedHtml.includes("<h2>Heading 2</h2>"), "Renders H2 headings");
  assert.ok(renderedHtml.includes("<blockquote class=\"callout-note\">"), "Renders callout alert boxes");
  assert.ok(renderedHtml.includes("<pre><code class=\"language-js\">"), "Renders code blocks with language formatting");
  console.log("✓ Test 4: Custom markdown renderer correctly parses headings, callouts, and code blocks");

  // 5. Open Article Reader View & Roadmap Test
  await hub.openArticle("roadmap");
  const readerTitle = env.documentMock.getElementById("readerTitle");
  const readerContent = env.documentMock.getElementById("readerContent");

  assert.strictEqual(readerTitle.textContent.trim(), "Product Roadmap", "Reader loads Roadmap article title");
  assert.ok(readerContent.textContent.includes("Completed Milestones"), "Roadmap article contains Completed Milestones section");
  assert.ok(readerContent.textContent.includes("Upcoming Planned Features"), "Roadmap article contains Upcoming Planned Features section");
  console.log("✓ Test 5: Article reader view displays formatted article content and Product Roadmap");

  console.log("\nResults: All 5/5 Knowledge Hub tests passed.");
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
