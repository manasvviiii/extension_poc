/**
 * WarmGraph SaaS — Research & Knowledge Hub JavaScript (Task 12.1 Privacy Fix)
 * Dynamic Relationship Intelligence & Local Notes Persistence (Zero Mock Names)
 */

document.addEventListener("DOMContentLoaded", () => {
  initResearchWorkspace();
});

let researchState = {
  connections: [],
  companies: [],
  ownerId: "me",
  isLoaded: false
};

const DEFAULT_GENERIC_NOTES = {
  main: `# Research Workspace Journal & Notes

## Deal Pipeline & Relationship Strategy

- **Key Contact Networks**: Active imported LinkedIn connections.
- **Institutional Alignment**: Grouped organizations and faculty / corporate relationships.

### Action Items
1. Review 1-hop and 2-hop warm path introduction routes.
2. Log research notes for target deal organizations.
3. Track key contacts and relationship evidence badges.

\`\`\`json
{
  "workspace": "research_hub",
  "status": "dynamic_active",
  "data_source": "imported_network"
}
\`\`\`

Visit the [WarmGraph Knowledge Hub](knowledge.html) for theoretical background.`,
  company: `# Company Intelligence & Deal Pipeline

## Overview
Target organization profile dynamically loaded from your imported relationship graph.

### Key Insights
- **Connected Employees**: Filtered from active 1st-degree connections.
- **Warm Intros**: Shared relationship evidence and path routes.`,
  person: `# Person Profile & Relationship Journal

## Overview
Contact relationship profile dynamically resolved from your imported network.

### Relationship Evidence
- **Verified Badges**: Direct 1st-degree edge and institutional overlap.`
};

/**
 * Main Initialization Controller
 */
async function initResearchWorkspace() {
  await loadImportedNetworkData();

  const urlParams = new URLSearchParams(window.location.search);
  const targetName = urlParams.get("name") || urlParams.get("id") || urlParams.get("slug");

  const path = window.location.pathname;

  if (path.includes("company.html")) {
    initCompanyPage(targetName);
  } else if (path.includes("person.html")) {
    initPersonPage(targetName);
  } else {
    initMainResearchPage();
  }

  setupSidebarNav();
}

/**
 * Data Loader Priority:
 * 1. chrome.storage.local
 * 2. localStorage
 * 3. GET /network/{owner_id}
 * 4. Empty State
 */
