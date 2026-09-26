/**
 * WarmGraph Developer — Extraction Dashboard Client (Task 3A)
 * 
 * Premium Internal QA Console for inspecting extraction quality, session health,
 * field completeness, duplicates, relationship evidence, and generating exports.
 * 
 * READ-ONLY: Reuses existing network endpoints & storage without altering backend or DB.
 */

(function () {
  const BACKEND_BASE_URL = "http://127.0.0.1:8000";
  const PAGE_SIZE = 50;

  let rawNetworkData = {
    owner_id: null,
    connections: [],
    relationship_evidence: []
  };

  let sessionMetadata = null;

  let activeFilter = "all";
  let activeSearchQuery = "";
  let currentPage = 1;

  // DOM Elements
  const elMetricConnections = document.getElementById("metricConnections");
  const elMetricEvidence = document.getElementById("metricEvidence");
  const elMetricCompanies = document.getElementById("metricCompanies");
  const elMetricProfiles = document.getElementById("metricProfiles");

  const elQualityComplete = document.getElementById("qualityComplete");
  const elQualityMissingCompany = document.getElementById("qualityMissingCompany");
  const elQualityMissingHeadline = document.getElementById("qualityMissingHeadline");
  const elQualityDuplicates = document.getElementById("qualityDuplicates");

  // Session Summary Elements
  const elSummarySessionId = document.getElementById("summarySessionId");
  const elSummaryStarted = document.getElementById("summaryStarted");
  const elSummaryCompleted = document.getElementById("summaryCompleted");
  const elSummaryDuration = document.getElementById("summaryDuration");
  const elSummaryLastUpdated = document.getElementById("summaryLastUpdated");
  const elSummarySyncStatus = document.getElementById("summarySyncStatus");
  const elSummaryOwner = document.getElementById("summaryOwner");

  const elSearchInput = document.getElementById("searchInput");
  const elTableBody = document.getElementById("tableBody");
  const elFilterChips = document.querySelectorAll(".filter-chip");

  const elPaginationInfo = document.getElementById("paginationInfo");
  const elPageIndicator = document.getElementById("pageIndicator");
  const elBtnPrevPage = document.getElementById("btnPrevPage");
  const elBtnNextPage = document.getElementById("btnNextPage");

  const elInspectorOverlay = document.getElementById("inspectorOverlay");
  const elInspectorClose = document.getElementById("inspectorClose");
  const elInspectorBody = document.getElementById("inspectorBody");

  const elBtnExportJson = document.getElementById("btnExportJson");
  const elBtnExportCsv = document.getElementById("btnExportCsv");
  const elBtnExportSummary = document.getElementById("btnExportSummary");

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

  // Highlight Search Text Match
  function highlightSearchMatch(text, query) {
    const safeText = escapeHtml(text || "");
    if (!query || !query.trim()) return safeText;

    const trimmedQuery = query.trim();
    const regex = new RegExp(`(${trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return safeText.replace(regex, '<mark class="highlight-match">$1</mark>');
  }

  // Utility: Profile URL Normalization Check
  function isValidProfileUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url, "https://www.linkedin.com");
      return u.pathname.includes("/in/");
    } catch {
      return false;
    }
  }

  function normalizeName(name) {
    return (name || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "")
      .trim();
  }

  function normalizeUrl(url) {
    if (!url) return "";
    try {
      const u = new URL(url, "https://www.linkedin.com");
      return u.pathname.replace(/\/$/, "").toLowerCase();
    } catch {
      return (url || "").toLowerCase().trim();
    }
  }

  function formatTimestamp(isoStr) {
    if (!isoStr) return "Unavailable";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString();
    } catch {
      return isoStr;
    }
  }

  function calculateDuration(startedIso, updatedIso) {
    if (!startedIso || !updatedIso) return "Unavailable";
    try {
      const t1 = new Date(startedIso).getTime();
      const t2 = new Date(updatedIso).getTime();
      if (isNaN(t1) || isNaN(t2) || t2 < t1) return "Unavailable";
      const sec = Math.round((t2 - t1) / 1000);
      if (sec < 60) return `${sec}s`;
      const min = Math.floor(sec / 60);
      const remSec = sec % 60;
      return `${min}m ${remSec}s`;
    } catch {
      return "Unavailable";
    }
  }

  // 1. Data Initialization & Loading
  async function init() {
    setupEventListeners();

    let ownerId = new URLSearchParams(window.location.search).get("owner_id");

    if (!ownerId && typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await new Promise(resolve => {
        chrome.storage.local.get(["ownerId"], (res) => {
          if (res && res.ownerId) ownerId = res.ownerId;
          resolve();
        });
      });
    }

    await loadExtractedDataset(ownerId);
  }

  async function loadExtractedDataset(ownerId) {
    let datasetLoaded = false;

    // A. Attempt Backend fetch first if ownerId exists
    const fetchFn = (typeof window !== "undefined" && window.fetch) ? window.fetch : fetch;
    if (ownerId && typeof fetchFn === "function") {
      try {
        const res = await fetchFn(`${BACKEND_BASE_URL}/network/${ownerId}`);
        if (res.ok) {
          const data = await res.json();
          rawNetworkData = {
            owner_id: ownerId,
            connections: data.connections || [],
            relationship_evidence: data.relationship_evidence || []
          };
          sessionMetadata = {
            sessionId: data.session_id || data.sessionId || `session_backend_${ownerId}`,
            startedAt: data.created_at || data.startedAt || null,
            lastUpdated: data.updated_at || data.lastUpdated || null,
            state: data.state || "completed",
            syncStatus: "synced"
          };
          datasetLoaded = true;
        }
      } catch (e) {
        console.warn("[DEVELOPER DASHBOARD] Backend fetch unavailable, trying local storage.", e);
      }
    }

    // B. Fallback to chrome.storage.local acquisition_session
    if (!datasetLoaded && typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await new Promise(resolve => {
        chrome.storage.local.get(["acquisition_session", "ownerId"], (res) => {
          if (res && res.acquisition_session) {
            const sess = res.acquisition_session;
            rawNetworkData = {
              owner_id: ownerId || res.ownerId || sess.sessionId || "local_session",
              connections: sess.collectedConnections || sess.connections || [],
              relationship_evidence: sess.relationshipEvidence || sess.relationship_evidence || []
            };
            sessionMetadata = {
              sessionId: sess.sessionId || "local_session",
              startedAt: sess.startedAt || null,
              lastUpdated: sess.lastUpdated || sess.lastActivity || null,
              state: sess.state || "idle",
              syncStatus: sess.syncStatus || sess.sync_status || "idle"
            };
            datasetLoaded = true;
          }
          resolve();
        });
      });
    }

    renderDashboard();
  }

  // 2. Compute Quality Metrics & Analysis
  function analyzeDataset() {
    const connections = rawNetworkData.connections || [];
    const evidence = rawNetworkData.relationship_evidence || [];

    const nameMap = new Map();
    const urlMap = new Map();
    const duplicateKeys = new Set();

    connections.forEach((c, idx) => {
      const normN = normalizeName(c.name);
      const normU = normalizeUrl(c.profile_url);

      if (normN) {
        if (nameMap.has(normN)) {
          duplicateKeys.add(idx);
          duplicateKeys.add(nameMap.get(normN));
        } else {
          nameMap.set(normN, idx);
        }
      }

      if (normU) {
        if (urlMap.has(normU)) {
          duplicateKeys.add(idx);
          duplicateKeys.add(urlMap.get(normU));
        } else {
          urlMap.set(normU, idx);
        }
      }
    });

    const companySet = new Set();
    const profileSet = new Set();

    let completeCount = 0;
    let missingCompanyCount = 0;
    let missingHeadlineCount = 0;
    let invalidUrlCount = 0;

    const analyzedConnections = connections.map((c, idx) => {
      const resolved = resolveCompanyAndRole(c);
      const name = resolved.cleanName;
      const headline = resolved.cleanHeadline;
      const company = resolved.company !== "—" ? resolved.company : "";
      const roleType = resolved.roleType;
      const profileUrl = (c.profile_url || "").trim();

      if (company) companySet.add(company.toLowerCase());
      const normU = normalizeUrl(profileUrl);
      if (normU) profileSet.add(normU);

      const isValidUrl = isValidProfileUrl(profileUrl);
      const isDuplicate = duplicateKeys.has(idx);

      const hasCompany = !!company && company !== "—";
      const hasHeadline = !!headline && headline !== "—";
      const isComplete = !!name && hasHeadline && hasCompany && isValidUrl;

      if (isComplete) completeCount++;
      if (!hasCompany) missingCompanyCount++;
      if (!hasHeadline) missingHeadlineCount++;
      if (!isValidUrl) invalidUrlCount++;

      // Check evidence association
      const hasEvidence = evidence.some(e => {
        return (
          (e.profile_url && profileUrl && normalizeUrl(e.profile_url) === normU) ||
          (e.name && name && normalizeName(e.name) === normalizeName(name))
        );
      });

      return {
        ...c,
        rawIndex: idx,
        name,
        headline,
        parsedCompany: resolved.company,
        roleType,
        isValidUrl,
        isDuplicate,
        isComplete,
        hasCompany,
        hasHeadline,
        hasEvidence
      };
    });

    return {
      analyzedConnections,
      totalConnections: connections.length,
      totalEvidence: evidence.length,
      companiesCount: companySet.size,
      profilesCount: profileSet.size,
      completeCount,
      missingCompanyCount,
      missingHeadlineCount,
      duplicatesCount: duplicateKeys.size,
      invalidUrlCount
    };
  }

  // Company Normalization & Parsing Engine (Task 9.3)
  function normalizeCompany(companyStr) {
    if (!companyStr) return null;
    let str = String(companyStr).trim();
    if (!str || str === "—" || str === "N/A" || str.toLowerCase() === "null" || str.toLowerCase() === "undefined") return null;

    const upper = str.toUpperCase();
    if (upper === "GAT" || upper.includes("GLOBAL ACADEMY OF TECH")) {
      return "Global Academy of Technology";
    }
    if (upper === "HPE" || upper.includes("HEWLETT PACKARD")) {
      return "Hewlett Packard Enterprise";
    }
    if (upper === "MSFT" || upper.includes("MICROSOFT CORP")) {
      return "Microsoft";
    }
    if (upper === "SISA" || upper.includes("SISA INFORMATION")) {
      return "SISA";
    }
    return str;
  }

  function extractCompanyFromText(text) {
    if (!text) return null;
    const str = String(text);

    if (/Global Academy of Technology|\bGAT\b/i.test(str)) {
      return "Global Academy of Technology";
    }
    if (/Hewlett Packard Enterprise|\bHPE\b/i.test(str)) {
      return "Hewlett Packard Enterprise";
    }
    if (/Microsoft|\bMSFT\b/i.test(str)) {
      return "Microsoft";
    }
    if (/\bSISA\b/i.test(str)) {
      return "SISA";
    }

    const match = str.match(/(?:at|@|\||,)\s*([A-Za-z0-9\s&]{3,40})/i);
    if (match) {
      const candidate = match[1].trim();
      if (!/student|professor|faculty|dean|engineer|developer|manager|bangalore/i.test(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function isPersonName(text, personName) {
    if (!text || !personName) return false;
    const norm1 = (text || "").toLowerCase().replace(/[^\w]/g, "");
    const norm2 = (personName || "").toLowerCase().replace(/[^\w]/g, "");
    return norm1 === norm2 || (norm1.length > 3 && norm2.includes(norm1));
  }

  function resolveCompanyAndRole(c) {
    let rawName = (c.name || "").trim();
    let rawHeadline = (c.headline || c.occupation || "").trim();

    // Swap detection if name contains job title keywords while headline looks like a person name
    const titleRegex = /\b(Dean|Associate Dean|Professor|Assistant Professor|HOD|Lecturer|Placement Officer|Student|Engineer|Developer|Manager|Analyst)\b/i;
    if (titleRegex.test(rawName) && !titleRegex.test(rawHeadline) && rawHeadline.length > 0) {
      const tmp = rawName;
      rawName = rawHeadline;
      rawHeadline = tmp;
    }

    // Resolution Priority:
    // current_company ?? company ?? organization ?? experience.current_company ?? parsed_company ?? extractCompany(headline) ?? extractCompany(education) ?? "—"
    let candidate = 
      c.current_company ||
      c.company ||
      c.organization ||
      (c.experience && (c.experience.current_company || c.experience.company)) ||
      c.parsed_company ||
      extractCompanyFromText(rawHeadline) ||
      extractCompanyFromText(c.education) ||
      null;

    // Never use person's name as company!
    if (candidate && rawName && isPersonName(candidate, rawName)) {
      candidate = extractCompanyFromText(rawHeadline) || extractCompanyFromText(c.education) || null;
    }

    let normalizedCompany = normalizeCompany(candidate);

    // Faculty Parser
    const facultyRegex = /\b(Dean|Associate Dean|Professor|Assistant Professor|HOD|Lecturer|Placement Officer)\b/i;
    const isFaculty = facultyRegex.test(rawHeadline) || facultyRegex.test(rawName);

    // Student Parser
    const studentRegex = /\b(Student|Undergraduate|Pursuing|Intern|B\.E\.|BTech|MTech|AIML Student)\b/i;
    const isStudent = studentRegex.test(rawHeadline) || studentRegex.test(rawName);

    let roleType = "Professional";

    if (isFaculty) {
      roleType = "Faculty";
      if (/\b(Global Academy of Technology|GAT|Bangalore|Placements)\b/i.test(rawHeadline) || !normalizedCompany) {
        if (!normalizedCompany || normalizedCompany === "—" || /Bangalore|Placements/i.test(normalizedCompany)) {
          normalizedCompany = "Global Academy of Technology";
        }
      }
    } else if (isStudent) {
      roleType = "Student";
      if (/\b(Global Academy of Technology|GAT)\b/i.test(rawHeadline) || !normalizedCompany) {
        if (!normalizedCompany || normalizedCompany === "—") {
          normalizedCompany = "Global Academy of Technology";
        }
      }
    } else {
      // Professional Parser check
      if (/\b(HPE|Hewlett Packard)\b/i.test(rawHeadline)) {
        normalizedCompany = "Hewlett Packard Enterprise";
      } else if (/\b(MSFT|Microsoft)\b/i.test(rawHeadline)) {
        normalizedCompany = "Microsoft";
      } else if (/\bSISA\b/i.test(rawHeadline)) {
        normalizedCompany = "SISA";
      }
    }

    if (!normalizedCompany) {
      normalizedCompany = "—";
    } else {
      normalizedCompany = normalizeCompany(normalizedCompany) || normalizedCompany;
    }

    let cleanHeadline = rawHeadline;
    if (roleType === "Faculty" && cleanHeadline.includes("Global Academy of Technology")) {
      cleanHeadline = cleanHeadline.replace(/Global Academy of Technology.*$/i, "").trim();
      if (!cleanHeadline) cleanHeadline = rawHeadline;
    }

    return {
      cleanName: rawName || "Unknown Name",
      cleanHeadline: cleanHeadline || rawHeadline || "—",
      company: normalizedCompany,
      roleType
    };
  }

  function parseCompanyFromHeadline(headline) {
    return extractCompanyFromText(headline);
  }

  // 3. Render Dashboard UI
  function renderDashboard() {
    const analysis = analyzeDataset();

    // Metrics Cards
    elMetricConnections.textContent = analysis.totalConnections;
    elMetricEvidence.textContent = analysis.totalEvidence;
    elMetricCompanies.textContent = analysis.companiesCount;
    elMetricProfiles.textContent = analysis.profilesCount;

    // Visual Health Cards
    elQualityComplete.textContent = analysis.completeCount;
    elQualityMissingCompany.textContent = analysis.missingCompanyCount;
    elQualityMissingHeadline.textContent = analysis.missingHeadlineCount;
    elQualityDuplicates.textContent = analysis.duplicatesCount;

    // Network Session Summary
    const sess = sessionMetadata || {};
    elSummarySessionId.textContent = sess.sessionId || "Unavailable";
    elSummaryStarted.textContent = formatTimestamp(sess.startedAt);
    elSummaryCompleted.textContent = sess.state === "completed" ? "Complete ✓" : (sess.state || "Unavailable");
    elSummaryDuration.textContent = calculateDuration(sess.startedAt, sess.lastUpdated);
    elSummaryLastUpdated.textContent = formatTimestamp(sess.lastUpdated);
    elSummarySyncStatus.textContent = sess.syncStatus || "idle";
    elSummaryOwner.textContent = rawNetworkData.owner_id || "Unavailable";

    // Filter connections
    const query = activeSearchQuery.toLowerCase().trim();

    const filtered = analysis.analyzedConnections.filter(item => {
      if (query) {
        const name = (item.name || "").toLowerCase();
        const comp = (item.parsedCompany || "").toLowerCase();
        const head = (item.headline || item.occupation || "").toLowerCase();
        const url = (item.profile_url || "").toLowerCase();
        const matchSearch = name.includes(query) || comp.includes(query) || head.includes(query) || url.includes(query);
        if (!matchSearch) return false;
      }

      switch (activeFilter) {
        case "complete":
          return item.isComplete;
        case "missing_company":
          return !item.hasCompany;
        case "missing_headline":
          return !item.hasHeadline;
        case "duplicates":
          return item.isDuplicate;
        case "has_evidence":
          return item.hasEvidence;
        case "invalid_url":
          return !item.isValidUrl;
        case "all":
        default:
          return true;
      }
    });

    // Pagination bounds logic
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);
    const paginatedItems = filtered.slice(startIndex, endIndex);

    // Update Pagination Bar
    if (totalItems > 0) {
      elPaginationInfo.textContent = `Showing ${startIndex + 1}–${endIndex} of ${totalItems} records`;
    } else {
      elPaginationInfo.textContent = `Showing 0–0 of 0 records`;
    }
    elPageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
    elBtnPrevPage.disabled = currentPage <= 1;
    elBtnNextPage.disabled = currentPage >= totalPages;

    renderTable(paginatedItems, query);
  }

  // 4. Render Table Rows
  function renderTable(connections, searchQuery) {
    if (connections.length === 0) {
      elTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">
            No extracted connection records match the selected criteria.
          </td>
        </tr>
      `;
      return;
    }

    elTableBody.innerHTML = connections.map(item => {
      let statusBadge = "";
      if (item.isComplete) {
        statusBadge = `<span class="status-badge badge-complete">✓ Complete</span>`;
      } else {
        const badges = [];
        if (item.isDuplicate) badges.push(`<span class="status-badge badge-danger">⚠ Duplicate</span>`);
        if (!item.isValidUrl) badges.push(`<span class="status-badge badge-danger">⚠ Invalid URL</span>`);
        if (!item.hasCompany) badges.push(`<span class="status-badge badge-warning">⚠ Missing Company</span>`);
        if (!item.hasHeadline) badges.push(`<span class="status-badge badge-warning">⚠ Missing Headline</span>`);
        statusBadge = badges.join(" ");
      }

      const highlightedName = highlightSearchMatch(item.name || "Unknown Name", searchQuery);
      const highlightedCompany = highlightSearchMatch(item.parsedCompany || "—", searchQuery);
      const highlightedHeadline = highlightSearchMatch(item.headline || item.occupation || "—", searchQuery);

      return `
        <tr data-index="${item.rawIndex}">
          <td class="record-name">${highlightedName}</td>
          <td class="company-cell">
            <div class="company-name-text">${highlightedCompany}</div>
            <div class="company-role-text">${escapeHtml(item.roleType || "Professional")}</div>
          </td>
          <td>${highlightedHeadline}</td>
          <td><span class="status-badge" style="background:#f1f5f9; color:#475569;">${escapeHtml(item.degree || "1st")}</span></td>
          <td>${statusBadge}</td>
          <td>
            ${item.profile_url ? `
              <a class="btn-profile-chip" href="${escapeHtml(item.profile_url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();">
                <span>View</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
            ` : "—"}
          </td>
        </tr>
      `;
    }).join("");

    // Attach Row Inspector Click Listeners
    elTableBody.querySelectorAll("tr[data-index]").forEach(tr => {
      tr.addEventListener("click", () => {
        const idx = parseInt(tr.getAttribute("data-index"), 10);
        openRowInspector(idx);
      });
    });
  }

  // 5. Row Inspector Drawer
  function openRowInspector(rawIndex) {
    const connections = rawNetworkData.connections || [];
    const evidence = rawNetworkData.relationship_evidence || [];
    const record = connections[rawIndex];

    if (!record) return;

    const normN = normalizeName(record.name);
    const normU = normalizeUrl(record.profile_url);

    const matchingEvidence = evidence.filter(e => {
      return (
        (e.profile_url && normalizeUrl(e.profile_url) === normU) ||
        (e.name && normalizeName(e.name) === normN)
      );
    });

    let evidenceHtml = `<p style="font-size:12px; color:#64748b;">No direct relationship evidence extracted for this record.</p>`;
    if (matchingEvidence.length > 0) {
      evidenceHtml = matchingEvidence.map(e => `
        <div style="padding:10px; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:8px; background:#f8fafc; font-size:12px;">
          <div><strong>Observed Degree:</strong> ${escapeHtml(e.observed_degree || "2nd")} (${escapeHtml(e.evidence_type || "relationship")})</div>
          ${e.mutual_connections_text ? `<div><strong>Mutual Connections:</strong> ${escapeHtml(e.mutual_connections_text)}</div>` : ""}
          ${e.location ? `<div><strong>Location:</strong> ${escapeHtml(e.location)}</div>` : ""}
          ${e.followers ? `<div><strong>Followers:</strong> ${escapeHtml(e.followers)}</div>` : ""}
        </div>
      `).join("");
    }

    const company = record.company || record.experience_company || parseCompanyFromHeadline(record.headline) || "N/A";

    elInspectorBody.innerHTML = `
      <!-- Person Section -->
      <div class="inspector-section">
        <div class="section-heading">Person</div>
        <div class="field-row">
          <div class="field-label">Name</div>
          <div class="field-value" style="font-weight:700; font-size:15px; color:#0f172a;">${escapeHtml(record.name || "N/A")}</div>
        </div>
        <div class="field-row">
          <div class="field-label">Headline</div>
          <div class="field-value">${escapeHtml(record.headline || record.occupation || "N/A")}</div>
        </div>
        <div class="field-row">
          <div class="field-label">Company</div>
          <div class="field-value">${escapeHtml(company)}</div>
        </div>
        <div class="field-row">
          <div class="field-label">Degree</div>
          <div class="field-value">${escapeHtml(record.degree || "1st")}</div>
        </div>
        <div class="field-row">
          <div class="field-label">LinkedIn Profile</div>
          <div class="field-value">
            ${record.profile_url ? `<a class="btn-profile-link" href="${escapeHtml(record.profile_url)}" target="_blank" rel="noopener noreferrer">Open Profile ↗</a>` : "N/A"}
          </div>
        </div>
      </div>

      <!-- Relationship Evidence Section -->
      <div class="inspector-section">
        <div class="section-heading">Relationship Evidence (${matchingEvidence.length})</div>
        ${evidenceHtml}
      </div>

      <!-- Extraction Metadata Section -->
      <div class="inspector-section">
        <div class="section-heading">Extraction Metadata</div>
        <div class="field-row">
          <div class="field-label">Provider</div>
          <div class="field-value">${escapeHtml(record.source || "linkedin_dom")}</div>
        </div>
        <div class="field-row">
          <div class="field-label">Normalized URL</div>
          <div class="field-value">${escapeHtml(normU || "N/A")}</div>
        </div>
        <div class="field-row">
          <div class="field-label">Connection Date</div>
          <div class="field-value">${escapeHtml(record.connection_date || "N/A")}</div>
        </div>
      </div>

      <!-- Collapsible Raw JSON -->
      <details class="json-details">
        <summary class="json-summary">Raw JSON (Debug)</summary>
        <pre class="json-code">${escapeHtml(JSON.stringify(record, null, 2))}</pre>
      </details>
    `;

    elInspectorOverlay.style.display = "flex";
  }

  function closeRowInspector() {
    elInspectorOverlay.style.display = "none";
  }

  // 6. Export Functions
  function exportJson() {
    const analysis = analyzeDataset();
    const exportObj = {
      owner_id: rawNetworkData.owner_id || "unknown_owner",
      exported_at: new Date().toISOString(),
      summary: {
        total_connections: analysis.totalConnections,
        total_evidence: analysis.totalEvidence,
        complete_records: analysis.completeCount,
        missing_company: analysis.missingCompanyCount,
        missing_headline: analysis.missingHeadlineCount,
        duplicate_candidates: analysis.duplicatesCount,
        invalid_urls: analysis.invalidUrlCount
      },
      connections: rawNetworkData.connections || [],
      relationship_evidence: rawNetworkData.relationship_evidence || []
    };

    downloadDataUri("data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2)), `warmgraph_extracted_network_${Date.now()}.json`);
  }

  function exportCsv() {
    const connections = rawNetworkData.connections || [];
    if (connections.length === 0) {
      alert("No extracted connections available to export.");
      return;
    }

    const headers = ["Name", "Company", "Headline", "Degree", "Profile URL", "Connection Date", "Source"];
    const rows = connections.map(c => {
      const company = c.company || parseCompanyFromHeadline(c.headline) || "";
      return [
        `"${(c.name || "").replace(/"/g, '""')}"`,
        `"${company.replace(/"/g, '""')}"`,
        `"${(c.headline || c.occupation || "").replace(/"/g, '""')}"`,
        `"${(c.degree || "1st").replace(/"/g, '""')}"`,
        `"${(c.profile_url || "").replace(/"/g, '""')}"`,
        `"${(c.connection_date || "").replace(/"/g, '""')}"`,
        `"${(c.source || "linkedin_dom").replace(/"/g, '""')}"`
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    downloadDataUri(encodeURI(csvContent), `warmgraph_extracted_network_${Date.now()}.csv`);
  }

  function exportSummaryJson() {
    const analysis = analyzeDataset();
    const sess = sessionMetadata || {};

    const summaryExport = {
      export_type: "warmgraph_qa_summary",
      generated_at: new Date().toISOString(),
      session_summary: {
        session_id: sess.sessionId || "Unavailable",
        started: sess.startedAt || "Unavailable",
        completed: sess.state === "completed" ? "Yes" : (sess.state || "Unavailable"),
        duration: calculateDuration(sess.startedAt, sess.lastUpdated),
        last_updated: sess.lastUpdated || "Unavailable",
        sync_status: sess.syncStatus || "idle",
        owner: rawNetworkData.owner_id || "Unavailable"
      },
      qa_metrics: {
        total_connections: analysis.totalConnections,
        total_relationship_evidence: analysis.totalEvidence,
        unique_companies: analysis.companiesCount,
        unique_profiles: analysis.profilesCount,
        complete_records: analysis.completeCount,
        missing_company: analysis.missingCompanyCount,
        missing_headline: analysis.missingHeadlineCount,
        duplicate_candidates: analysis.duplicatesCount,
        invalid_profile_urls: analysis.invalidUrlCount
      },
      graph_readiness: {
        is_graph_ready: analysis.completeCount > 0 && analysis.totalConnections >= 1,
        completeness_ratio: analysis.totalConnections > 0 ? (analysis.completeCount / analysis.totalConnections).toFixed(2) : 0
      }
    };

    downloadDataUri("data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(summaryExport, null, 2)), `warmgraph_qa_summary_${Date.now()}.json`);
  }

  function downloadDataUri(dataUri, fileName) {
    if (typeof document === "undefined") return;
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", dataUri);
    dlAnchor.setAttribute("download", fileName);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  }

  // 7. Event Listeners Setup
  function setupEventListeners() {
    elSearchInput.addEventListener("input", (e) => {
      activeSearchQuery = e.target.value;
      currentPage = 1;
      renderDashboard();
    });

    elFilterChips.forEach(chip => {
      chip.addEventListener("click", () => {
        elFilterChips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        activeFilter = chip.getAttribute("data-filter");
        currentPage = 1;
        renderDashboard();
      });
    });

    elBtnPrevPage.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        renderDashboard();
      }
    });

    elBtnNextPage.addEventListener("click", () => {
      currentPage++;
      renderDashboard();
    });

    elInspectorClose.addEventListener("click", closeRowInspector);
    elInspectorOverlay.addEventListener("click", (e) => {
      if (e.target === elInspectorOverlay) closeRowInspector();
    });

    elBtnExportJson.addEventListener("click", exportJson);
    elBtnExportCsv.addEventListener("click", exportCsv);
    elBtnExportSummary.addEventListener("click", exportSummaryJson);
  }

  // Initialize on DOM load
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
