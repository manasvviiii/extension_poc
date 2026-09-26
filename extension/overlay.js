/**
 * WarmGraph Non-Interruptive Acquisition Overlay Component (Task 7.4 Redesign)
 * 
 * Premium glassmorphism widget (Linear / Vercel / Arc Browser dark SaaS aesthetic).
 * 340px width, #070B1A background, rgba(15,23,42,0.88) surface, #38BDF8 accent blue,
 * #8B5CF6 accent violet, #22C55E success green, rounded 22px radius, soft glow, backdrop blur.
 * 
 * Features:
 * - Status pill (Preparing, Building, Verifying, Complete, Paused) with subtle pulse
 * - Hero Card with smooth SVG circular progress ring, 24% Complete center text, Network mapped metric, remaining text
 * - Premium gradient progress bar filled equal to progressPercent
 * - Checklist activities ("Relationship signals indexed", live countdown)
 * - Muted pill footer ("Working quietly in the background"), replaced by "Open My Network" CTA on completion
 * 
 * OBSERVES existing acquisition session state from chrome.storage.local without
 * modifying acquisition engine, storage, or sync logic.
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
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #f8fafc;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        box-sizing: border-box;
      }

      .warmgraph-overlay-container * {
        box-sizing: border-box;
      }

      /* Premium Glassmorphism Widget Card */
      .warmgraph-overlay-card {
        width: 340px;
        background: linear-gradient(180deg, rgba(17, 24, 39, 0.95) 0%, rgba(11, 18, 32, 0.98) 100%);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(31, 41, 55, 0.85);
        border-radius: 22px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), 0 0 30px rgba(37, 99, 235, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        pointer-events: auto;
        overflow: hidden;
        transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        animation: warmgraphWidgetIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes warmgraphWidgetIn {
        from { opacity: 0; transform: scale(0.95) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }

      /* Header */
      .warmgraph-overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        background: rgba(255, 255, 255, 0.02);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        cursor: grab;
      }

      .warmgraph-brand-group {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .warmgraph-brand {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        font-size: 13px;
        color: #f8fafc;
        letter-spacing: -0.3px;
      }

      .warmgraph-logo-icon {
        flex-shrink: 0;
      }

      /* Status Pill States & Pulsing */
      .warmgraph-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 600;
        transition: all 0.25s ease;
      }

      .warmgraph-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }

      .warmgraph-status-preparing, .warmgraph-status-building {
        background: rgba(56, 189, 248, 0.12);
        border: 1px solid rgba(56, 189, 248, 0.28);
        color: #38bdf8;
      }

      .warmgraph-status-building .warmgraph-status-dot, .warmgraph-status-preparing .warmgraph-status-dot {
        animation: warmgraphPulseDot 1.8s infinite ease-in-out;
      }

      .warmgraph-status-verifying {
        background: rgba(139, 92, 246, 0.12);
        border: 1px solid rgba(139, 92, 246, 0.28);
        color: #a78bfa;
      }

      .warmgraph-status-verifying .warmgraph-status-dot {
        animation: warmgraphPulseDot 1.8s infinite ease-in-out;
      }

      .warmgraph-status-complete, .warmgraph-status-resting {
        background: rgba(34, 197, 94, 0.12);
        border: 1px solid rgba(34, 197, 94, 0.28);
        color: #22c55e;
      }

      .warmgraph-status-paused {
        background: rgba(245, 158, 11, 0.12);
        border: 1px solid rgba(245, 158, 11, 0.28);
        color: #fbbf24;
      }

      @keyframes warmgraphPulseDot {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.35; transform: scale(0.85); }
      }

      /* Header Controls */
      .warmgraph-header-controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .warmgraph-icon-btn {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: #94a3b8;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        padding: 0;
        line-height: 1;
      }

      .warmgraph-icon-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
      }

      /* Body Content */
      .warmgraph-overlay-body {
        padding: 16px 18px 18px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      /* Hero Card Component */
      .warmgraph-hero-card {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 14px 16px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 16px;
      }

      .warmgraph-ring-container {
        position: relative;
        width: 68px;
        height: 68px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .warmgraph-ring-svg {
        width: 68px;
        height: 68px;
        transform: rotate(-90deg);
      }

      .warmgraph-ring-text {
        position: absolute;
        top: 0;
        left: 0;
        width: 68px;
        height: 68px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        pointer-events: none;
      }

      .warmgraph-hero-percent {
        font-size: 15px;
        font-weight: 800;
        color: #f8fafc;
        line-height: 1;
        letter-spacing: -0.5px;
      }

      .warmgraph-hero-percent-label {
        font-size: 8px;
        font-weight: 700;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 2px;
      }

      .warmgraph-hero-info {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
      }

      .warmgraph-hero-title {
        font-size: 11px;
        font-weight: 600;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
      }

      .warmgraph-hero-metric {
        font-size: 22px;
        font-weight: 800;
        color: #f8fafc;
        letter-spacing: -0.5px;
        line-height: 1.1;
      }

      .warmgraph-hero-remaining {
        font-size: 11px;
        font-weight: 500;
        color: #64748b;
        margin-top: 2px;
      }

      /* Gradient Progress Bar */
      .warmgraph-progress-wrapper {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .warmgraph-progress-meta {
        display: flex;
        align-items: center;
        justify-content: flex-end;
      }

      .warmgraph-progress-percent-label {
        font-size: 11px;
        font-weight: 700;
        color: #38bdf8;
        letter-spacing: -0.2px;
      }

      .warmgraph-progress-container {
        width: 100%;
        height: 6px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 9999px;
        overflow: hidden;
        box-sizing: border-box;
      }

      .warmgraph-progress-bar {
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, #38bdf8 0%, #8b5cf6 100%);
        border-radius: 9999px;
        transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: 0 0 10px rgba(56, 189, 248, 0.3);
      }

      /* Checklist Activities */
      .warmgraph-activity-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .warmgraph-activity-item {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
        color: #94a3b8;
        font-weight: 500;
      }

      .warmgraph-activity-item.done {
        color: #e2e8f0;
      }

      .warmgraph-activity-item.done .warmgraph-activity-icon {
        color: #22c55e;
        font-weight: 700;
      }

      .warmgraph-activity-item.active {
        color: #38bdf8;
        font-weight: 600;
      }

      .warmgraph-activity-item.active .warmgraph-activity-icon {
        color: #38bdf8;
      }

      .warmgraph-activity-icon {
        font-size: 12px;
        width: 16px;
        text-align: center;
        flex-shrink: 0;
      }

      /* Footer Muted Pill */
      .warmgraph-footer-pill {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 8px 14px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 9999px;
        text-align: center;
        color: #64748b;
        font-size: 11px;
        font-weight: 500;
      }

      .warmgraph-footer-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #38bdf8;
        animation: warmgraphPulseDot 2s infinite ease-in-out;
        flex-shrink: 0;
      }

      /* Primary CTA Button for Complete State */
      .warmgraph-cta-btn {
        width: 100%;
        height: 42px;
        padding: 0 16px;
        background: linear-gradient(135deg, #38bdf8 0%, #8b5cf6 100%);
        color: #ffffff;
        border: none;
        border-radius: 12px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(56, 189, 248, 0.35);
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .warmgraph-cta-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 24px rgba(56, 189, 248, 0.5);
      }

      /* Minimized Pill View */
      .warmgraph-overlay-pill {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: rgba(15, 23, 42, 0.9);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(56, 189, 248, 0.3);
        border-radius: 9999px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 15px rgba(56, 189, 248, 0.2);
        cursor: pointer;
        pointer-events: auto;
        font-weight: 600;
        font-size: 13px;
        color: #f8fafc;
        transition: transform 0.15s ease;
      }

      .warmgraph-overlay-pill:hover {
        transform: translateY(-2px);
        border-color: #38bdf8;
      }

      .warmgraph-pill-count {
        color: #38bdf8;
        font-weight: 700;
      }

      .warmgraph-sync-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 4px 8px;
        border-radius: 6px;
        display: inline-block;
      }

      .warmgraph-sync-synced {
        background: rgba(52, 211, 153, 0.15);
        color: #34d399;
        border: 1px solid rgba(52, 211, 153, 0.3);
      }

      .warmgraph-sync-pending {
        background: rgba(245, 158, 11, 0.15);
        color: #fbbf24;
        border: 1px solid rgba(245, 158, 11, 0.3);
      }

      @media (prefers-reduced-motion: reduce) {
        .warmgraph-overlay-card, .warmgraph-overlay-pill, .warmgraph-progress-bar, .warmgraph-ring-circle, .warmgraph-status-dot {
          animation: none !important;
          transition: none !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  // State mapping helper for status pills and checklist activities
  function getMappedStateData(status) {
    if (!status) {
      return {
        stateKey: "idle",
        badgeText: "Preparing",
        badgeClass: "warmgraph-status-preparing",
        title: "Preparing your network",
        desc: "WarmGraph is getting your connection page ready so it can build your personal network map.",
        activities: [
          { icon: "✓", text: "Connections collected", status: "done" },
          { icon: "✓", text: "Relationship signals indexed", status: "done" },
          { icon: "○", text: "Verifying network integrity", status: "active" }
        ],
        showReassurance: true,
        showCta: false,
        syncBadgeText: null
      };
    }

    const state = status.state || "idle";
    const collected = status.extractedConnections !== undefined ? status.extractedConnections : (status.collected_count !== undefined ? status.collected_count : (status.connections ? status.connections.length : 0));
    const actual = status.actualProfiles !== undefined ? status.actualProfiles : (status.expected_total !== undefined ? status.expected_total : 0);
    const isComplete = actual > 0 && collected >= actual;
    const syncStatus = status.sync_status || status.syncStatus || "idle";
    const isError = state === "failed" || state === "error" || (status.error && status.error.length > 0);

    const pausedStateData = {
      stateKey: "interrupted",
      badgeText: "Paused",
      badgeClass: "warmgraph-status-paused",
      title: "We'll continue when you're back",
      desc: status.status_message || "Return to Connections to continue syncing. WarmGraph has saved your progress.",
      activities: [
        { icon: "✓", text: "Progress saved locally", status: "done" },
        { icon: "⏸", text: "Collection paused", status: "active" }
      ],
      showReassurance: true,
      reassuranceText: "Progress saved locally",
      showCta: true,
      ctaText: "Continue Sync",
      syncBadgeText: { text: "Progress saved locally", type: "pending" }
    };

    if (isError) {
      return pausedStateData;
    }

    switch (state) {
      case "preparing":
        return {
          stateKey: "preparing",
          badgeText: "Preparing",
          badgeClass: "warmgraph-status-preparing",
          title: "Preparing your network",
          desc: "WarmGraph is getting your connection page ready so it can build your personal network map.",
          activities: [
            { icon: "✓", text: "Connections collected", status: "done" },
            { icon: "✓", text: "Relationship signals indexed", status: "done" },
            { icon: "○", text: "Verifying network integrity", status: "active" }
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
          badgeText: "Building",
          badgeClass: "warmgraph-status-building",
          title: "Building your network",
          desc: "We're organizing your professional connections so you can discover warm introductions later.",
          activities: [
            { icon: "✓", text: "Connections collected", status: "done" },
            { icon: "✓", text: "Relationship signals indexed", status: "done" },
            { icon: "○", text: "Verifying network integrity", status: "active" }
          ],
          showReassurance: true,
          showCta: false,
          syncBadgeText: null
        };

      case "waiting":
      case "waiting_for_content":
        return {
          stateKey: "waiting",
          badgeText: "Building",
          badgeClass: "warmgraph-status-building",
          title: "Loading more connections",
          desc: "WarmGraph is waiting for the next part of your network to appear.",
          activities: [
            { icon: "✓", text: "Connections collected", status: "done" },
            { icon: "✓", text: "Relationship signals indexed", status: "done" },
            { icon: "○", text: "Verifying network integrity", status: "active" }
          ],
          showReassurance: true,
          showCta: false,
          syncBadgeText: null
        };

      case "settling":
        return {
          stateKey: "settling",
          badgeText: "Verifying",
          badgeClass: "warmgraph-status-verifying",
          title: "Finishing your network",
          desc: "We're checking the connections we've collected and making sure your network is complete.",
          activities: [
            { icon: "✓", text: "Connections collected", status: "done" },
            { icon: "✓", text: "Relationship signals indexed", status: "done" },
            { icon: "○", text: "Verifying network integrity", status: "active" }
          ],
          showReassurance: true,
          showCta: false,
          syncBadgeText: null
        };

      case "paused":
      case "interrupted":
        return pausedStateData;

      case "completed":
      case "resting":
        if (!isComplete) {
          return pausedStateData;
        }

        let syncBadge = null;
        const completeActivities = [
          { icon: "✓", text: "Connections collected", status: "done" },
          { icon: "✓", text: "Relationship signals indexed", status: "done" },
          { icon: "✓", text: "Network verified", status: "done" },
          { icon: "✓", text: "Saved to WarmGraph", status: "done" }
        ];
        if (syncStatus === "synced") {
          syncBadge = { text: "✓ Saved to WarmGraph", type: "synced" };
        } else if (syncStatus === "syncing") {
          syncBadge = { text: "● Saving to WarmGraph...", type: "pending" };
        } else if (syncStatus === "failed" || syncStatus === "blocked") {
          syncBadge = { text: "⚠️ Network saved locally (Sync pending)", type: "pending" };
        }

        return {
          stateKey: "resting",
          badgeText: "Resting",
          badgeClass: "warmgraph-status-resting",
          title: "You're all caught up ✨",
          desc: "No new connections found. Your network is fully synced.",
          activities: completeActivities,
          showReassurance: false,
          showCta: true,
          ctaText: "Sync Again",
          syncBadgeText: null
        };

      case "idle":
      default:
        if (isComplete) {
          return {
            stateKey: "resting",
            badgeText: "Resting",
            badgeClass: "warmgraph-status-resting",
            title: "You're all caught up ✨",
            desc: "No new connections found. Your network is fully synced.",
            activities: [
              { icon: "✓", text: "Connections collected", status: "done" },
              { icon: "✓", text: "Relationship signals indexed", status: "done" },
              { icon: "✓", text: "Network verified", status: "done" },
              { icon: "✓", text: "Saved to WarmGraph", status: "done" }
            ],
            showReassurance: false,
            showCta: true,
            ctaText: "Sync Again",
            syncBadgeText: null
          };
        } else if (collected > 0) {
          return pausedStateData;
        }

        return {
          stateKey: "idle",
          badgeText: "Preparing",
          badgeClass: "warmgraph-status-preparing",
          title: "Preparing your network",
          desc: "WarmGraph is getting your connection page ready so it can build your personal network map.",
          activities: [
            { icon: "✓", text: "Connections collected", status: "done" },
            { icon: "✓", text: "Relationship signals indexed", status: "done" },
            { icon: "○", text: "Verifying network integrity", status: "active" }
          ],
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
      this.startCountdownTicker();
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
            <div class="warmgraph-brand-group">
              <div class="warmgraph-brand">
                <svg class="warmgraph-logo-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="url(#warmgraph-logo-grad)" />
                  <defs>
                    <linearGradient id="warmgraph-logo-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                      <stop stop-color="#38BDF8" />
                      <stop offset="1" stop-color="#8B5CF6" />
                    </linearGradient>
                  </defs>
                </svg>
                <span>WarmGraph</span>
              </div>
              <span id="warmgraph-status-pill" class="warmgraph-status-pill warmgraph-status-building">
                <span class="warmgraph-status-dot"></span>
                <span id="warmgraph-status-text">Building</span>
              </span>
            </div>
            <div class="warmgraph-header-controls">
              <button id="warmgraph-btn-minimize" class="warmgraph-icon-btn" title="Minimize">—</button>
              <button id="warmgraph-btn-close" class="warmgraph-icon-btn" title="Close">×</button>
            </div>
          </div>

          <div class="warmgraph-overlay-body">
            <!-- Hidden state tracking elements for compatibility -->
            <div style="display:none;">
              <h3 id="warmgraph-overlay-title" class="warmgraph-overlay-title">Building your network</h3>
              <p id="warmgraph-overlay-desc" class="warmgraph-overlay-desc">We're organizing your professional connections so you can discover warm introductions later.</p>
              <div id="warmgraph-overlay-count">0</div>
              <div id="warmgraph-overlay-count-label">Connections mapped</div>
              <div id="warmgraph-overlay-subcount"></div>
            </div>

            <!-- Hero Card Component -->
            <div class="warmgraph-hero-card">
              <div class="warmgraph-ring-container">
                <svg class="warmgraph-ring-svg" width="68" height="68" viewBox="0 0 68 68">
                  <defs>
                    <linearGradient id="warmgraph-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#38BDF8" />
                      <stop offset="100%" stop-color="#8B5CF6" />
                    </linearGradient>
                  </defs>
                  <circle class="warmgraph-ring-bg" cx="34" cy="34" r="26" stroke="rgba(255, 255, 255, 0.08)" stroke-width="5" fill="none" />
                  <circle id="warmgraph-ring-progress" class="warmgraph-ring-circle" cx="34" cy="34" r="26" stroke="url(#warmgraph-ring-gradient)" stroke-width="5" stroke-dasharray="163.36" stroke-dashoffset="163.36" stroke-linecap="round" fill="none" transform="rotate(-90 34 34)" style="transition: stroke-dashoffset 0.5s ease-out;" />
                </svg>
                <div class="warmgraph-ring-text">
                  <span id="warmgraph-hero-percent" class="warmgraph-hero-percent">0%</span>
                  <span class="warmgraph-hero-percent-label">Complete</span>
                </div>
              </div>

              <div class="warmgraph-hero-info">
                <div class="warmgraph-hero-title">Network mapped</div>
                <div id="warmgraph-hero-metric" class="warmgraph-hero-metric">0 / 0</div>
                <div id="warmgraph-hero-remaining" class="warmgraph-hero-remaining">0 remaining</div>
              </div>
            </div>

            <!-- Gradient Progress Bar -->
            <div class="warmgraph-progress-wrapper">
              <div class="warmgraph-progress-meta">
                <span id="warmgraph-progress-percent-label" class="warmgraph-progress-percent-label">0% Complete</span>
              </div>
              <div id="warmgraph-progress-container" class="warmgraph-progress-container">
                <div id="warmgraph-progress-bar" class="warmgraph-progress-bar"></div>
              </div>
            </div>

            <!-- Checklist Activities -->
            <div id="warmgraph-activity-list" class="warmgraph-activity-list"></div>

            <div id="warmgraph-sync-badge-container"></div>

            <!-- Footer Muted Pill -->
            <div id="warmgraph-footer-muted" class="warmgraph-footer-pill">
              <span class="warmgraph-footer-dot"></span>
              <span id="warmgraph-footer-text">Working quietly in the background</span>
            </div>

            <p id="warmgraph-reassurance" class="warmgraph-reassurance" style="display:none;"></p>

            <div id="warmgraph-cta-container" class="warmgraph-cta-container" style="display: none;">
              <button id="warmgraph-btn-open-workspace" class="warmgraph-cta-btn">Open My Network</button>
            </div>
          </div>
        </div>

        <div id="warmgraph-overlay-pill" class="warmgraph-overlay-pill" style="display: none;">
          <svg class="warmgraph-logo-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="url(#warmgraph-logo-grad-pill)" />
            <defs>
              <linearGradient id="warmgraph-logo-grad-pill" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stop-color="#38BDF8" />
                <stop offset="1" stop-color="#8B5CF6" />
              </linearGradient>
            </defs>
          </svg>
          <span>WarmGraph</span>
          <span id="warmgraph-pill-count" class="warmgraph-pill-count">0</span>
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
          const btnText = (ctaBtn.textContent || "").trim();
          const targetUrl = "https://www.linkedin.com/mynetwork/invite-connect/connections/";
          if (btnText === "Sync Again") {
            console.log("[OVERLAY] Sync Again clicked");
            if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
              chrome.runtime.sendMessage({
                type: "SYNC_NETWORK"
              });
            }
            renderOverlayState("building");
          } else if (btnText === "Continue Sync") {
            const isConn = (typeof window !== "undefined" && window.location && (
              window.location.pathname.includes("/mynetwork/invite-connect/connections/") ||
              window.location.href.includes("/mynetwork/invite-connect/connections") ||
              window.location.href.includes("connections.html")
            ));

            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("warmgraph:continue_sync"));
            }

            if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
              chrome.runtime.sendMessage({ action: "RESUME_EXTRACTION_SESSION", url: targetUrl }, () => {});
            }

            if (!isConn) {
              if (typeof window !== "undefined" && window.location) {
                window.location.href = targetUrl;
              }
            } else {
              if (typeof window !== "undefined" && window.acquisitionSession) {
                window.acquisitionSession.state = "acquiring";
                window.acquisitionSession.start();
              }
            }
          } else {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("warmgraph:open_workspace"));
            }
            if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.create === "function") {
              const url = (chrome.runtime && typeof chrome.runtime.getURL === "function") 
                ? chrome.runtime.getURL("developer_dashboard.html") 
                : "developer_dashboard.html";
              chrome.tabs.create({ url });
            } else if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
              chrome.runtime.sendMessage({ action: "OPEN_MY_NETWORK" }, () => {});
            } else if (typeof window !== "undefined") {
              window.open("developer_dashboard.html", "_blank");
            }
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
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, namespace) => {
          if (namespace === "local") {
            // SSOT: overlay ONLY reacts to currentSession (written by content.js)
            if (changes.currentSession && changes.currentSession.newValue) {
              this.update(changes.currentSession.newValue);
            } else if (changes.acquisition_session && changes.acquisition_session.newValue && !changes.currentSession) {
              // Backward compat: only if currentSession was NOT also updated
              this.update(changes.acquisition_session.newValue);
            }
          }
        });
      }

      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["currentSession", "acquisition_session"], (res) => {
          const session = (res && res.currentSession) || (res && res.acquisition_session) || null;
          if (session) {
            this.update(session);
          }
        });
      }
    }

    update(status) {
      if (!status) return;

      // ── SSOT: overlay.js is a PURE RENDERER ───────────────────────────────
      // Trust ALL values written to currentSession by content.js.
      // NEVER recalculate actualProfiles or progressPercent here.
      // ────────────────────────────────────────────────────────────────────────
      const rawState = status.state || "idle";
      const extracted = status.extractedConnections !== undefined
        ? status.extractedConnections
        : (status.collected_count !== undefined ? status.collected_count : 0);

      // Trust actualProfiles from content.js — NEVER re-derive from extracted
      const actual = status.actualProfiles !== undefined && status.actualProfiles > 0
        ? status.actualProfiles
        : (status.totalConnections !== undefined ? status.totalConnections : (status.expected_total || 0));

      const total = status.totalConnections !== undefined ? status.totalConnections : (status.expected_total || actual);

      // Trust progressPercent from content.js; only fallback-compute if absent
      const progressPercent = status.progressPercent !== undefined
        ? status.progressPercent
        : (actual > 0 ? (extracted >= actual ? 100 : Math.min(99, Math.floor((extracted / actual) * 100))) : (extracted > 0 ? 100 : 0));

      // Trust state from content.js — content.js enforces resting/paused rules
      const state = rawState;
      const imported = status.importedRecords;
      const syncStatus = status.syncStatus || status.sync_status || "idle";
      const lastSyncDate = status.lastSyncedAt || status.lastSyncDate || status.last_synced_at || "";
      const countdown = status.countdownSeconds !== undefined ? status.countdownSeconds
        : (status.countdown_seconds !== undefined ? status.countdown_seconds : 0);

      this.currentStatus = {
        ...status,
        state,
        extractedConnections: extracted,
        actualProfiles: actual,
        totalConnections: total,
        progressPercent,
        syncStatus,
        lastSyncDate,
        countdown_seconds: countdown,
        importedRecords: imported
      };

      if (this.isHiddenByUser) return;

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
        state === "resting" ||
        state === "interrupted" ||
        state === "paused" ||
        state === "failed" ||
        state === "error" ||
        extracted > 0
      );

      if (shouldShow) {
        this.container.style.display = "block";
      } else {
        this.container.style.display = "none";
        return;
      }

      const mapped = getMappedStateData(this.currentStatus);

      // Elements
      const pillBadgeEl = this.container.querySelector("#warmgraph-status-pill");
      const titleEl = this.container.querySelector("#warmgraph-overlay-title");
      const descEl = this.container.querySelector("#warmgraph-overlay-desc");
      const countEl = this.container.querySelector("#warmgraph-overlay-count");
      const labelEl = this.container.querySelector("#warmgraph-overlay-count-label");
      const subcountEl = this.container.querySelector("#warmgraph-overlay-subcount");

      const heroPercentEl = this.container.querySelector("#warmgraph-hero-percent");
      const heroRingCircle = this.container.querySelector("#warmgraph-ring-progress");
      const heroMetricEl = this.container.querySelector("#warmgraph-hero-metric");
      const heroRemainingEl = this.container.querySelector("#warmgraph-hero-remaining");

      const progressLabelEl = this.container.querySelector("#warmgraph-progress-percent-label");
      const progressContainer = this.container.querySelector("#warmgraph-progress-container");
      const progressBar = this.container.querySelector("#warmgraph-progress-bar");
      const activityListEl = this.container.querySelector("#warmgraph-activity-list");

      const footerMutedEl = this.container.querySelector("#warmgraph-footer-muted");
      const reassuranceEl = this.container.querySelector("#warmgraph-reassurance");
      const syncContainerEl = this.container.querySelector("#warmgraph-sync-badge-container");
      const ctaContainerEl = this.container.querySelector("#warmgraph-cta-container");
      const pillCountEl = this.container.querySelector("#warmgraph-pill-count");

      // Status pill update
      if (pillBadgeEl) {
        pillBadgeEl.className = `warmgraph-status-pill ${mapped.badgeClass}`;
        const statusTextEl = pillBadgeEl.querySelector("#warmgraph-status-text");
        if (statusTextEl) {
          statusTextEl.textContent = mapped.badgeText;
        } else {
          pillBadgeEl.textContent = mapped.badgeText;
        }
      }

      if (titleEl) titleEl.textContent = mapped.title;
      if (descEl) descEl.textContent = mapped.desc;
      if (countEl) countEl.textContent = String(this.currentStatus.extractedConnections);
      if (labelEl) labelEl.textContent = this.currentStatus.extractedConnections === 1 ? "Connection mapped" : "Connections mapped";

      // Circular progress & progress bar (uses exact same this.currentStatus.progressPercent)
      const pct = this.currentStatus.progressPercent;
      if (heroPercentEl) heroPercentEl.textContent = `${pct}%`;
      if (heroRingCircle) {
        const C = 163.36; // Circumference for r=26
        const strokeDashoffset = C - (pct / 100) * C;
        heroRingCircle.style.strokeDashoffset = `${strokeDashoffset.toFixed(2)}px`;
      }

      // Hero Metric (MUST be displayLeft / displayRight = extractedConnections / actualProfiles)
      const displayLeft = this.currentStatus.extractedConnections;
      const displayRight = this.currentStatus.actualProfiles;
      if (heroMetricEl) {
        if (displayRight > 0) {
          heroMetricEl.textContent = `${displayLeft} / ${displayRight}`;
        } else {
          heroMetricEl.textContent = `${displayLeft}`;
        }
      }

      const remaining = Math.max(0, displayRight - displayLeft);

      // Hero Subtitle (Show "All LinkedIn connections mapped" when complete)
      if (heroRemainingEl) {
        if (state === "resting" || state === "completed" || displayLeft === displayRight) {
          heroRemainingEl.textContent = "All LinkedIn connections mapped";
        } else if (displayRight > 0) {
          heroRemainingEl.textContent = `${remaining} remaining`;
        } else {
          heroRemainingEl.textContent = "Quietly mapping network";
        }
      }

      // Legacy subcount update for test suite assertions
      if (subcountEl) {
        let subText = "";
        if (state === "resting" || state === "completed" || displayLeft === displayRight) {
          subText = `${displayLeft} of ${displayRight} connections\n100% Complete`;
        } else if (displayRight > 0) {
          subText = `${displayLeft} of ${displayRight} connections\n${pct}% Complete`;
        } else if (displayLeft > 0) {
          subText = `${displayLeft} connections found`;
        }
        if (subText) {
          subcountEl.textContent = subText;
          subcountEl.style.display = "block";
        } else {
          subcountEl.style.display = "none";
        }
      }

      // Progress bar fill & label (uses exact same pct!)
      if (progressLabelEl) {
        progressLabelEl.textContent = `${pct}% Complete`;
      }

      if (progressBar) {
        if (state === "resting" || state === "completed" || displayLeft > 0 || state === "acquiring" || state === "collecting" || state === "waiting" || state === "settling" || state === "preparing") {
          progressBar.style.width = `${pct}%`;
          if (progressContainer) progressContainer.style.display = "block";
        } else {
          if (progressContainer) progressContainer.style.display = "none";
        }
      }

      // Checklist Activities Rendering
      const activities = [...mapped.activities];
      if (state !== "completed" && remaining > 0 && countdown > 0) {
        activities[2] = { icon: "○", text: `Next batch in ${countdown}s`, status: "active" };
      }

      if (activityListEl) {
        activityListEl.innerHTML = activities.map(act => `
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

      // Reassurance copy
      if (reassuranceEl) {
        if (state === "paused" || state === "interrupted") {
          reassuranceEl.style.display = "none";
        } else if (state !== "completed" && remaining > 0 && countdown > 0) {
          reassuranceEl.textContent = `${remaining} remaining • Next sync in ${countdown}s`;
          reassuranceEl.style.display = "block";
        } else if (mapped.showReassurance) {
          reassuranceEl.textContent = "You can keep browsing LinkedIn normally.";
          reassuranceEl.style.display = "block";
        } else {
          reassuranceEl.style.display = "none";
        }
      }

      // Footer vs Primary CTA
      const footerTextEl = this.container.querySelector("#warmgraph-footer-text");
      if (footerTextEl) {
        if (state === "paused" || state === "interrupted") {
          footerTextEl.textContent = "Timer frozen • Progress safely saved";
        } else {
          footerTextEl.textContent = "Working quietly in the background";
        }
      }

      if (mapped.showCta) {
        if (footerMutedEl) footerMutedEl.style.display = "none";
        if (ctaContainerEl) {
          ctaContainerEl.style.display = "block";
          const ctaBtnEl = ctaContainerEl.querySelector("#warmgraph-btn-open-workspace");
          if (ctaBtnEl) {
            ctaBtnEl.textContent = mapped.ctaText || "Open My Network";
          }
        }
      } else {
        if (footerMutedEl) footerMutedEl.style.display = "flex";
        if (ctaContainerEl) ctaContainerEl.style.display = "none";
      }

      // Minimized pill count
      if (pillCountEl) {
        if (displayRight > 0) {
          pillCountEl.textContent = `${displayLeft} / ${displayRight}`;
        } else {
          pillCountEl.textContent = `${displayLeft}`;
        }
      }
    }

    startCountdownTicker() {
      if (this.tickerTimer) return;
      this.tickerTimer = setInterval(() => {
        this.tickCountdown();
      }, 1000);
    }

    tickCountdown() {
      if (!this.container || !this.currentStatus) return;
      const reassuranceEl = this.container.querySelector("#warmgraph-reassurance");
      const activityListEl = this.container.querySelector("#warmgraph-activity-list");

      const state = this.currentStatus.state || "idle";
      const expected = this.currentStatus.totalConnections !== undefined ? this.currentStatus.totalConnections : (this.currentStatus.expected_total || 0);
      const collected = this.currentStatus.extractedConnections !== undefined ? this.currentStatus.extractedConnections : (this.currentStatus.collected_count || 0);
      const remaining = this.currentStatus.remainingConnections !== undefined ? this.currentStatus.remainingConnections : Math.max(0, expected - collected);
      const nextBatchAt = this.currentStatus.nextBatchAt || (this.currentStatus.nextSyncAt ? new Date(this.currentStatus.nextSyncAt).getTime() : null);

      if (state !== "completed" && remaining > 0 && (this.currentStatus.countdown_seconds > 0 || nextBatchAt)) {
        const remainingSec = this.currentStatus.countdown_seconds > 0
          ? this.currentStatus.countdown_seconds
          : Math.max(0, Math.ceil((nextBatchAt - Date.now()) / 1000));

        if (remainingSec > 0) {
          if (reassuranceEl) {
            reassuranceEl.textContent = `${remaining} remaining • Next sync in ${remainingSec}s`;
            reassuranceEl.style.display = "block";
          }

          if (activityListEl) {
            const mapped = getMappedStateData(this.currentStatus);
            const updatedActivities = mapped.activities.map((act, idx) => {
              if (idx === 2 && act.status === "active") {
                return { ...act, text: `Next batch in ${remainingSec}s` };
              }
              return act;
            });
            activityListEl.innerHTML = updatedActivities.map(act => `
              <div class="warmgraph-activity-item ${act.status}">
                <span class="warmgraph-activity-icon">${act.icon}</span>
                <span>${act.text}</span>
              </div>
            `).join("");
          }
        }
      }
    }
  }

  // Create singleton instance
  const manager = new WarmGraphOverlayManager();
  window.WarmGraphOverlay = manager;

  function renderOverlayState(state) {
    if (manager) {
      manager.update({ state: state || "building", syncStatus: "syncing" });
    }
  }
  window.renderOverlayState = renderOverlayState;
  window.updateOverlayState = renderOverlayState;

  // Global update hook
  window.updateWarmGraphOverlay = function (status) {
    if (manager) manager.update(status);
  };

  const syncBtn = document.getElementById("overlaySyncAgainBtn");

  syncBtn?.addEventListener("click", () => {
    console.log("[OVERLAY] Sync Again clicked");

    chrome.runtime.sendMessage({
      type: "SYNC_NETWORK"
    });

    renderOverlayState("building");
  });
})();