async function loadImportedNetworkData() {
  let connections = [];
  let owner = "me";

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const res = await new Promise((resolve) => {
        chrome.storage.local.get(["warmgraph_active_graph", "warmgraph_owner", "acquisition_session"], resolve);
      });
      if (res && res.warmgraph_active_graph && Array.isArray(res.warmgraph_active_graph.connections) && res.warmgraph_active_graph.connections.length > 0) {
        connections = res.warmgraph_active_graph.connections;
        if (res.warmgraph_owner) owner = res.warmgraph_owner;
      } else if (res && res.acquisition_session && Array.isArray(res.acquisition_session.collectedConnections) && res.acquisition_session.collectedConnections.length > 0) {
        connections = res.acquisition_session.collectedConnections;
      }
    } catch (err) {}
  }

  if (connections.length === 0) {
    try {
      const rawGraph = localStorage.getItem("warmgraph_active_graph");
      if (rawGraph) {
        const parsed = JSON.parse(rawGraph);
        if (parsed && Array.isArray(parsed.connections) && parsed.connections.length > 0) {
          connections = parsed.connections;
        }
      }
      const savedOwner = localStorage.getItem("warmgraph_owner");
      if (savedOwner) owner = savedOwner;
    } catch (err) {}
  }

  if (connections.length === 0 && owner && owner !== "me") {
    try {
      const resp = await fetch(`http://127.0.0.1:8000/network/${owner}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.connections) && data.connections.length > 0) {
          connections = data.connections;
        }
      }
    } catch (err) {}
  }

  // Sort connections by relationship strength (mutual count / degree)
  connections.sort((a, b) => (b.mutualCount || 0) - (a.mutualCount || 0));

  researchState.connections = connections.map((c, idx) => normalizeConnection(c, idx));
  researchState.ownerId = owner;
  researchState.companies = groupCompaniesFromConnections(researchState.connections);
  researchState.isLoaded = true;
}

/**
 * Connection Object Normalization
 */
function normalizeConnection(c, index) {
  const name = c.name || c.label || `Connection ${index + 1}`;
  const headline = c.headline || c.title || "LinkedIn Member";
  const company = c.company || extractCompany(headline) || "—";
  
  const lowerHeadline = headline.toLowerCase();
  let roleType = c.role_type || c.role || "professional";
  if (lowerHeadline.includes("student") || lowerHeadline.includes("undergraduate") || lowerHeadline.includes("pursuing") || lowerHeadline.includes("intern")) {
    roleType = "student";
  } else if (lowerHeadline.includes("professor") || lowerHeadline.includes("lecturer") || lowerHeadline.includes("dept") || lowerHeadline.includes("faculty") || lowerHeadline.includes("dean")) {
    roleType = "faculty";
  }

  const degree = c.degree || "1st";
  const profileUrl = c.profile_url || c.url || `https://www.linkedin.com/in/${slugify(name)}`;

  return {
    id: c.id || slugify(name) || `conn_${index}`,
    name,
    headline,
    company,
    roleType,
    degree,
    profileUrl,
    evidence: c.structured_evidence || [
      { type: "same_company", label: company !== "—" ? company : "Shared Affiliation", confidence: 0.85 },
      { type: "linkedin_1st_degree", label: "LinkedIn 1st Degree Connection", confidence: 0.70 }
    ],
    mutualCount: c.mutualCount || 0
  };
}

function extractCompany(headline) {
  if (!headline) return null;
  const match = headline.match(/(?:at|@|\||,)\s*([A-Za-z0-9\s&]{3,40})/i);
  return match ? match[1].trim() : null;
}

/**
 * Group Companies Dynamically from Connections
 */
function groupCompaniesFromConnections(connections) {
  const compMap = new Map();

  connections.forEach(c => {
    if (c.company && c.company !== "—") {
      const existing = compMap.get(c.company) || { name: c.company, industry: "Technology & Professional Services", count: 0 };
      existing.count += 1;
      compMap.set(c.company, existing);
    }
  });

  return Array.from(compMap.values()).sort((a, b) => b.count - a.count);
}

/**
 * Setup Left Sidebar Navigation & Search Filter
 */
function setupSidebarNav() {
  const sidebarNav = document.querySelectorAll(".sidebar-nav-item");
  sidebarNav.forEach(item => {
    item.addEventListener("click", () => {
      sidebarNav.forEach(i => i.classList.remove("active"));
      item.classList.add("active");
    });
  });

  const searchInput = document.getElementById("sidebar-search") || 
                      document.getElementById("company-sidebar-search") || 
                      document.getElementById("person-sidebar-search");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll(".sidebar-nav-item").forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(q) ? "flex" : "none";
      });
    });
  }
}

/**
 * Initialize Main Research Dashboard (research.html)
 */
function initMainResearchPage() {
  renderCompaniesGrid("companies-grid", researchState.companies);
  renderPeopleGrid("people-grid", researchState.connections.slice(0, 12));

  // Update nav counters
  setElText("count-nav-companies", researchState.companies.length);
  setElText("count-nav-people", researchState.connections.length);

  setupMarkdownEditor(
    "markdown-input",
    "preview-container",
    "editor-container",
    "tab-write",
    "tab-preview",
    "save-status",
    "warmgraph_research_workspace_notes",
    DEFAULT_GENERIC_NOTES.main
  );
}

/**
 * Initialize Company Page (company.html)
 */
