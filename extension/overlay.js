/**
 * WarmGraph Non-Interruptive Acquisition Overlay Component (Task 2F)
 * 
 * Provides a clean, polished SaaS overlay UI on LinkedIn connection pages.
 * OBSERVES existing acquisition session state from chrome.storage.local and
 * content script session updates without modifying acquisition or sync logic.
 */

(function () {
  if (typeof window === "undefined") return;

  // Prevent multiple script initializations
  if (window.WarmGraphOverlay) return;

  // Inject Overlay CSS Styles
  function injectStyles() {
    if (document.getElementById("warmgraph-overlay-styles")) return;

    const style = document.createElement("style");
    style.id = "warmgraph-overlay-styles";
    style.textContent = `
      .warmgraph-overlay-container {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #0f172a;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        box-sizing: border-box;
      }

      .warmgraph-overlay-container * {
        box-sizing: border-box;
      }

      /* Expanded Overlay Card */
      .warmgraph-overlay-card {
        width: 360px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        box-shadow: 0 12px 32px -4px rgba(15, 23, 42, 0.15), 0 4px 12px -2px rgba(15, 23, 42, 0.08);
        pointer-events: auto;
        overflow: hidden;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }

      /* Header / Drag Bar */
      .warmgraph-overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        background: #f8fafc;
        border-bottom: 1px solid #f1f5f9;
        cursor: grab;
      }

      .warmgraph-overlay-header:active {
        cursor: grabbing;
      }

      .warmgraph-brand {
        display: flex;
        align-items: center;
        gap: 7px;
        font-weight: 700;
        font-size: 14px;
        color: #0f172a;
        letter-spacing: -0.2px;
      }

      .warmgraph-logo {
        font-size: 15px;
        color: #0A66C2;
      }

      .warmgraph-header-controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .warmgraph-icon-btn {
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: #64748b;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        padding: 0;
        line-height: 1;
      }

      .warmgraph-icon-btn:hover {
        background: #e2e8f0;
        color: #0f172a;
      }

      /* Body Content */
      .warmgraph-overlay-body {
        padding: 18px 18px 16px;
      }

      .warmgraph-badge-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .warmgraph-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border-radius: 20px;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        color: #0A66C2;
        font-size: 11px;
        font-weight: 600;
      }

      .warmgraph-overlay-title {
        font-size: 17px;
        font-weight: 700;
        color: #0f172a;
        margin: 0 0 6px 0;
        letter-spacing: -0.3px;
        line-height: 1.3;
      }

      .warmgraph-overlay-desc {
        font-size: 12px;
        color: #475569;
        margin: 0 0 16px 0;
        line-height: 1.45;
      }

      /* Connection Count Display */
      .warmgraph-count-box {
        text-align: center;
        padding: 14px 12px;
        background: #f8fafc;
        border: 1px solid #f1f5f9;
        border-radius: 12px;
        margin-bottom: 14px;
      }

      .warmgraph-count-number {
        font-size: 38px;
        font-weight: 800;
        color: #0f172a;
        line-height: 1.0;
        letter-spacing: -1.2px;
        margin-bottom: 4px;
      }

      .warmgraph-count-label {
        font-size: 12px;
        font-weight: 600;
        color: #64748b;
        text-transform: lowercase;
      }

      .warmgraph-subcount {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 3px;
        font-weight: 500;
      }

      /* Progress Bar */
      .warmgraph-progress-container {
        width: 100%;
        height: 6px;
        background: #e2e8f0;
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 14px;
      }

      .warmgraph-progress-bar {
        width: 0%;
        height: 100%;
        background: #0A66C2;
        border-radius: 3px;
        transition: width 0.35s ease;
      }

      /* Checklist / Activity Items */
      .warmgraph-activity-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 14px;
        background: #ffffff;
      }

      .warmgraph-activity-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: #334155;
        font-weight: 500;
      }

      .warmgraph-activity-item.done {
        color: #059669;
      }

      .warmgraph-activity-item.active {
        color: #0A66C2;
        font-weight: 600;
      }

      .warmgraph-activity-icon {
        font-size: 13px;
        width: 16px;
        text-align: center;
      }

      /* Reassurance Copy */
      .warmgraph-reassurance {
        font-size: 11px;
        color: #64748b;
        line-height: 1.4;
        background: #f0f7ff;
        border: 1px solid #dbeafe;
        border-radius: 8px;
        padding: 9px 11px;
        margin: 0 0 14px 0;
      }

      /* Primary CTA */
      .warmgraph-cta-btn {
        width: 100%;
        padding: 10px 14px;
        background: #0A66C2;
        color: #ffffff;
        border: none;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(10, 102, 194, 0.25);
        transition: background 0.15s ease, transform 0.1s ease;
        margin-bottom: 12px;
      }

      .warmgraph-cta-btn:hover {
        background: #084e96;
      }

      .warmgraph-cta-btn:active {
        transform: scale(0.98);
      }

      /* Divider & Details */
      .warmgraph-divider {
        height: 1px;
        background: #e2e8f0;
        margin: 12px 0 10px 0;
      }

      .warmgraph-why-details {
        font-size: 11px;
        color: #64748b;
      }

      .warmgraph-why-summary {
        cursor: pointer;
        font-weight: 600;
        color: #475569;
        margin-bottom: 4px;
        outline: none;
      }

      .warmgraph-why-summary:hover {
        color: #0A66C2;
      }

      .warmgraph-why-text {
        margin: 6px 0 0 0;
        line-height: 1.4;
        color: #64748b;
      }

      /* Minimized Pill View */
      .warmgraph-overlay-pill {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 24px;
        box-shadow: 0 6px 20px rgba(15, 23, 42, 0.12);
        cursor: pointer;
        pointer-events: auto;
        font-weight: 600;
        font-size: 13px;
        color: #0f172a;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }

      .warmgraph-overlay-pill:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
      }

      .warmgraph-pill-count {
        color: #0A66C2;
        font-weight: 700;
      }

      .warmgraph-pill-dot {
        color: #cbd5e1;
      }

      .warmgraph-sync-badge {
        font-size: 11px;
        font-weight: 600;
        margin-bottom: 10px;
        padding: 4px 8px;
        border-radius: 6px;
        display: inline-block;
      }

      .warmgraph-sync-synced {
        background: #f0fdf4;
        color: #166534;
        border: 1px solid #bbf7d0;
      }

      .warmgraph-sync-pending {
        background: #fffbeb;
        color: #92400e;
        border: 1px solid #fde68a;
      }
    `;

    document.head.appendChild(style);
  }

  // State mapping helper
  function getMappedStateData(status) {
    if (!status) {
      return {
        stateKey: "idle",
        badgeText: "● Network Idle",
        title: "Preparing your network",
        desc: "WarmGraph is getting your connection page ready so it can build your personal network map.",
        activities: [{ icon: "◉", text: "Preparing connection map", status: "active" }],
        showReassurance: true,
        showCta: false,
        syncBadgeText: null
      };
    }

    const state = status.state || "idle";
    const collected = status.collected_count !== undefined ? status.collected_count : (status.connections ? status.connections.length : 0);
    const expected = status.expected_total || status.reliable_dom_total || 0;
    const syncStatus = status.sync_status || status.syncStatus || "idle";
    const isError = state === "failed" || state === "error" || (status.error && status.error.length > 0);

    if (isError) {
      return {
        stateKey: "error",
        badgeText: "⚠️ Interrupted",
        title: "Something interrupted your network",
        desc: "WarmGraph couldn't continue collecting your connections.",
        activities: [{ icon: "⚠️", text: "Collection interrupted", status: "active" }],
        showReassurance: false,
        showCta: false,
        syncBadgeText: null
      };
    }

    switch (state) {
      case "preparing":
        return {
          stateKey: "preparing",
          badgeText: "● Preparing",
          title: "Preparing your network",
          desc: "WarmGraph is getting your connection page ready so it can build your personal network map.",
          activities: [
            { icon: "◉", text: "Preparing connection map", status: "active" }
          ],
          showReassurance: true,
          showCta: false,
          syncBadgeText: null
        };

      case "acquiring":
      case "collecting":
      case "resumed":
        return {
          stateKey: "collecting",
          badgeText: "● Building network",
          title: "Building your network",
          desc: "We're organizing your professional connections so you can discover warm introductions later.",
          activities: [
            { icon: "✓", text: "Reading connections", status: "done" },
            { icon: "✓", text: "Organizing your network", status: "done" },
            { icon: "◉", text: "Loading more connections...", status: "active" }
          ],
          showReassurance: true,
          showCta: false,
          syncBadgeText: null
        };

      case "waiting":
      case "waiting_for_content":
        return {
          stateKey: "waiting",
          badgeText: "● Waiting for content",
          title: "Loading more connections",
          desc: "WarmGraph is waiting for the next part of your network to appear.",
          activities: [
            { icon: "✓", text: "Reading connections", status: "done" },
            { icon: "✓", text: "Organizing your network", status: "done" },
            { icon: "◉", text: "Waiting for next connections...", status: "active" }
          ],
          showReassurance: true,
          showCta: false,
          syncBadgeText: null
        };

      case "settling":
        return {
          stateKey: "settling",
          badgeText: "● Finishing up",
          title: "Finishing your network",
          desc: "We're checking the connections we've collected and making sure your network is complete.",
          activities: [
            { icon: "✓", text: "Connections collected", status: "done" },
            { icon: "✓", text: "Duplicates checked", status: "done" },
            { icon: "◉", text: "Final network check...", status: "active" }
          ],
          showReassurance: true,
          showCta: false,
          syncBadgeText: null
        };

      case "paused":
      case "interrupted":
        return {
          stateKey: "interrupted",
          badgeText: "⏸ Saved",
          title: "We'll continue when you're back",
          desc: "Your network collection was interrupted. WarmGraph has saved your progress and will continue when the Connections page is available again.",
          activities: [
            { icon: "✓", text: "Progress saved", status: "done" },
            { icon: "⏸", text: "Collection paused", status: "active" }
          ],
          showReassurance: false,
          showCta: false,
          syncBadgeText: null
        };

      case "completed":
        let syncBadge = null;
        if (syncStatus === "synced") {
          syncBadge = { text: "✓ Saved to WarmGraph", type: "synced" };
        } else if (syncStatus === "syncing") {
          syncBadge = { text: "● Saving to WarmGraph...", type: "pending" };
        } else if (syncStatus === "failed" || syncStatus === "blocked") {
          syncBadge = { text: "⚠️ Network saved locally (Sync pending)", type: "pending" };
        }

        return {
          stateKey: "completed",
          badgeText: "✨ Network Ready",
          title: "Your network is ready ✨",
          desc: "Your professional network has been added to WarmGraph. Next, you can search for a person or company and discover warm paths through your network.",
          activities: [
            { icon: "✓", text: "Connections collected", status: "done" },
            { icon: "✓", text: "Duplicates checked", status: "done" },
            { icon: "✓", text: "Network ready", status: "done" }
          ],
          showReassurance: false,
          showCta: true,
          syncBadgeText: syncBadge
        };

      case "idle":
      default:
        if (collected > 0) {
          let syncBadgeIdle = null;
          if (syncStatus === "synced") {
            syncBadgeIdle = { text: "✓ Saved to WarmGraph", type: "synced" };
          } else {
            syncBadgeIdle = { text: "⚠️ Local session active", type: "pending" };
          }
          return {
            stateKey: "completed",
            badgeText: "✨ Network Ready",
            title: "Your network is ready ✨",
            desc: "Your professional network has been added to WarmGraph.",
            activities: [
              { icon: "✓", text: "Connections catalogued", status: "done" }
            ],
            showReassurance: false,
            showCta: true,
            syncBadgeText: syncBadgeIdle
          };
        }

        return {
          stateKey: "idle",
          badgeText: "● Ready",
          title: "Preparing your network",
          desc: "WarmGraph is getting your connection page ready so it can build your personal network map.",
          activities: [{ icon: "◉", text: "Preparing connection map", status: "active" }],
          showReassurance: true,
          showCta: false,
          syncBadgeText: null
        };
    }
  }

  class WarmGraphOverlayManager {
    constructor() {
      this.isMinimized = false;
      this.isHiddenByUser = false;
      this.currentStatus = null;
      this.container = null;
      this.cardEl = null;
      this.pillEl = null;
      this.isDragging = false;
      this.dragOffset = { x: 0, y: 0 };

      this.init();
    }

    init() {
      if (typeof document === "undefined" || !document.body) {
        if (typeof document !== "undefined") {
          document.addEventListener("DOMContentLoaded", () => this.init());
        }
        return;
      }

      injectStyles();
      this.createDOM();
      this.attachEventListeners();
      this.observeSessionState();
    }

    createDOM() {
      if (document.getElementById("warmgraph-overlay-container")) {
        this.container = document.getElementById("warmgraph-overlay-container");
        this.cardEl = document.getElementById("warmgraph-overlay-card");
        this.pillEl = document.getElementById("warmgraph-overlay-pill");
        return;
      }

      const container = document.createElement("div");
      container.id = "warmgraph-overlay-container";
      container.className = "warmgraph-overlay-container";

      container.innerHTML = `
        <div id="warmgraph-overlay-card" class="warmgraph-overlay-card">
          <div id="warmgraph-overlay-header" class="warmgraph-overlay-header">
            <div class="warmgraph-brand">
              <span class="warmgraph-logo">✨</span>
              <span>WarmGraph</span>
            </div>
            <div class="warmgraph-header-controls">
              <button id="warmgraph-btn-minimize" class="warmgraph-icon-btn" title="Minimize">—</button>
              <button id="warmgraph-btn-close" class="warmgraph-icon-btn" title="Close">×</button>
            </div>
          </div>

          <div class="warmgraph-overlay-body">
            <div class="warmgraph-badge-bar">
              <span id="warmgraph-status-pill" class="warmgraph-status-pill">● Building network</span>
            </div>

            <h3 id="warmgraph-overlay-title" class="warmgraph-overlay-title">Building your network</h3>

            <p id="warmgraph-overlay-desc" class="warmgraph-overlay-desc">
              We're organizing your professional connections so you can discover warm introductions later.
            </p>

            <div class="warmgraph-count-box">
              <div id="warmgraph-overlay-count" class="warmgraph-count-number">0</div>
              <div id="warmgraph-overlay-count-label" class="warmgraph-count-label">connections</div>
              <div id="warmgraph-overlay-subcount" class="warmgraph-subcount"></div>
            </div>

            <div id="warmgraph-progress-container" class="warmgraph-progress-container">
              <div id="warmgraph-progress-bar" class="warmgraph-progress-bar"></div>
            </div>

            <div id="warmgraph-activity-list" class="warmgraph-activity-list"></div>

            <div id="warmgraph-sync-badge-container"></div>

            <p id="warmgraph-reassurance" class="warmgraph-reassurance">
              You can continue browsing LinkedIn normally. WarmGraph will keep working in the background.
            </p>

            <div id="warmgraph-cta-container" style="display: none;">
              <button id="warmgraph-btn-open-workspace" class="warmgraph-cta-btn">Open My Network</button>
            </div>

            <div class="warmgraph-divider"></div>

            <details class="warmgraph-why-details">
              <summary class="warmgraph-why-summary">Why we're doing this</summary>
              <p class="warmgraph-why-text">
                WarmGraph builds a map of your professional network so that later, when you research a company or person, it can identify people who may provide a warm introduction.
              </p>
            </details>
          </div>
        </div>

        <div id="warmgraph-overlay-pill" class="warmgraph-overlay-pill" style="display: none;">
          <span class="warmgraph-logo">✨</span>
          <span>WarmGraph</span>
          <span class="warmgraph-pill-dot">•</span>
          <span id="warmgraph-pill-count" class="warmgraph-pill-count">0 connections</span>
        </div>
      `;

      document.body.appendChild(container);

      this.container = container;
      this.cardEl = container.querySelector("#warmgraph-overlay-card");
      this.pillEl = container.querySelector("#warmgraph-overlay-pill");

      // Hide by default until session status is received
      this.container.style.display = "none";
    }

    attachEventListeners() {
      if (!this.container) return;

      const minBtn = this.container.querySelector("#warmgraph-btn-minimize");
      const closeBtn = this.container.querySelector("#warmgraph-btn-close");
      const pill = this.pillEl;
      const ctaBtn = this.container.querySelector("#warmgraph-btn-open-workspace");
      const header = this.container.querySelector("#warmgraph-overlay-header");

      if (minBtn) {
        minBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.minimize();
        });
      }

      if (closeBtn) {
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.hide();
        });
      }

      if (pill) {
        pill.addEventListener("click", () => {
          this.restore();
        });
      }

      if (ctaBtn) {
        ctaBtn.addEventListener("click", () => {
          // Open popup or dispatch event to workspace
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("warmgraph:open_workspace"));
          }
          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: "OPEN_MY_NETWORK" }, () => {});
          }
        });
      }

      // Drag functionality on header
      if (header) {
        header.addEventListener("mousedown", (e) => {
          if (e.target.tagName === "BUTTON") return;
          this.isDragging = true;
          const rect = this.cardEl.getBoundingClientRect();
          this.dragOffset = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
          };
          header.style.cursor = "grabbing";
        });

        document.addEventListener("mousemove", (e) => {
          if (!this.isDragging) return;
          e.preventDefault();
          const left = e.clientX - this.dragOffset.x;
          const top = e.clientY - this.dragOffset.y;

          // Clamp to viewport
          const maxLeft = window.innerWidth - this.cardEl.offsetWidth - 10;
          const maxTop = window.innerHeight - this.cardEl.offsetHeight - 10;
          const clampedLeft = Math.max(10, Math.min(left, maxLeft));
          const clampedTop = Math.max(10, Math.min(top, maxTop));

          this.container.style.left = `${clampedLeft}px`;
          this.container.style.top = `${clampedTop}px`;
          this.container.style.right = "auto";
          this.container.style.bottom = "auto";
        });

        document.addEventListener("mouseup", () => {
          if (this.isDragging) {
            this.isDragging = false;
            header.style.cursor = "grab";
          }
        });
      }
    }

    minimize() {
      this.isMinimized = true;
      if (this.cardEl) this.cardEl.style.display = "none";
      if (this.pillEl) this.pillEl.style.display = "flex";
    }

    restore() {
      this.isMinimized = false;
      if (this.cardEl) this.cardEl.style.display = "block";
      if (this.pillEl) this.pillEl.style.display = "none";
    }

    hide() {
      this.isHiddenByUser = true;
      if (this.container) this.container.style.display = "none";
    }

    show() {
      this.isHiddenByUser = false;
      if (this.container) this.container.style.display = "block";
    }

    observeSessionState() {
      // 1. Storage listener
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, namespace) => {
          if (namespace === "local" && changes.acquisition_session && changes.acquisition_session.newValue) {
            this.update(changes.acquisition_session.newValue);
          }
        });
      }

      // 2. Fetch initial stored session
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["acquisition_session"], (res) => {
          if (res && res.acquisition_session) {
            this.update(res.acquisition_session);
          }
        });
      }
    }

    update(status) {
      if (!status) return;
      this.currentStatus = status;

      // Don't render if user explicitly closed the overlay UI
      if (this.isHiddenByUser) return;

      const state = status.state || "idle";
      const collected = status.collected_count !== undefined ? status.collected_count : (status.connections ? status.connections.length : 0);
      const expected = status.expected_total || status.reliable_dom_total || 0;

      // Ensure container is created & visible
      if (!this.container) this.createDOM();

      const shouldShow = (
        state === "preparing" ||
        state === "acquiring" ||
        state === "collecting" ||
        state === "waiting" ||
        state === "waiting_for_content" ||
        state === "settling" ||
        state === "resumed" ||
        state === "completed" ||
        state === "interrupted" ||
        state === "paused" ||
        state === "failed" ||
        state === "error" ||
        collected > 0
      );

      if (shouldShow) {
        this.container.style.display = "block";
      } else {
        this.container.style.display = "none";
        return;
      }

      const mapped = getMappedStateData(status);

      // Elements
      const pillBadgeEl = this.container.querySelector("#warmgraph-status-pill");
      const titleEl = this.container.querySelector("#warmgraph-overlay-title");
      const descEl = this.container.querySelector("#warmgraph-overlay-desc");
      const countEl = this.container.querySelector("#warmgraph-overlay-count");
      const labelEl = this.container.querySelector("#warmgraph-overlay-count-label");
      const subcountEl = this.container.querySelector("#warmgraph-overlay-subcount");
      const progressContainer = this.container.querySelector("#warmgraph-progress-container");
      const progressBar = this.container.querySelector("#warmgraph-progress-bar");
      const activityListEl = this.container.querySelector("#warmgraph-activity-list");
      const reassuranceEl = this.container.querySelector("#warmgraph-reassurance");
      const syncContainerEl = this.container.querySelector("#warmgraph-sync-badge-container");
      const ctaContainerEl = this.container.querySelector("#warmgraph-cta-container");
      const pillCountEl = this.container.querySelector("#warmgraph-pill-count");

      if (pillBadgeEl) pillBadgeEl.textContent = mapped.badgeText;
      if (titleEl) titleEl.textContent = mapped.title;
      if (descEl) descEl.textContent = mapped.desc;

      if (countEl) countEl.textContent = String(collected);
      if (labelEl) labelEl.textContent = collected === 1 ? "connection" : "connections";

      if (subcountEl) {
        if (expected > 0) {
          subcountEl.textContent = `${collected} of ${expected} connections`;
        } else {
          subcountEl.textContent = `${collected} connections found`;
        }
      }

      // Progress bar percentage
      if (progressBar) {
        if (expected > 0) {
          const pct = Math.min(100, Math.round((collected / expected) * 100));
          progressBar.style.width = `${pct}%`;
          if (progressContainer) progressContainer.style.display = "block";
        } else if (collected > 0 && (state === "acquiring" || state === "collecting")) {
          progressBar.style.width = "100%";
          if (progressContainer) progressContainer.style.display = "block";
        } else {
          if (progressContainer) progressContainer.style.display = "none";
        }
      }

      // Activities Checklist
      if (activityListEl) {
        activityListEl.innerHTML = mapped.activities.map(act => `
          <div class="warmgraph-activity-item ${act.status}">
            <span class="warmgraph-activity-icon">${act.icon}</span>
            <span>${act.text}</span>
          </div>
        `).join("");
      }

      // Sync badge
      if (syncContainerEl) {
        if (mapped.syncBadgeText) {
          const b = mapped.syncBadgeText;
          const cls = b.type === "synced" ? "warmgraph-sync-synced" : "warmgraph-sync-pending";
          syncContainerEl.innerHTML = `<div class="warmgraph-sync-badge ${cls}">${b.text}</div>`;
        } else {
          syncContainerEl.innerHTML = "";
        }
      }

      // Reassurance text
      if (reassuranceEl) {
        reassuranceEl.style.display = mapped.showReassurance ? "block" : "none";
      }

      // Primary CTA
      if (ctaContainerEl) {
        ctaContainerEl.style.display = mapped.showCta ? "block" : "none";
      }

      // Minimized pill count update
      if (pillCountEl) {
        if (expected > 0) {
          pillCountEl.textContent = `${collected} / ${expected}`;
        } else {
          pillCountEl.textContent = `${collected}`;
        }
      }
    }
  }

  // Create singleton instance
  const manager = new WarmGraphOverlayManager();
  window.WarmGraphOverlay = manager;

  // Global update hook for content.js
  window.updateWarmGraphOverlay = function (status) {
    if (manager) manager.update(status);
  };
})();
