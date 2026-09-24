/**
 * WarmGraph Developer — Knowledge Hub Client (Task 4)
 * 
 * Internal documentation & engineering notes portal.
 * Reads local markdown documentation files and renders clean, searchable article views.
 */

(function () {
  // Registry of documentation articles
  const ARTICLES = [
    {
      id: "architecture",
      title: "WarmGraph Architecture",
      category: "Architecture",
      categoryIcon: "📘",
      updated: "Sep 24, 2026",
      readingTime: "8 min read",
      description: "Core system architecture of WarmGraph including content scripts, persistent background sessions, and backend scoring services.",
      file: "docs/architecture.md"
    },
    {
      id: "acquisition",
      title: "LinkedIn Acquisition Pipeline",
      category: "LinkedIn Acquisition",
      categoryIcon: "🌐",
      updated: "Sep 24, 2026",
      readingTime: "10 min read",
      description: "Zero-click automated extraction pacing, scroll container detection, deduplication, and non-interruptive visual overlay.",
      file: "docs/acquisition.md"
    },
    {
      id: "evidence",
      title: "Relationship Evidence Model",
      category: "Relationship Evidence",
      categoryIcon: "🧠",
      updated: "Sep 24, 2026",
      readingTime: "7 min read",
      description: "Modeling relationship strength using 1st-degree connection cards, mutual connection evidence, and recency scoring.",
      file: "docs/evidence.md"
    },
    {
      id: "methodology",
      title: "Warm Introduction Methodology",
      category: "Warm Introduction",
      categoryIcon: "🏦",
      updated: "Sep 24, 2026",
      readingTime: "9 min read",
      description: "Algorithmic pathfinding for warm introductions, weighted edge scoring, and warm path ranking algorithms.",
      file: "docs/methodology.md"
    },
    {
      id: "banking_workflow",
      title: "Investment Banking Deal Workflow",
      category: "Investment Banking",
      categoryIcon: "🏦",
      updated: "Sep 24, 2026",
      readingTime: "6 min read",
      description: "WarmGraph integration patterns for buy-side and sell-side deal target discovery and senior executive networking.",
      file: "docs/banking_workflow.md"
    },
    {
      id: "graph_pipeline",
      title: "Graph Generation Pipeline",
      category: "Graph Engine",
      categoryIcon: "🔗",
      updated: "Sep 24, 2026",
      readingTime: "8 min read",
      description: "Converting extracted DOM records and mutual evidence snapshots into NetworkX graph representations.",
      file: "docs/graph_pipeline.md"
    },
    {
      id: "engineering_principles",
      title: "Engineering Principles",
      category: "Engineering Decisions",
      categoryIcon: "📝",
      updated: "Sep 24, 2026",
      readingTime: "5 min read",
      description: "Design guidelines, strict non-disruptive UX controls, tenant isolation, and read-only inspection boundaries.",
      file: "docs/engineering_principles.md"
    },
    {
      id: "roadmap",
      title: "Product Roadmap",
      category: "Roadmap",
      categoryIcon: "🗺",
      updated: "Sep 24, 2026",
      readingTime: "6 min read",
      description: "Track feature milestones completed to date and planned upcoming platform capabilities.",
      file: "docs/roadmap.md"
    }
  ];

  // Embedded Raw Markdown Fallbacks
  const EMBEDDED_DOCS = {
    architecture: `# WarmGraph Architecture\n\n**Category:** Architecture\n**Last Updated:** Sep 24, 2026\n**Reading Time:** 8 min read\n\nWarmGraph is a warm-introduction network platform engineered to extract relationship evidence rendered on LinkedIn and build weighted professional relationship graphs.\n\n> [!NOTE]\n> WarmGraph operates on a **client-side passive observation model**. It reads relationship evidence rendered in a user's browser without scraping, API manipulation, or stealth automation.\n\n---\n\n## High-Level System Overview\n\nThe system consists of three distinct layers:\n\n1. **Browser Extension (Client Layer)**:\n   - \`content.js\`: Executes DOM extraction, scroll container inspection, and local deduplication.\n   - \`overlay.js\`: Renders the non-interruptive floating UI status card.\n   - \`background.js\`: Maintains persistent acquisition session state across tab navigation.\n   - \`developer_dashboard.html\`: Read-only internal QA console.\n   - \`knowledge_hub.html\`: Internal documentation portal.\n\n2. **Backend Services (API Layer)**:\n   - FastAPI REST backend serving \`/network/import\`, \`/network/{owner_id}\`, and warm path scoring endpoints.\n   - Tenant isolation & authentication dependencies enforcing strict \`owner_id\` context boundaries.\n\n3. **Data & Storage Layer**:\n   - \`chrome.storage.local\`: Persistent extension storage for local acquisition sessions.\n   - PostgreSQL / JSON Repositories: Persistent relationship graph snapshots.`,

    acquisition: `# LinkedIn Acquisition Pipeline\n\n**Category:** LinkedIn Acquisition\n**Last Updated:** Sep 24, 2026\n**Reading Time:** 10 min read\n\nThe acquisition pipeline captures 1st-degree connections and relationship evidence while a user browses LinkedIn connections pages naturally.\n\n> [!IMPORTANT]\n> The acquisition engine relies on **20–25 second calm pacing intervals** between scroll batches to mirror authentic human browsing speeds.\n\n---\n\n## Key Pipeline Components\n\n### 1. Zero-Click Page Detection\nWhen a user navigates to \`/mynetwork/invite-connect/connections/\`, \`content.js\` detects the connections page context and automatically initializes the \`ConnectionAcquisitionSession\`.\n\n### 2. Scroll Container Discovery\nThe engine dynamically discovers active scroll containers by inspecting element scroll dimensions, overflow properties, and loading sentinels (\`.scaffold-finite-scroll__loader\`).`,

    evidence: `# Relationship Evidence Model\n\n**Category:** Relationship Evidence\n**Last Updated:** Sep 24, 2026\n**Reading Time:** 7 min read\n\nWarmGraph models professional relationship strength using multi-layer evidence rather than binary connection flags.\n\n> [!TIP]\n> Relationship evidence combines direct 1st-degree connection records with observed 2nd-degree mutual connection text extracted from profile cards.\n\n---\n\n## Evidence Types & Schema\n\n| Evidence Type | Degree | Description | Weight Contribution |\n| :--- | :--- | :--- | :--- |\n| \`connection_card\` | 1st | Confirmed 1st-degree connection | Base Score: \`1.0\` |\n| \`relationship_card\` | 2nd | Mutual connection card observed on LinkedIn | Base Score: \`0.7\` |\n| \`mutual_connection_text\` | 2nd | Extracted mutual text snippet | Bonus: \`+0.15\` per mutual |`,

    methodology: `# Warm Introduction Methodology\n\n**Category:** Warm Introduction\n**Last Updated:** Sep 24, 2026\n**Reading Time:** 9 min read\n\nCold outreach yields sub-3% response rates in high-stakes professional transactions. WarmGraph identifies trusted paths to target decision-makers through mutual connections.\n\n> [!NOTE]\n> A **Warm Path** is a multi-hop path through an owner's verified professional network connecting them to a target person or company.`,

    banking_workflow: `# Investment Banking Deal Workflow\n\n**Category:** Investment Banking\n**Last Updated:** Sep 24, 2026\n**Reading Time:** 6 min read\n\nInvestment bankers, private equity partners, and corporate development leaders use WarmGraph to accelerate buy-side and sell-side transaction sourcing.\n\n---\n\n## Transaction Use Cases\n\n### 1. Buy-Side Deal Origination\n- **Objective**: Reach C-suite executives or founder-owners of proprietary acquisition targets without cold emails.\n- **Workflow**: Target Search ──► Warm Path Ranking ──► Connector Outreach.`,

    graph_pipeline: `# Graph Generation Pipeline\n\n**Category:** Graph Engine\n**Last Updated:** Sep 24, 2026\n**Reading Time:** 8 min read\n\nThe graph engine transforms raw connection records and relationship evidence snapshots into a NetworkX graph structure.\n\n---\n\n## Pipeline Execution Steps\n\n1. **Snapshot Import**: Backend receives \`/network/import\` payload.\n2. **Entity Resolution & Node Creation**: Owner node & Profile nodes created.\n3. **Edge Insertion & Weight Assignment**: Weighted graph construction.`,

    engineering_principles: `# Engineering Principles\n\n**Category:** Engineering Decisions\n**Last Updated:** Sep 24, 2026\n**Reading Time:** 5 min read\n\nEngineering standards guiding the design, execution, and boundary enforcement of WarmGraph components.\n\n---\n\n## Core Directives\n1. **Zero Stealth Automation**: Data acquisition is purely passive DOM extraction while browsing.\n2. **Strict Tenant Isolation**: All snapshots and logs are scoped to \`owner_id\`.\n3. **Read-Only Internal Portals**: Developer tools execute read-only queries with zero mutations.`,

    roadmap: `# Product Roadmap\n\n**Category:** Roadmap\n**Last Updated:** Sep 24, 2026\n**Reading Time:** 6 min read\n\nTrack feature milestones completed to date and planned upcoming platform capabilities.\n\n---\n\n## Completed Milestones\n\n- [x] **Persistent Acquisition**: Session state persisted across tabs via \`chrome.storage.local\`.\n- [x] **Background Session**: Persistent \`AcquisitionSessionManager\` handling session lifecycle.\n- [x] **Humanized Visual Overlay**: Non-interruptive floating UI status overlay.\n- [x] **Developer Extraction Dashboard**: Internal QA console for inspecting datasets.\n- [x] **Knowledge Hub**: Internal developer documentation portal.\n\n---\n\n## Upcoming Planned Features\n\n- [ ] **Graph Readiness Engine**: Automated graph readiness check.\n- [ ] **2nd-Degree Mutual Connection Enrichment**: Deep evidence extraction.\n- [ ] **3rd-Degree Multi-Hop Enrichment**: Extended multi-hop graph generation.\n- [ ] **Warm Path Scoring Enhancements**: Advanced ML-weighted relationship scoring.`
  };

  let activeCategory = "all";
  let activeSearchQuery = "";
  let currentArticleId = null;

  // DOM Elements
  const elSearchInput = document.getElementById("searchInput");
  const elCategoryList = document.getElementById("categoryList");
  const elArticleGrid = document.getElementById("articleGrid");
  const elReaderCard = document.getElementById("readerCard");
  const elReaderTitle = document.getElementById("readerTitle");
  const elReaderCategory = document.getElementById("readerCategory");
  const elReaderUpdated = document.getElementById("readerUpdated");
  const elReaderReadingTime = document.getElementById("readerReadingTime");
  const elReaderContent = document.getElementById("readerContent");
  const elBtnBackToGrid = document.getElementById("btnBackToGrid");

  // Utility: HTML Escaping
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Lightweight Markdown Renderer
  function renderMarkdown(mdText) {
    if (!mdText) return "";

    let html = mdText;

    // Callout boxes: > [!NOTE] text
    html = html.replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*([\s\S]*?)(?=\n\n|\n#|$)/gim, (match, type, content) => {
      return `<blockquote class="callout-${type.toLowerCase()}"><strong>${type}:</strong> ${content.trim()}</blockquote>`;
    });

    // Standard Blockquotes
    html = html.replace(/^>\s*(.+)/gim, "<blockquote>$1</blockquote>");

    // Code Blocks ```lang ... ```
    html = html.replace(/```([a-z]*)\n([\s\S]*?)```/gim, (match, lang, code) => {
      return `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`;
    });

    // Inline Code `code`
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Headings
    html = html.replace(/^### (.*$)/gim, "### $1");
    html = html.replace(/^## (.*$)/gim, "## $1");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^### (.*$)/gim, "3 $1");
    html = html.replace(/^3 (.*$)/gim, "<h3>$1</h3>");

    // Horizontal Rule
    html = html.replace(/^---$/gim, "<hr/>");

    // Bold & Italic
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Checkbox lists - [x] or - [ ]
    html = html.replace(/^- \[x\] (.*$)/gim, '<li><span style="color:#059669; font-weight:bold;">✓</span> $1</li>');
    html = html.replace(/^- \[ \] (.*$)/gim, '<li><span style="color:#94a3b8; font-weight:bold;">○</span> $1</li>');

    // Bullet Lists
    html = html.replace(/^\s*-\s+(.*$)/gim, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>)/gim, "<ul>$1</ul>");

    // Tables (| col | col |)
    html = html.replace(/^\|(.+)\|$/gim, (match, content) => {
      const cols = content.split("|").map(c => c.trim());
      if (cols.every(c => /^:?-+:?$/.test(c))) return ""; // Header divider row
      const cellTag = match.includes("---") ? "th" : "td";
      return "<tr>" + cols.map(c => `<${cellTag}>${c}</${cellTag}>`).join("") + "</tr>";
    });
    html = html.replace(/(<tr>.*<\/tr>)/gim, "<table>$1</table>");

    // Paragraphs
    const paragraphs = html.split(/\n\n+/);
    html = paragraphs.map(p => {
      if (/^<(h1|h2|h3|ul|ol|pre|blockquote|table|hr)/.test(p.trim())) {
        return p;
      }
      return `<p>${p.trim()}</p>`;
    }).join("");

    return html;
  }

  // Highlight Search Terms
  function highlightText(text, query) {
    const safeText = escapeHtml(text || "");
    if (!query || !query.trim()) return safeText;

    const trimmed = query.trim();
    const regex = new RegExp(`(${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return safeText.replace(regex, '<mark class="highlight-match">$1</mark>');
  }

  // Render Article Cards Grid
  function renderArticleGrid() {
    const query = activeSearchQuery.toLowerCase().trim();

    const filtered = ARTICLES.filter(art => {
      // Category Filter
      if (activeCategory !== "all" && art.category !== activeCategory) {
        return false;
      }

      // Search Query Filter
      if (query) {
        const titleMatch = art.title.toLowerCase().includes(query);
        const descMatch = art.description.toLowerCase().includes(query);
        const catMatch = art.category.toLowerCase().includes(query);
        const bodyContent = EMBEDDED_DOCS[art.id] || "";
        const bodyMatch = bodyContent.toLowerCase().includes(query);
        if (!titleMatch && !descMatch && !catMatch && !bodyMatch) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      elArticleGrid.innerHTML = `
        <div class="empty-state">
          No documentation articles match your current search and category filter.
        </div>
      `;
      return;
    }

    elArticleGrid.innerHTML = filtered.map(art => {
      const highlightedTitle = highlightText(art.title, activeSearchQuery);
      const highlightedDesc = highlightText(art.description, activeSearchQuery);

      return `
        <div class="article-card" data-id="${art.id}">
          <div class="article-card-header">
            <span class="article-category-badge">${art.categoryIcon} ${escapeHtml(art.category)}</span>
            <h3 class="article-card-title">${highlightedTitle}</h3>
            <div class="article-meta">Updated ${escapeHtml(art.updated)} • ${escapeHtml(art.readingTime)}</div>
            <p class="article-card-desc">${highlightedDesc}</p>
          </div>
          <div class="article-card-action">
            Open Documentation ↗
          </div>
        </div>
      `;
    }).join("");

    // Attach click handlers to article cards
    elArticleGrid.querySelectorAll(".article-card").forEach(card => {
      card.addEventListener("click", () => {
        const artId = card.getAttribute("data-id");
        openArticleReader(artId);
      });
    });
  }

  // Open Article Reader View
  async function openArticleReader(articleId) {
    const article = ARTICLES.find(a => a.id === articleId);
    if (!article) return;

    currentArticleId = articleId;

    elReaderTitle.textContent = article.title;
    elReaderCategory.textContent = `${article.categoryIcon} ${article.category}`;
    elReaderUpdated.textContent = `Updated ${article.updated}`;
    elReaderReadingTime.textContent = article.readingTime;

    let mdContent = EMBEDDED_DOCS[articleId] || "";

    // Attempt fetching file if available
    const fetchFn = (typeof window !== "undefined" && window.fetch) ? window.fetch : null;
    if (fetchFn && article.file) {
      try {
        const res = await fetchFn(article.file);
        if (res.ok) {
          mdContent = await res.text();
        }
      } catch (e) {
        // Use embedded doc fallback
      }
    }

    elReaderContent.innerHTML = renderMarkdown(mdContent);

    // Switch view
    elArticleGrid.style.display = "none";
    elReaderCard.style.display = "block";

    // Scroll to top
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToGrid() {
    currentArticleId = null;
    elReaderCard.style.display = "none";
    elArticleGrid.style.display = "grid";
  }

  // Event Listeners Setup
  function setupEventListeners() {
    elSearchInput.addEventListener("input", (e) => {
      activeSearchQuery = e.target.value;
      if (currentArticleId) backToGrid();
      renderArticleGrid();
    });

    const categoryItems = elCategoryList.querySelectorAll(".category-item");
    categoryItems.forEach(item => {
      item.addEventListener("click", () => {
        categoryItems.forEach(i => i.classList.remove("active"));
        item.classList.add("active");
        activeCategory = item.getAttribute("data-category");
        if (currentArticleId) backToGrid();
        renderArticleGrid();
      });
    });

    elBtnBackToGrid.addEventListener("click", backToGrid);
  }

  // Initialize on load
  function init() {
    setupEventListeners();
    renderArticleGrid();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", init);
  }

  // Expose global methods for test suite
  if (typeof window !== "undefined") {
    window.WarmGraphKnowledgeHub = {
      getArticles: () => ARTICLES,
      openArticle: openArticleReader,
      renderMarkdown
    };
  }
})();
