/**
 * WarmGraph SaaS — My Network Workspace JavaScript (Task 12.1 Privacy Fix)
 * Modern CRM Relationship Network Explorer (Dynamic Data Only)
 */

document.addEventListener("DOMContentLoaded", () => {
  initNetworkWorkspace();
});

let state = {
  allConnections: [],
  filteredConnections: [],
  activeFilter: "all",
  searchQuery: "",
  selectedConnection: null,
  ownerId: "me",
  lastSyncedAt: "Unavailable"
};

/**
 * Initialize My Network Workspace
 */
async function initNetworkWorkspace() {
  bindEvents();
  setupKeyboardShortcuts();
  await loadNetworkData();
  applyFiltersAndRender();
}

/**
 * Event Bindings for Controls, Filters, and Drawer
 */
function bindEvents() {
  const searchInput = document.getElementById("network-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = (e.target.value || "").trim().toLowerCase();
      applyFiltersAndRender();
    });
  }

  const clearBtn = document.getElementById("clear-search-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.searchQuery = "";
      state.activeFilter = "all";
      if (searchInput) searchInput.value = "";
      
      document.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
      const allPill = document.querySelector('.filter-pill[data-filter="all"]');
      if (allPill) allPill.classList.add("active");

      applyFiltersAndRender();
    });
  }

  const filterPills = document.querySelectorAll(".filter-pill");
  filterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      filterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");

      state.activeFilter = pill.getAttribute("data-filter") || "all";
      applyFiltersAndRender();
    });
  });

  const closeDrawerBtn = document.getElementById("close-drawer-btn");
  const drawerBackdrop = document.getElementById("drawer-backdrop");

  if (closeDrawerBtn) closeDrawerBtn.addEventListener("click", closeDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeDrawer);
}

/**
 * CMD + K Shortcut Listener
 */
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const searchInput = document.getElementById("network-search-input");
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }

    if (e.key === "Escape") {
      closeDrawer();
    }
  });
}

/**
 * Data Loader Priority:
 * 1. chrome.storage.local
 * 2. localStorage
 * 3. GET /network/{owner_id}
 * 4. Empty State
 */