function initCompanyPage(companyName) {
  if (!companyName && researchState.companies.length > 0) {
    companyName = researchState.companies[0].name;
  }

  const nameEl = document.getElementById("company-name");
  if (nameEl) nameEl.textContent = companyName || "No Company Selected";

  if (!companyName || researchState.connections.length === 0) {
    renderEmptyStateInContainer("company-employees-grid");
    return;
  }

  const comp = researchState.companies.find(c => c.name.toLowerCase() === companyName.toLowerCase()) || {
    name: companyName,
    industry: "Enterprise Software & Tech",
    count: 0
  };

  const indEl = document.getElementById("company-industry");
  if (indEl) indEl.textContent = `Industry: ${comp.industry}`;

  const empCountEl = document.getElementById("emp-count");
  if (empCountEl) empCountEl.textContent = comp.count;

  // Filter employees matching target company
  const employees = researchState.connections.filter(p => p.company.toLowerCase().includes(companyName.toLowerCase()));
  renderPeopleGrid("company-employees-grid", employees);

  // Render company sidebar items dynamically
  const sidebarList = document.getElementById("company-list-sidebar");
  if (sidebarList && researchState.companies.length > 0) {
    sidebarList.innerHTML = researchState.companies.slice(0, 8).map(c => `
      <li class="sidebar-nav-item ${c.name.toLowerCase() === companyName.toLowerCase() ? 'active' : ''}" data-company="${escapeHtml(c.name)}">
        <a href="company.html?name=${encodeURIComponent(c.name)}" style="color:inherit; text-decoration:none; display:flex; justify-content:space-between; width:100%;">
          <span>${escapeHtml(c.name)}</span>
          <span class="sidebar-count-badge">${c.count}</span>
        </a>
      </li>
    `).join("");
  }

  const noteKey = `warmgraph_company_notes_${slugify(companyName)}`;
  setupMarkdownEditor(
    "company-markdown-input",
    "company-preview-container",
    "company-editor-container",
    "company-tab-write",
    "company-tab-preview",
    "company-save-status",
    noteKey,
    DEFAULT_GENERIC_NOTES.company
  );
}

/**
 * Initialize Person Page (person.html)
 */
function initPersonPage(personTarget) {
  let person = null;

  if (personTarget) {
    const q = personTarget.toLowerCase();
    person = researchState.connections.find(p => p.id === q || p.name.toLowerCase() === q || slugify(p.name) === q || p.profileUrl.toLowerCase().includes(q));
  }

  if (!person && researchState.connections.length > 0) {
    person = researchState.connections[0];
  }

  if (!person) {
    renderEmptyStateInContainer("person-evidence-grid");
    const nameEl = document.getElementById("person-name");
    if (nameEl) nameEl.textContent = "No Network Imported";
    return;
  }

  const nameEl = document.getElementById("person-name");
  if (nameEl) nameEl.textContent = person.name;

  const headEl = document.getElementById("person-headline");
  if (headEl) headEl.textContent = person.headline;

  const avatarEl = document.getElementById("person-avatar");
  if (avatarEl) avatarEl.textContent = getInitials(person.name);

  // Render Person Evidence Grid dynamically
  const evGrid = document.getElementById("person-evidence-grid");
  if (evGrid) {
    evGrid.innerHTML = (person.evidence || []).map(ev => `
      <div class="item-card" style="border-left: 3px solid #38bdf8;">
        <div class="item-card-title">${escapeHtml(ev.label)}</div>
        <div class="item-card-sub">Confidence: ${Math.round((ev.confidence || 0.7) * 100)}% • Type: ${escapeHtml(ev.type)}</div>
      </div>
    `).join("");
  }

  // Render Person Sidebar dynamically
  const sidebarList = document.getElementById("person-list-sidebar");
  if (sidebarList && researchState.connections.length > 0) {
    sidebarList.innerHTML = researchState.connections.slice(0, 8).map(p => `
      <li class="sidebar-nav-item ${p.id === person.id ? 'active' : ''}">
        <a href="person.html?id=${encodeURIComponent(p.id)}" style="color:inherit; text-decoration:none; display:flex; justify-content:space-between; width:100%;">
          <span>${escapeHtml(p.name)}</span>
          <span class="sidebar-count-badge">${p.roleType}</span>
        </a>
      </li>
    `).join("");
  }

  const noteKey = `warmgraph_person_notes_${slugify(person.name)}`;
  setupMarkdownEditor(
    "person-markdown-input",
    "person-preview-container",
    "person-editor-container",
    "person-tab-write",
    "person-tab-preview",
    "person-save-status",
    noteKey,
    DEFAULT_GENERIC_NOTES.person
  );
}

/**
 * Render Researched Companies Grid or Empty State
 */
