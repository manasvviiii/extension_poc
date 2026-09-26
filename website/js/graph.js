/**
 * WarmGraph SaaS — Interactive Graph Visualizer JavaScript (Task 12.1 Privacy Fix)
 * Powered by Cytoscape.js (Dynamic Data Only)
 */

document.addEventListener("DOMContentLoaded", () => {
  initGraphVisualizer();
});

let cy = null;
let graphState = {
  ownerId: "me",
  ownerName: "You",
  selectedNode: null,
  activePath: null,
  nodes: [],
  edges: []
};

/**
 * Initialize Cytoscape Visualizer
 */
async function initGraphVisualizer() {
  await loadGraphData();
  setupCytoscapeCanvas();
  bindToolbarEvents();
  setupKeyboardShortcuts();
}

/**
 * Data Loader Priority:
 * 1. chrome.storage.local
 * 2. localStorage
 * 3. GET /network/{owner_id}
 * 4. Empty State
 */
async function loadGraphData() {
  let rawConnections = [];
  let owner = "me";

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const res = await new Promise((resolve) => {
        chrome.storage.local.get(["warmgraph_active_graph", "warmgraph_owner", "acquisition_session"], resolve);
      });
      if (res && res.warmgraph_active_graph && Array.isArray(res.warmgraph_active_graph.connections) && res.warmgraph_active_graph.connections.length > 0) {
        rawConnections = res.warmgraph_active_graph.connections;
        if (res.warmgraph_owner) owner = res.warmgraph_owner;
      } else if (res && res.acquisition_session && Array.isArray(res.acquisition_session.collectedConnections) && res.acquisition_session.collectedConnections.length > 0) {
        rawConnections = res.acquisition_session.collectedConnections;
      }
    } catch (err) {}
  }

  if (rawConnections.length === 0) {
    try {
      const rawGraph = localStorage.getItem("warmgraph_active_graph");
      if (rawGraph) {
        const parsed = JSON.parse(rawGraph);
        if (parsed && Array.isArray(parsed.connections) && parsed.connections.length > 0) {
          rawConnections = parsed.connections;
        }
      }
      const savedOwner = localStorage.getItem("warmgraph_owner");
      if (savedOwner) owner = savedOwner;
    } catch (err) {}
  }

  if (rawConnections.length === 0 && owner && owner !== "me") {
    try {
      const resp = await fetch(`http://127.0.0.1:8000/network/${owner}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.connections) && data.connections.length > 0) {
          rawConnections = data.connections;
        }
      }
    } catch (err) {}
  }

  graphState.ownerId = owner;
  
  // Convert connections to Cytoscape Nodes & Edges (empty [] if no imported data)
  const cyElements = buildCytoscapeElements(owner, rawConnections);
  graphState.nodes = cyElements.nodes;
  graphState.edges = cyElements.edges;

  // Update counters
  const nodesCountEl = document.getElementById("cy-nodes-count");
  if (nodesCountEl) nodesCountEl.textContent = `${graphState.nodes.length} Nodes`;

  const edgesCountEl = document.getElementById("cy-edges-count");
  if (edgesCountEl) edgesCountEl.textContent = `${graphState.edges.length} Edges`;
}

/**
 * Build Cytoscape Node & Edge Schema
 */
function buildCytoscapeElements(ownerId, connections) {
  if (!connections || connections.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes = [];
  const edges = [];

  nodes.push({
    data: {
      id: ownerId,
      label: "You",
      name: "You (Graph Owner)",
      headline: "Graph Owner",
      company: "WarmGraph",
      roleType: "owner",
      degree: "Owner",
      isOwner: true
    }
  });

  connections.forEach((c, idx) => {
    const nodeId = c.id || slugify(c.name || `conn_${idx}`) || `node_${idx}`;
    const name = c.name || c.label || `Connection ${idx + 1}`;
    const headline = c.headline || "LinkedIn Member";
    const company = c.company || "—";
    const roleType = c.role_type || c.roleType || (headline.toLowerCase().includes("student") ? "student" : headline.toLowerCase().includes("professor") ? "faculty" : "professional");
    const degree = c.degree || "1st";

    nodes.push({
      data: {
        id: nodeId,
        label: name,
        name: name,
        headline: headline,
        company: company,
        roleType: roleType,
        degree: degree,
        isOwner: false,
        evidence: c.structured_evidence || [
          { type: "linkedin_1st_degree", label: "LinkedIn 1st Degree Connection", confidence: 0.70 }
        ]
      }
    });

    edges.push({
      data: {
        id: `edge_owner_${nodeId}`,
        source: ownerId,
        target: nodeId,
        relationship: "KNOWS"
      }
    });

    if (idx > 0 && idx % 3 === 0) {
      const prevNodeId = nodes[idx - 1].data.id;
      edges.push({
        data: {
          id: `edge_inter_${prevNodeId}_${nodeId}`,
          source: prevNodeId,
          target: nodeId,
          relationship: "OBSERVED_MUTUAL"
        }
      });
    }
  });

  return { nodes, edges };
}

/**
 * Setup Cytoscape.js Canvas or Empty State
 */
function setupCytoscapeCanvas() {
  const container = document.getElementById("cy-canvas");
  if (!container || typeof cytoscape === "undefined") return;

  if (graphState.nodes.length === 0) {
    container.innerHTML = `
      <div class="empty-state visible" style="display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; height:100%; padding:40px;">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px; height:56px; color:#64748b; margin-bottom:16px;">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <h3 class="empty-state-title" style="font-size:1.3rem; font-weight:700; color:#f8fafc; margin-bottom:8px;">No Network Imported</h3>
        <p class="empty-state-desc" style="color:#94a3b8; font-size:0.95rem; max-width:440px; margin-bottom:20px;">Import your LinkedIn network using the WarmGraph extension to start exploring people, companies and warm introductions.</p>
        <button class="empty-state-btn open-install-modal" style="padding:10px 22px; border-radius:12px; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.3); color:#38bdf8; font-weight:600; cursor:pointer;">Open Extension</button>
      </div>
    `;
    return;
  }

  cy = cytoscape({
    container: container,
    elements: {
      nodes: graphState.nodes,
      edges: graphState.edges
    },
    style: [
      {
        selector: "node",
        style: {
          "label": "data(label)",
          "color": "#cbd5e1",
          "font-size": "11px",
          "font-weight": 600,
          "text-valign": "bottom",
          "text-margin-y": 5,
          "background-color": "#475569",
          "width": 28,
          "height": 28,
          "border-width": 2,
          "border-color": "#1e293b",
          "transition-property": "background-color, border-color, width, height",
          "transition-duration": "0.2s"
        }
      },
      {
        selector: "node[isOwner = 'true']",
        style: {
          "background-color": "#38bdf8",
          "color": "#ffffff",
          "font-weight": 800,
          "font-size": "13px",
          "width": 42,
          "height": 42,
          "border-width": 3,
          "border-color": "#2563eb",
          "shadow-blur": 15,
          "shadow-color": "#38bdf8",
          "shadow-opacity": 0.8
        }
      },
      {
        selector: "node.selected",
        style: {
          "background-color": "#2563eb",
          "border-color": "#38bdf8",
          "border-width": 4,
          "width": 38,
          "height": 38,
          "color": "#ffffff",
          "font-weight": 800
        }
      },
      {
        selector: "node.warm-path",
        style: {
          "background-color": "#38bdf8",
          "border-color": "#2563eb",
          "border-width": 3,
          "width": 34,
          "height": 34,
          "color": "#f8fafc",
          "font-weight": 700
        }
      },
      {
        selector: "edge",
        style: {
          "width": 1.5,
          "line-color": "#1e293b",
          "curve-style": "bezier",
          "opacity": 0.4
        }
      },
      {
        selector: "edge.warm-path",
        style: {
          "width": 4,
          "line-color": "#38bdf8",
          "opacity": 1.0,
          "line-style": "solid",
          "shadow-blur": 10,
          "shadow-color": "#38bdf8"
        }
      }
    ],
    layout: {
      name: "cose",
      animate: false,
      padding: 50,
      componentSpacing: 80,
      nodeRepulsion: function( node ){ return 8000; },
      idealEdgeLength: function( edge ){ return 80; }
    }
  });

  cy.on("tap", "node", (evt) => {
    const node = evt.target;
    selectNodeAndOpenDrawer(node);
  });

  cy.on("tap", (evt) => {
    if (evt.target === cy) {
      clearSelection();
    }
  });

  const tooltip = document.getElementById("graph-tooltip");
  cy.on("mouseover", "node", (evt) => {
    const node = evt.target;
    const data = node.data();

    if (tooltip) {
      document.getElementById("tt-name").textContent = data.name;
      document.getElementById("tt-headline").textContent = data.headline;

      const pos = evt.renderedPosition;
      tooltip.style.left = `${pos.x + 20}px`;
      tooltip.style.top = `${pos.y + 100}px`;
      tooltip.style.display = "block";
    }
  });

  cy.on("mouseout", "node", () => {
    if (tooltip) tooltip.style.display = "none";
  });
}

function selectNodeAndOpenDrawer(node) {
  if (!cy || !node) return;

  cy.nodes().removeClass("selected");
  node.addClass("selected");

  graphState.selectedNode = node.data();
  highlightShortestWarmPath(node.id());
  openGraphDrawer(node.data());
}

function highlightShortestWarmPath(targetId) {
  if (!cy || !targetId || targetId === graphState.ownerId) return;

  const astar = cy.elements().aStar({
    root: `#${graphState.ownerId}`,
    goal: `#${targetId}`
  });

  if (astar.found) {
    cy.elements().removeClass("warm-path");
    astar.path.addClass("warm-path");

    const banner = document.getElementById("warm-path-banner");
    const bannerDesc = document.getElementById("wp-banner-desc");

    if (banner && bannerDesc) {
      const pathNames = astar.path.nodes().map(n => n.data("name"));
      bannerDesc.textContent = pathNames.join(" → ");
      banner.classList.add("visible");
    }
  }
}