async function loadNetworkData() {
  let connections = [];
  let owner = "me";

  // 1. Try Chrome Storage
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const res = await new Promise((resolve) => {
        chrome.storage.local.get(["warmgraph_active_graph", "warmgraph_owner", "warmgraph_last_sync", "acquisition_session"], resolve);
      });
      if (res && res.warmgraph_active_graph && Array.isArray(res.warmgraph_active_graph.connections) && res.warmgraph_active_graph.connections.length > 0) {
        connections = res.warmgraph_active_graph.connections;
        if (res.warmgraph_owner) owner = res.warmgraph_owner;
        if (res.warmgraph_last_sync) state.lastSyncedAt = res.warmgraph_last_sync;
      } else if (res && res.acquisition_session && Array.isArray(res.acquisition_session.collectedConnections) && res.acquisition_session.collectedConnections.length > 0) {
        connections = res.acquisition_session.collectedConnections;
      }
    } catch (err) {}
  }

  // 2. Try LocalStorage
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

  // 3. Try Backend API GET /network/{owner}
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

  // Normalize connection schema (connections will be empty [] if no data imported)
  state.allConnections = connections.map((c, idx) => normalizeConnection(c, idx));
  state.ownerId = owner;

  // Update Hero counts
  const countEl = document.getElementById("hero-connection-count");
  if (countEl) countEl.textContent = state.allConnections.length;

  const syncedEl = document.getElementById("hero-last-synced");
  if (syncedEl) {
    syncedEl.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      Last synced: ${state.lastSyncedAt}
    `;
  }

  updateCategoryCounts();
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

  const structuredEvidence = Array.isArray(c.structured_evidence) ? c.structured_evidence : [
    company && company !== "—" ? { type: "same_company", label: company, confidence: 0.85 } : null,
    roleType === "student" || roleType === "faculty" ? { type: "student_faculty", label: "Student ↔ Faculty Relationship", confidence: 0.92 } : null,
    { type: "linkedin_1st_degree", label: "LinkedIn 1st Degree Connection", confidence: 0.70 }
  ].filter(Boolean);

  return {
    id: c.id || `conn_${index}_${slugify(name)}`,
    name,
    headline,
    company,
    roleType,
    degree,
    profileUrl,
    structuredEvidence,
    evidence: c.evidence || [
      `Direct 1st-degree connection in your relationship graph.`
    ],
    mutualCount: c.mutualCount || 0,
    skills: c.skills || ["Network Graph"]
  };
}

function extractCompany(headline) {
  if (!headline) return null;
  const match = headline.match(/(?:at|@|\||,)\s*([A-Za-z0-9\s&]{3,40})/i);
  return match ? match[1].trim() : null;
}

/**
 * Filter Connections & Update UI Grid
 */
function applyFiltersAndRender() {
  const query = state.searchQuery;
  const filter = state.activeFilter;

  state.filteredConnections = state.allConnections.filter(c => {
    if (query) {
      const matchName = c.name.toLowerCase().includes(query);
      const matchHeadline = c.headline.toLowerCase().includes(query);
      const matchCompany = c.company.toLowerCase().includes(query);
      const matchRole = c.roleType.toLowerCase().includes(query);

      if (!matchName && !matchHeadline && !matchCompany && !matchRole) {
        return false;
      }
    }

    if (filter === "students") {
      return c.roleType === "student";
    } else if (filter === "faculty") {
      return c.roleType === "faculty";
    } else if (filter === "company") {
      return c.company && c.company !== "—" && c.roleType !== "student";
    } else if (filter === "1st") {
      return c.degree.includes("1st") || c.degree === "1st";
    }

    return true;
  });

  renderGrid(state.filteredConnections);
}

/**
 * Render Grid Cards or Clean Empty State
 */
function renderGrid(connections) {
  const gridContainer = document.getElementById("connection-grid");
  const emptyStateContainer = document.getElementById("empty-state");

  if (!gridContainer) return;

  gridContainer.innerHTML = "";

  // Render Clean Empty State if no connections exist
  if (connections.length === 0) {
    if (emptyStateContainer) {
      emptyStateContainer.innerHTML = `
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
        <h3 class="empty-state-title">No Network Imported</h3>
        <p class="empty-state-desc">Import your LinkedIn network using the WarmGraph extension to start exploring people, companies and warm introductions.</p>
        <button class="empty-state-btn open-install-modal" id="clear-search-btn">Open Extension</button>
      `;
      emptyStateContainer.classList.add("visible");
    }
    return;
  }

  if (emptyStateContainer) emptyStateContainer.classList.remove("visible");

  const fragment = document.createDocumentFragment();

  connections.forEach(conn => {
    const card = document.createElement("div");
    card.className = "connection-card";
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");

    const initials = getInitials(conn.name);
    
    let roleBadgeHtml = "";
    if (conn.roleType === "student") {
      roleBadgeHtml = `<span class="badge badge-student">🎓 Student</span>`;
    } else if (conn.roleType === "faculty") {
      roleBadgeHtml = `<span class="badge badge-faculty">👨‍🏫 Faculty</span>`;
    } else {
      roleBadgeHtml = `<span class="badge badge-company">💼 ${escapeHtml(conn.company)}</span>`;
    }

    const degreeBadgeHtml = `<span class="badge badge-degree">⚡ 1st Degree</span>`;

    card.innerHTML = `
      <div>
        <div class="card-header">
          <div class="card-avatar">${initials}</div>
          <div class="card-title-group">
            <h3 class="card-name">${escapeHtml(conn.name)}</h3>
            <p class="card-headline">${escapeHtml(conn.headline)}</p>
          </div>
        </div>

        <div class="card-company">
          <svg class="card-company-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
          <span>${escapeHtml(conn.company)}</span>
        </div>
      </div>

      <div class="card-badges">
        ${degreeBadgeHtml}
        ${roleBadgeHtml}
      </div>
    `;

    card.addEventListener("click", () => openDrawer(conn));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDrawer(conn);
      }
    });

    fragment.appendChild(card);
  });

  gridContainer.appendChild(fragment);
}

/**
 * Open Profile Side Drawer
 */
function openDrawer(conn) {
  state.selectedConnection = conn;

  const drawer = document.getElementById("profile-drawer");
  const backdrop = document.getElementById("drawer-backdrop");

  if (!drawer || !backdrop) return;

  document.getElementById("drawer-avatar").textContent = getInitials(conn.name);
  document.getElementById("drawer-name").textContent = conn.name;
  document.getElementById("drawer-headline").textContent = conn.headline;
  document.getElementById("drawer-company").textContent = conn.company;

  const linkEl = document.getElementById("drawer-profile-url");
  if (linkEl) {
    linkEl.href = conn.profileUrl;
  }

  const badgesContainer = document.getElementById("drawer-badges");
  if (badgesContainer) {
    let roleBadge = conn.roleType === "student" ? '<span class="badge badge-student">🎓 Student</span>' :
                    conn.roleType === "faculty" ? '<span class="badge badge-faculty">👨‍🏫 Faculty</span>' :
                    '<span class="badge badge-company">💼 Professional</span>';

    badgesContainer.innerHTML = `
      <span class="badge badge-degree">⚡ 1st Degree</span>
      ${roleBadge}
    `;
  }

  const evidenceList = document.getElementById("drawer-evidence-list");
  if (evidenceList) {
    const iconMap = {
      same_college: "🎓",
      student_faculty: "👨‍🏫",
      same_dept: "🏛️",
      same_company: "💼",
      same_city: "📍",
      linkedin_1st_degree: "⚡"
    };

    const structuredItems = (conn.structuredEvidence || []).map(ev => {
      const icon = iconMap[ev.type] || "🔗";
      const confPercent = Math.round((ev.confidence || 0.7) * 100);
      return `
        <div class="evidence-item">
          <span style="font-size: 1.1rem;">${icon}</span>
          <div>
            <strong>${escapeHtml(ev.label)}</strong>
            <div style="font-size: 0.75rem; color: #38bdf8; margin-top: 2px;">
              Confidence: ${confPercent}% • Priority Type: ${escapeHtml(ev.type)}
            </div>
          </div>
        </div>
      `;
    }).join("");

    evidenceList.innerHTML = structuredItems || conn.evidence.map(ev => `
      <div class="evidence-item">
        <svg class="evidence-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <div>${escapeHtml(ev)}</div>
      </div>
    `).join("");
  }

  backdrop.classList.add("open");
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  const drawer = document.getElementById("profile-drawer");
  const backdrop = document.getElementById("drawer-backdrop");

  if (drawer) {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }
  if (backdrop) {
    backdrop.classList.remove("open");
  }
}

function updateCategoryCounts() {
  const total = state.allConnections.length;
  const students = state.allConnections.filter(c => c.roleType === "student").length;
  const faculty = state.allConnections.filter(c => c.roleType === "faculty").length;
  const company = state.allConnections.filter(c => c.company && c.company !== "—" && c.roleType !== "student").length;
  const firstDeg = state.allConnections.filter(c => c.degree.includes("1st") || c.degree === "1st").length;

  setElText("count-all", total);
  setElText("count-students", students);
  setElText("count-faculty", faculty);
  setElText("count-company", company);
  setElText("count-1st", firstDeg);
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