function renderCompaniesGrid(containerId, list) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (list.length === 0) {
    renderEmptyStateInContainer(containerId);
    return;
  }

  container.innerHTML = list.map(c => `
    <a href="company.html?name=${encodeURIComponent(c.name)}" class="item-card">
      <div class="item-card-title">${escapeHtml(c.name)}</div>
      <div class="item-card-sub">${escapeHtml(c.industry)}</div>
      <div style="margin-top: 10px; font-size: 0.75rem; color: #38bdf8; font-weight: 600;">
        👥 ${c.count} Connected Employees • View Company →
      </div>
    </a>
  `).join("");
}

/**
 * Render Key People Grid or Empty State
 */
function renderPeopleGrid(containerId, list) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (list.length === 0) {
    renderEmptyStateInContainer(containerId);
    return;
  }

  container.innerHTML = list.map(p => `
    <a href="person.html?id=${encodeURIComponent(p.id)}" class="item-card">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
        <div style="width: 32px; height: 32px; border-radius: 50%; background: #2563eb; color: #fff; font-size: 0.8rem; font-weight: 700; display: flex; align-items: center; justify-content: center;">
          ${getInitials(p.name)}
        </div>
        <div>
          <div class="item-card-title" style="font-size: 0.95rem; margin: 0;">${escapeHtml(p.name)}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">${escapeHtml(p.company)}</div>
        </div>
      </div>
      <div class="item-card-sub" style="margin-top: 6px;">${escapeHtml(p.headline)}</div>
    </a>
  `).join("");
}

/**
 * Standard Clean Empty State Renderer
 */
function renderEmptyStateInContainer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="empty-state visible" style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:40px 20px; width:100%;">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px; height:48px; color:#64748b; margin-bottom:12px;">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <h3 class="empty-state-title" style="font-size:1.15rem; font-weight:700; color:#f8fafc; margin-bottom:6px;">No Network Imported</h3>
      <p class="empty-state-desc" style="color:#94a3b8; font-size:0.9rem; max-width:420px; margin-bottom:16px;">Import your LinkedIn network using the WarmGraph extension to start exploring people, companies and warm introductions.</p>
      <button class="empty-state-btn open-install-modal" style="padding:8px 18px; border-radius:12px; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.3); color:#38bdf8; font-weight:600; cursor:pointer;">Open Extension</button>
    </div>
  `;
}

/**
 * Setup Markdown Editor
 */
function setupMarkdownEditor(inputId, previewId, editorId, tabWriteId, tabPreviewId, statusId, storageKey, defaultText) {
  const inputEl = document.getElementById(inputId);
  const previewEl = document.getElementById(previewId);
  const editorEl = document.getElementById(editorId);
  const tabWriteBtn = document.getElementById(tabWriteId);
  const tabPreviewBtn = document.getElementById(tabPreviewId);
  const statusEl = document.getElementById(statusId);

  if (!inputEl || !previewEl) return;

  const saved = localStorage.getItem(storageKey);
  inputEl.value = saved || defaultText;

  inputEl.addEventListener("input", () => {
    localStorage.setItem(storageKey, inputEl.value);
    if (statusEl) {
      statusEl.textContent = "✓ Saved locally";
      statusEl.style.color = "#10b981";
    }
  });

  if (tabWriteBtn && tabPreviewBtn && editorEl) {
    tabWriteBtn.addEventListener("click", () => {
      tabWriteBtn.classList.add("active");
      tabPreviewBtn.classList.remove("active");
      editorEl.style.display = "block";
      previewEl.style.display = "none";
    });

    tabPreviewBtn.addEventListener("click", () => {
      tabPreviewBtn.classList.add("active");
      tabWriteBtn.classList.remove("active");
      editorEl.style.display = "none";
      previewEl.style.display = "block";

      previewEl.innerHTML = renderMarkdown(inputEl.value);
    });
  }
}

/**
 * Lightweight Markdown Parser
 */
function renderMarkdown(md) {
  if (!md) return "<p>No content written yet.</p>";

  let html = escapeHtml(md);

  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/^\s*[-*]\s+(.*)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');

  html = html.split('\n\n').map(p => {
    if (p.startsWith('<h') || p.startsWith('<pre') || p.startsWith('<ul')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return html;
}

function setElText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function getInitials(name) {
  if (!name) return "WG";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function slugify(text) {
  return (text || "").toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