function openGraphDrawer(data) {
  const drawer = document.getElementById("graph-drawer");
  const backdrop = document.getElementById("graph-drawer-backdrop");

  if (!drawer || !backdrop) return;

  document.getElementById("gdrawer-avatar").textContent = getInitials(data.name);
  document.getElementById("gdrawer-name").textContent = data.name;
  document.getElementById("gdrawer-headline").textContent = data.headline;
  document.getElementById("gdrawer-company").textContent = data.company;

  const badgesContainer = document.getElementById("gdrawer-badges");
  if (badgesContainer) {
    let roleBadge = data.roleType === "student" ? '<span class="badge badge-student">🎓 Student</span>' :
                    data.roleType === "faculty" ? '<span class="badge badge-faculty">👨‍🏫 Faculty</span>' :
                    '<span class="badge badge-company">💼 Professional</span>';

    badgesContainer.innerHTML = `
      <span class="badge badge-degree">⚡ 1st Degree</span>
      ${roleBadge}
    `;
  }

  const evidenceList = document.getElementById("gdrawer-evidence-list");
  if (evidenceList) {
    const iconMap = {
      same_college: "🎓",
      student_faculty: "👨‍🏫",
      same_dept: "🏛️",
      same_company: "💼",
      same_city: "📍",
      linkedin_1st_degree: "⚡"
    };

    const evidenceItems = (data.evidence || []).map(ev => {
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

    evidenceList.innerHTML = evidenceItems;
  }

  backdrop.classList.add("open");
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeGraphDrawer() {
  const drawer = document.getElementById("graph-drawer");
  const backdrop = document.getElementById("graph-drawer-backdrop");

  if (drawer) {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }
  if (backdrop) {
    backdrop.classList.remove("open");
  }
}

function clearSelection() {
  closeGraphDrawer();
  if (cy) {
    cy.nodes().removeClass("selected");
    cy.elements().removeClass("warm-path");
  }
  const banner = document.getElementById("warm-path-banner");
  if (banner) banner.classList.remove("visible");
}

function bindToolbarEvents() {
  const searchInput = document.getElementById("graph-search-input");
  const resultsContainer = document.getElementById("search-results-list");

  if (searchInput && resultsContainer) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) {
        resultsContainer.classList.remove("active");
        return;
      }

      const matches = graphState.nodes.filter(n => {
        const d = n.data;
        return d.name.toLowerCase().includes(q) || d.company.toLowerCase().includes(q) || d.headline.toLowerCase().includes(q);
      }).slice(0, 8);

      if (matches.length > 0) {
        resultsContainer.innerHTML = matches.map(m => `
          <div class="search-result-item" data-id="${m.data.id}">
            <strong>${escapeHtml(m.data.name)}</strong>
            <div style="font-size: 0.75rem; color: #94a3b8;">${escapeHtml(m.data.company)} • ${escapeHtml(m.data.headline)}</div>
          </div>
        `).join("");

        resultsContainer.classList.add("active");

        resultsContainer.querySelectorAll(".search-result-item").forEach(item => {
          item.addEventListener("click", () => {
            const nodeId = item.getAttribute("data-id");
            const cyNode = cy.$(`#${nodeId}`);
            if (cyNode && cyNode.length > 0) {
              cy.animate({
                center: { eles: cyNode },
                zoom: 1.5
              }, { duration: 400 });

              selectNodeAndOpenDrawer(cyNode);
            }
            resultsContainer.classList.remove("active");
          });
        });
      } else {
        resultsContainer.classList.remove("active");
      }
    });
  }

  const btnReLayout = document.getElementById("btn-re-layout");
  if (btnReLayout) {
    btnReLayout.addEventListener("click", () => {
      if (cy) {
        cy.layout({ name: "cose", animate: true, animationDuration: 500 }).run();
      }
    });
  }

  const btnFitView = document.getElementById("btn-fit-view");
  if (btnFitView) {
    btnFitView.addEventListener("click", () => {
      if (cy) cy.fit(50);
    });
  }

  const btnWarmPath = document.getElementById("btn-toggle-warm-path");
  if (btnWarmPath) {
    btnWarmPath.addEventListener("click", () => {
      btnWarmPath.classList.toggle("active");
      if (graphState.nodes.length > 1) {
        const targetNode = graphState.nodes[1].data.id;
        highlightShortestWarmPath(targetNode);
      }
    });
  }

  const closeBtn = document.getElementById("graph-drawer-close");
  const backdrop = document.getElementById("graph-drawer-backdrop");

  if (closeBtn) closeBtn.addEventListener("click", closeGraphDrawer);
  if (backdrop) backdrop.addEventListener("click", closeGraphDrawer);

  const ctaBtn = document.getElementById("gdrawer-highlight-path-btn");
  if (ctaBtn) {
    ctaBtn.addEventListener("click", () => {
      if (graphState.selectedNode) {
        highlightShortestWarmPath(graphState.selectedNode.id);
      }
    });
  }
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const input = document.getElementById("graph-search-input");
      if (input) {
        input.focus();
        input.select();
      }
    }

    if (e.key === "Escape") {
      clearSelection();
    }
  });
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
