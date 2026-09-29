const connectionStore = new Map();
const relationshipEvidenceStore = new Map();
let visibilityChangeListener = null;
let scanTimer = null;


// =========================================================
// OWNER IDENTITY
// =========================================================

const BACKEND_BASE_URL = "http://127.0.0.1:8000";

let cachedOwnerId = null;

// =========================================================
// CANONICAL OWNER IDENTITY
// Priority: warmgraph_owner.ownerId > ownerId > detect from LinkedIn nav
// NEVER generate warmgraph_<uuid> if a real LinkedIn identity exists.
// =========================================================

/**
 * Extract the owner's LinkedIn slug from the page nav bar.
 * LinkedIn renders the signed-in user's profile link in the global nav.
 * Returns a slug like "manasvi-p-8a88402ab" or null if not found.
 */
function detectLinkedInOwnerSlug() {
  try {
    // ONLY inspect top global navigation header elements representing the logged-in "Me" user.
    // NEVER inspect page body elements, profile rail cards, or viewed profile elements.
    const preciseSels = [
      "a.global-nav__me-photo[href*='/in/']",
      ".global-nav__me a[href*='/in/']",
      "[data-view-name='nav-profile-section'] a[href*='/in/']",
      "a[href*='/in/'][data-control-name='nav.settings_view_profile']",
      "a[href*='/in/'][data-control-name*='identity_welcome_message']",
      "a[href*='/in/'][data-control-name*='nav.settings']",
      ".nav-profile-menu__link a[href*='/in/']",
      ".mn-identity-badge a[href*='/in/']"
    ];

    for (const sel of preciseSels) {
      try {
        const el = document.querySelector(sel);
        // Strict guard: element MUST be inside global nav container
        if (el && el.href && el.closest("header, nav, .global-nav, #global-nav")) {
          const match = el.href.match(/\/in\/([^/?#]+)/);
          if (match && match[1] && match[1] !== "undefined") return match[1];
        }
      } catch (_) {}
    }
  } catch (e) {
    // Non-browser environment — ignore
  }
  return null;
}

/**
 * Derive a stable owner ID from a LinkedIn slug.
 * Normalizes to lowercase and replaces spaces/slashes.
 */
function slugToOwnerId(slug) {
  return slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Detect the owner's LinkedIn identity from the DOM and persist it
 * in warmgraph_owner + ownerId for cross-component consistency.
 * Returns the ownerId string, or null if not detected.
 */
async function detectAndPersistOwnerIdentity() {
  // Check storage FIRST — before touching the DOM
  const stored = await new Promise(r => chrome.storage.local.get(["warmgraph_owner", "ownerId"], r));
  const currentOwner = stored.warmgraph_owner;
  const currentId = currentOwner?.ownerId || stored.ownerId || "";

  // IMMUTABILITY: Real LinkedIn slug already stored — never re-detect or overwrite.
  // Visiting a target person's profile page must NOT change the owner identity.
  const isRealId = currentId && !currentId.startsWith("warmgraph_");
  if (isRealId) {
    cachedOwnerId = currentId;
    return cachedOwnerId;
  }

  // Only attempt DOM detection if we don't have a confirmed identity yet
  const slug = detectLinkedInOwnerSlug();
  if (!slug) return null;

  const ownerId = slugToOwnerId(slug);
  const profileUrl = `https://www.linkedin.com/in/${slug}`;

  // Write only when identity is truly missing or was a temporary UUID
  const ownerRecord = {
    ownerId,
    profileUrl,
    name: "",
    detectedAt: new Date().toISOString(),
    source: "linkedin_nav"
  };
  await new Promise(r => chrome.storage.local.set({
    warmgraph_owner: ownerRecord,
    ownerId,
    externalProfileUrl: profileUrl
  }, r));
  cachedOwnerId = ownerId;
  return ownerId;
}

/**
 * Get the canonical owner ID.
 * Loads strictly from warmgraph_owner.ownerId > ownerId storage keys.
 * Never derives from target, current profile page, UUID, or session.
 */
function getOwnerId() {
  if (cachedOwnerId) {
    return Promise.resolve(cachedOwnerId);
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(["warmgraph_owner", "ownerId"], (result) => {
      // Priority 1: canonical warmgraph_owner record
      if (result.warmgraph_owner?.ownerId) {
        cachedOwnerId = result.warmgraph_owner.ownerId;
        resolve(cachedOwnerId);
        return;
      }

      // Priority 2: legacy ownerId key (only accept if it's NOT a random warmgraph_ UUID)
      if (result.ownerId && !result.ownerId.startsWith("warmgraph_")) {
        cachedOwnerId = result.ownerId;
        resolve(cachedOwnerId);
        return;
      }

      // Priority 3: Try DOM detection once
      detectAndPersistOwnerIdentity().then(detectedId => {
        if (detectedId) {
          cachedOwnerId = detectedId;
          resolve(cachedOwnerId);
          return;
        }
        resolve(result.ownerId || null);
      });
    });
  });
}

// Auto-detect identity once on page load.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  detectAndPersistOwnerIdentity().catch(() => {});
}


// =========================================================
// TEXT HELPERS
// =========================================================

function cleanText(value) {
  return (value || "")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeProfileUrl(href) {
  if (!href) return null;

  try {
    const url = new URL(
      href,
      window.location.origin
    );

    if (!url.pathname.startsWith("/in/")) {
      return null;
    }

    return `${url.origin}${url.pathname.toLowerCase()}`.replace(
      /\/$/,
      ""
    );

  } catch {
    return null;
  }
}


/* =========================================================
   COMPANY RESOLUTION (TASK 9.2 ENTITY EXTRACTION)
========================================================= */

function normalizeCompanyName(rawCompany) {
  if (!rawCompany || typeof rawCompany !== "string") return null;
  let clean = rawCompany.replace(/\|.*$/g, "").replace(/[•·,:-]+$/, "").trim();
  if (!clean) return null;

  const fold = clean.toLowerCase();

  // Faculty & Institute Normalization
  if (fold === "gat" || fold === "global academy" || fold === "global academy of tech" || fold === "global academy of technology") {
    return "Global Academy of Technology";
  }
  if (fold === "hpe" || fold === "hp enterprise" || fold === "hewlett packard enterprise") {
    return "Hewlett Packard Enterprise";
  }
  if (fold === "sisa") {
    return "SISA";
  }

  return clean;
}


function extractCompanyFromHeadline(headline) {
  if (!headline || typeof headline !== "string") return null;
  const h = headline.trim();
  if (!h) return null;

  // 1. Pipe pattern: "Lecturer, Dept. of CSE | GAT" or "Research Intern | SISA"
  const pipeMatch = h.match(/\|\s*([^|•·\n]+)$/);
  if (pipeMatch && pipeMatch[1]) {
    const candidate = pipeMatch[1].trim();
    if (candidate && !/linkedin|profile|degree|connection|student/i.test(candidate)) {
      const norm = normalizeCompanyName(candidate);
      if (norm) return norm;
    }
  }

  // 2. "at <Org>" / "@ <Org>" / "Student at <Org>" / "Professor at <Org>"
  const atMatch = h.match(/\b(?:student|professor|assistant professor|associate professor|researcher|faculty|intern|engineer|lecturer)?\s*(?:at|@)\s+([^|•·\n,]+)/i);
  if (atMatch && atMatch[1]) {
    const candidate = atMatch[1].trim();
    if (candidate && !/linkedin|profile|degree|connection/i.test(candidate)) {
      const norm = normalizeCompanyName(candidate);
      if (norm) return norm;
    }
  }

  return null;
}


function resolveCompanyAndRoleType(card, text, headline, existingRecord = {}) {
  let resolvedCompany = null;
  let roleType = existingRecord.role_type || null;

  // 1. Structured current company (highest priority)
  if (existingRecord.company) {
    resolvedCompany = normalizeCompanyName(existingRecord.company);
  }

  // 2. Experience section (card DOM element if present)
  if (!resolvedCompany && card && typeof card.querySelector === "function") {
    try {
      const expEl = card.querySelector('[data-field="company"], [class*="company"], .entity-result__primary-subtitle');
      if (expEl) {
        const expText = cleanText(expEl.innerText || expEl.textContent);
        if (expText) {
          resolvedCompany = extractCompanyFromHeadline(expText) || normalizeCompanyName(expText);
        }
      }
    } catch (_) {}
  }

  // 3. Headline patterns
  if (!resolvedCompany && headline) {
    resolvedCompany = extractCompanyFromHeadline(headline);
  }

  // 4. Education section for students / academic profiles
  const studentPattern = /\b(?:student|undergraduate|intern|candidate|pursuing|scholar)\b/i;
  const isStudent = studentPattern.test(headline || "") || studentPattern.test(text || "");

  if (isStudent) {
    roleType = "student";
    if (!resolvedCompany) {
      const eduMatch = (headline || "").match(/(?:student|pursuing|b\.?tech|m\.?tech|degree)\s+(?:at|in|of|@)?\s*([^|•·\n,]+)/i) ||
                       (text || "").match(/(?:education|university|college|institute|academy)\s*:?\s*([^|•·\n,]+)/i);
      if (eduMatch && eduMatch[1]) {
        const candidate = eduMatch[1].trim();
        if (candidate && !/linkedin|profile|degree|connection/i.test(candidate)) {
          resolvedCompany = normalizeCompanyName(candidate);
        }
      }
    }
  }

  // 5. Existing stored value
  if (!resolvedCompany && existingRecord.company) {
    resolvedCompany = normalizeCompanyName(existingRecord.company);
  }

  const finalCompany = resolvedCompany || existingRecord.company || null;

  return {
    company: finalCompany,
    role_type: roleType
  };
}


function getPageType() {
  const url = window.location.href;

  if (url.includes("/search/results/people/")) {
    return "linkedin_people_search";
  }

  if (url.includes("/mynetwork/")) {
    return "linkedin_network";
  }

  if (url.includes("/in/")) {
    return "linkedin_profile";
  }

  return "linkedin_other";
}

const CONNECTIONS_LOCKED_PATH = "/search/results/people/";

function getAcquisitionEngineType() {
  if (typeof window === "undefined" || !window.location) return null;
  const path = window.location.pathname;

  // Connections page
  if (path.includes("/mynetwork/invite-connect/connections")) {
    return "CONNECTIONS";
  }

  if (path.includes("/search/results/people")) {
    return "PEOPLE_SEARCH";
  }

  return null;
}

function getSelectedPeopleSearchDegree() {
  if (typeof window === "undefined" || !window.location) return null;
  const pathname = window.location.pathname;

  if (!pathname.includes("/search/results/people")) {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  let network = params.get("network") || params.get("facetNetwork") || params.get("networkDegree") || "";
  try { network = decodeURIComponent(network); } catch (_) {}

  const fullSearch = decodeURIComponent(window.location.search || "");

  if (network.includes('"F"') || network.includes('F') || network.includes('1st') || fullSearch.includes('F') || fullSearch.includes('1st')) return "F";
  if (network.includes('"S"') || network.includes('S') || network.includes('2nd') || fullSearch.includes('S') || fullSearch.includes('2nd')) return "S";
  if (network.includes('"O"') || network.includes('O') || network.includes('3rd') || fullSearch.includes('O') || fullSearch.includes('3rd')) return "O";

  return "F";
}

function isEligiblePeopleSearch() {
  return window.location.pathname.includes("/search/results/people");
}

function isApprovedExtractionPage() {
  return (isEligiblePeopleSearch() && !!getSelectedPeopleSearchDegree()) || getAcquisitionEngineType() === "CONNECTIONS";
}

function isPeopleSearchDegreeValid(expectedDegree = null) {
  if (getAcquisitionEngineType() !== "PEOPLE_SEARCH") return true;
  const selectedDegree = getSelectedPeopleSearchDegree();
  return !!selectedDegree && (!expectedDegree || selectedDegree === expectedDegree);
}

function isConnectionsPage() {
  return isApprovedExtractionPage();
}

function findPaginationNextButton() {
  if (typeof document === "undefined") return null;

  const paginationContainer = document.querySelector('.artdeco-pagination, nav[aria-label*="pagination" i], [class*="pagination"]');
  try {
    if (paginationContainer && typeof paginationContainer.scrollIntoView === "function") {
      paginationContainer.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  } catch (_) {}

  const selectors = [
    'button.artdeco-pagination__button--next',
    'a.artdeco-pagination__button--next',
    'button[aria-label*="Next"]',
    'button[aria-label*="next"]',
    'a[aria-label*="Next"]',
    'a[aria-label*="next"]',
    '.artdeco-pagination__button--next button',
    '.artdeco-pagination__button--next a',
    'button[aria-label="Next"]',
    'a[aria-label="Next"]',
    '[aria-label*="Next page"]',
    'button:has(svg[data-test-icon*="chevron-right"])',
    'a:has(svg[data-test-icon*="chevron-right"])',
    '.artdeco-pagination button:has(svg[data-test-icon*="chevron-right"])',
    '.artdeco-pagination a:has(svg[data-test-icon*="chevron-right"])'
  ];

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const isDisabled = el.disabled === true ||
                           el.hasAttribute("disabled") ||
                           el.getAttribute("aria-disabled") === "true" ||
                           (el.classList && typeof el.classList.contains === "function" && el.classList.contains("artdeco-button--disabled")) ||
                           (el.classList && typeof el.classList.contains === "function" && el.classList.contains("disabled")) ||
                           el.getAttribute("disabled") === "disabled";
        if (!isDisabled) {
          return el;
        }
      }
    } catch (_) {}
  }
  return null;
}

function waitForNewPageRender({
  oldUrl,
  oldFirstProfileUrl,
  oldPageNum,
  shouldCancel = () => false,
  timeoutMs = 12000
}) {
  timeoutMs = Math.min(timeoutMs, 12000);
  const oldPageParam = new URL(oldUrl, location.origin).searchParams.get("page");
  const initialVisibleProfileUrl = getPeopleSearchProfileUrls()[0] || null;
  console.log("[WarmGraph][PeopleSearch] waitForNewPageRender started", {
    oldUrl, oldFirstProfileUrl, oldPageNum, timeoutMs
  });
  return new Promise(resolve => {
    const started = Date.now();

    function resolveTrue() {
      cleanup();
      console.log("[WarmGraph] Page render detected", { url: location.href });
      return resolve({ navigated: true });
    }

    const check = () => {
      if (shouldCancel()) {
        cleanup();
        return resolve(false);
      }
      const currentPageParam = new URL(location.href).searchParams.get("page");
      if (currentPageParam && oldPageParam && currentPageParam !== oldPageParam) {
        console.log("[WarmGraph][PeopleSearch] waitForNewPageRender resolved: URL page param changed", { oldUrl, url: location.href });
        return resolveTrue();
      }
      if (location.href !== oldUrl) {
        console.log("[WarmGraph][PeopleSearch] waitForNewPageRender resolved: URL changed", { oldUrl, url: location.href });
        return resolveTrue();
      }

      const first = getPeopleSearchProfileUrls()[0] || null;

      if (first && first !== initialVisibleProfileUrl) {
        console.log("[WarmGraph][PeopleSearch] waitForNewPageRender resolved: first profile changed", { oldFirstProfileUrl: initialVisibleProfileUrl || oldFirstProfileUrl, first, url: location.href });
        return resolveTrue();
      }

      const page = extractPaginationStateFromDom().currentPage;

      if (page !== oldPageNum) {
        console.log("[WarmGraph][PeopleSearch] waitForNewPageRender resolved: page number changed", { oldPageNum, page, url: location.href });
        return resolveTrue();
      }

      if (Date.now() - started > timeoutMs) {
        cleanup();
        console.warn("[WarmGraph][PeopleSearch] waitForNewPageRender timed out", { oldUrl, url: location.href, oldFirstProfileUrl, oldPageNum });
        return resolve(false);
      }
    };

    const observer = new MutationObserver(check);

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    console.log("[WarmGraph] Page render observer created", { url: location.href });

    const interval = setInterval(check, 150);

    function cleanup() {
      observer.disconnect();
      clearInterval(interval);
      console.log("[WarmGraph] Page render observer cleaned up", { url: location.href });
    }

    check();
  });
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getHumanActionDelayMs() {
  return random(2000, 5000);
}

async function waitHumanActionDelay(action) {
  const delayMs = getHumanActionDelayMs();
  console.log("[WarmGraph] Human action delay", { action, delayMs });
  await sleep(delayMs);
}

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function waitUntil(conditionFn, timeoutMs = 10000, intervalMs = 200) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (conditionFn()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, intervalMs);
  });
}

async function goToNextPeoplePage() {
  const next =
    findPaginationNextButton() ||
    document.querySelector('button[aria-label*="Next"]:not([disabled])') ||
    document.querySelector('a[aria-label*="Next"]:not([disabled])');

  if (!next) return false;

  const isDisabled = next.disabled === true ||
                     next.hasAttribute("disabled") ||
                     next.getAttribute("aria-disabled") === "true" ||
                     (next.classList && typeof next.classList.contains === "function" && (next.classList.contains("artdeco-button--disabled") || next.classList.contains("disabled")));

  if (isDisabled) return false;

  const firstProfile =
    document.querySelector('a[href*="/in/"]')?.href;

  window.__wgPreviousProfile = firstProfile;

  if (typeof next.scrollIntoView === "function") {
    next.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }

  await waitHumanActionDelay("Connections pagination click");

  if (typeof next.click === "function") {
    next.click();
  } else if (typeof next.dispatchEvent === "function") {
    next.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }

  return true;
}

async function waitForPeoplePageLoad() {
  const previous = window.__wgPreviousProfile;
  const start = Date.now();

  while (Date.now() - start < 12000) {
    const current = document.querySelector('a[href*="/in/"]')?.href;

    if (current && current !== previous) {
      await sleep(800);
      return;
    }

    await sleep(250);
  }

  console.warn("Next page load timeout reached, continuing extraction.");
}

async function navigateToNextPageAndWait(session) {
  const currentPagState = extractPaginationStateFromDom();
  const currentPageNum = currentPagState ? currentPagState.currentPage : (session ? (session.pageCount || 1) : 1);
  const nextPageNum = currentPageNum + 1;
  const navigatingLabel = `Page ${currentPageNum} Complete`;

  if (session) {
    session.state = "navigating";
    session.isNavigating = true;
    session.navigatingLabel = navigatingLabel;
    session.statusMessage = `➡ Navigating to Page ${nextPageNum}...`;
    session.checkpointSessionSync();
  }

  const moved = await goToNextPeoplePage();
  if (!moved) return false;

  await waitForPeoplePageLoad();

  if (session) {
    session.isNavigating = false;
    session.navigatingLabel = null;
    const newPagState = extractPaginationStateFromDom();
    if (newPagState && newPagState.currentPage) {
      session.pageCount = newPagState.currentPage;
    } else {
      session.pageCount = nextPageNum;
    }
    session.state = "acquiring";
    session.statusMessage = "Auto Extracting";
    session.checkpointSessionSync();
  }

  return true;
}

function getPeopleSearchProfileUrls() {
  const selectors = [
    ".search-results-container li",
    "li.reusable-search__result-container",
    ".reusable-search__result-container",
    "ul.reusable-search__entity-result-list > li",
    ".search-results-container .entity-result",
    "main li",
    ".scaffold-layout__main li"
  ];
  const cards = document.querySelectorAll ? document.querySelectorAll(selectors.join(",")) : [];
  const urls = [];
  const seen = new Set();

  for (const card of cards) {
    const anchors = card.querySelectorAll ? card.querySelectorAll('a[href*="/in/"]') : [];
    for (const anchor of anchors) {
      const profileUrl = normalizeProfileUrl(anchor.href);
      if (profileUrl && !seen.has(profileUrl)) {
        seen.add(profileUrl);
        urls.push(profileUrl);
        break;
      }
    }
  }

  if (urls.length === 0 && typeof document !== "undefined") {
    const anchors = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]') : [];
    for (const anchor of anchors) {
      const profileUrl = normalizeProfileUrl(anchor.href);
      if (profileUrl && !seen.has(profileUrl)) {
        seen.add(profileUrl);
        urls.push(profileUrl);
      }
    }
  }

  return urls;
}

async function waitForPeopleCards(timeout = 8000) {
  const start = Date.now();
  const timeoutMs = Math.min(timeout, 8000);
  const getCards = () => {
    try {
      return document.querySelectorAll(".search-results-container li, li.reusable-search__result-container");
    } catch (_) {
      return [];
    }
  };

  let cards = getCards();
  try {
    while (Date.now() - start < timeoutMs) {
      if (cards.length > 0) return cards;
      await sleep(200);
      cards = getCards();
    }
  } catch (_) {}

  return getCards();
}

async function waitForPeopleResultCards(timeoutMs = 10000) {
  const start = Date.now();
  const targetMinCards = 8;
  const selectors = [
    ".search-results-container li",
    "li.reusable-search__result-container",
    ".reusable-search__result-container",
    "ul.reusable-search__entity-result-list > li",
    ".search-results-container .entity-result",
    "main li",
    ".scaffold-layout__main li"
  ];

  const queryCards = () => {
    try {
      const els = document.querySelectorAll(selectors.join(","));
      return Array.from(els).filter(el => el.querySelector && el.querySelector('a[href*="/in/"]'));
    } catch (_) {
      return [];
    }
  };

  return new Promise((resolve, reject) => {
    let timer = null;
    let observer = null;
    let lastCount = 0;
    let stableRounds = 0;

    const cleanup = () => {
      if (timer) clearInterval(timer);
      if (observer) observer.disconnect();
    };

    const check = () => {
      const cards = queryCards();
      const count = cards.length;

      if (count >= targetMinCards) {
        cleanup();
        return resolve(cards);
      }

      if (count > 0) {
        if (count === lastCount) {
          stableRounds++;
          if (stableRounds >= 4) {
            cleanup();
            return resolve(cards);
          }
        } else {
          lastCount = count;
          stableRounds = 0;
        }
      }

      if (Date.now() - start >= timeoutMs) {
        cleanup();
        if (count > 0) {
          return resolve(cards);
        }
        return reject(new Error("Timed out waiting for People Search cards (10s)"));
      }
    };

    try {
      observer = new MutationObserver(check);
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    } catch (_) {}

    timer = setInterval(check, 150);
    check();
  });
}

async function waitForConnectionCardsToStabilize(timeout = 8000) {
  const started = Date.now();
  let previousCount = -1;
  let stableSince = 0;

  while (Date.now() - started < timeout) {
    const main = document.querySelector("main") || document;
    const count = Array.from(main.querySelectorAll("li"))
      .filter(item => item.querySelector('a[href*="/in/"]')).length;
    if (count > 0) {
      if (count !== previousCount) {
        previousCount = count;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= 900) {
        console.log("[WarmGraph] Connection cards stable", { count, stableMs: Date.now() - stableSince });
        return true;
      }
    }
    await sleep(300);
  }

  console.warn("[WarmGraph] Connection cards did not stabilize", { count: Math.max(0, previousCount), timeoutMs: timeout });
  return false;
}

function debugPaginationRoots() {
  const roots = [
    ...document.querySelectorAll("nav"),
    ...document.querySelectorAll('[class*="pagination"]'),
    ...document.querySelectorAll('[class*="Paginator"]'),
    ...document.querySelectorAll(".artdeco-pagination")
  ];

  console.log("[PAGINATION CANDIDATES]",
    roots.map((el, i) => ({
      i,
      tag: el.tagName,
      cls: el.className,
      aria: el.getAttribute("aria-label"),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0,120)
    }))
  );

  return null;
}

function getPeopleSearchPaginationRoot() {
  const elements = Array.from(
    document.querySelectorAll("div, section, footer, nav, ul, ol, [class*='pagination' i]")
  );
  const matching = [];

  for (const el of elements) {
    const text = el.textContent || "";
    if (!/next/i.test(text)) continue;

    const pageButtons = Array.from(
      el.querySelectorAll("button, a, [role='button']")
    ).filter(b => /^\d+$/.test((b.textContent || "").trim()));

    if (pageButtons.length >= 2) {
      matching.push({ el, childCount: el.querySelectorAll("*").length });
    }
  }

  console.log("[PAGER CANDIDATE COUNT]", matching.length);

  if (matching.length === 0) return null;

  matching.sort((a, b) => a.childCount - b.childCount);
  const root = matching[0].el;

  console.log("[PAGER MATCH]", {
    tag: root?.tagName,
    cls: root?.className,
    id: root?.id,
    role: root?.getAttribute("role"),
    aria: root?.getAttribute("aria-label"),
    html: root?.outerHTML?.slice(0, 500)
  });

  return root;
}

function findEnabledPeopleSearchNextButton() {
  const root = getPeopleSearchPaginationRoot();
  if (!root) return null;

  const candidates = root.querySelectorAll("button, a, [role='button']");
  for (const candidate of candidates) {
    const text = (candidate.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const label = (candidate.getAttribute("aria-label") || "")
      .toLowerCase();
    const hasRightChevron =
      candidate.querySelector('svg use[href*="chevron-right"]') ||
      candidate.querySelector('svg use[xlink\\:href*="chevron-right"]') ||
      candidate.querySelector('svg[data-test-icon*="chevron-right"]') ||
      candidate.querySelector('svg[data-test-icon*="arrow-right"]');
    const isNext =
      label.includes("next") ||
      text.includes("next") ||
      text.includes("\u203a") ||
      text.includes(">") ||
      !!hasRightChevron ||
      (candidate.classList && candidate.classList.contains("artdeco-pagination__button--next")) ||
      !!candidate.closest?.(".artdeco-pagination__button--next");

    let disabled = candidate.disabled === true ||
      candidate.getAttribute("aria-disabled") === "true" ||
      candidate.hasAttribute("disabled") ||
      (candidate.classList && typeof candidate.classList.contains === "function" && (
        candidate.classList.contains("artdeco-button--disabled") ||
        candidate.classList.contains("artdeco-pagination__button--disabled") ||
        candidate.classList.contains("disabled")
      )) ||
      !!candidate.closest?.(".artdeco-button--disabled,.artdeco-pagination__button--disabled");

    let ancestor = candidate.parentElement;
    while (!disabled && ancestor && ancestor !== root) {
      const classes = ancestor.classList;
      disabled = ancestor.disabled === true ||
        ancestor.getAttribute("aria-disabled") === "true" ||
        ancestor.hasAttribute("disabled") ||
        !!(classes && [
          "artdeco-pagination__button--disabled",
          "artdeco-button--disabled",
          "artdeco-pagination__indicator--disabled",
          "disabled"
        ].some(className => classes.contains(className)));
      ancestor = ancestor.parentElement;
    }

    if (isNext && !disabled) {
      console.log("[NEXT FOUND]", {
        text: (candidate.textContent || "").trim(),
        aria: candidate.getAttribute("aria-label")
      });
      return candidate;
    }
  }

  return null;
}

function extractPaginationStateFromDom() {
  const result = {
    currentPage: 1,
    totalPages: 1,
    hasNext: false
  };

  debugPaginationRoots();
  const root = getPeopleSearchPaginationRoot();

  console.log("[PAGINATION ROOT]", {
    found: !!root,
    text: root?.textContent?.replace(/\s+/g, " ").trim()
  });

  if (!root) {
    console.log("[WarmGraph] pageState", result);
    return result;
  }

  const active =
    root.querySelector('[aria-current="true"]') ||
    root.querySelector(".artdeco-pagination__indicator--number.active");

  if (active) {
    const n = parseInt(active.textContent.trim(), 10);
    if (!Number.isNaN(n)) result.currentPage = n;
  }

  const nums = [...root.querySelectorAll("button, a")]
    .map(el => parseInt(el.textContent.trim(), 10))
    .filter(Number.isFinite);

  if (nums.length) {
    result.totalPages = Math.max(...nums);
  } else {
    result.totalPages = result.currentPage;
  }

  result.hasNext = !!findEnabledPeopleSearchNextButton();
  console.log("[WarmGraph] pageState", result);
  return result;
}

async function autoAdvanceToNextPage(session) {
  let next = findEnabledPeopleSearchNextButton();
  if (!next) {
    console.warn("[WarmGraph][PeopleSearch] autoAdvance returned: no enabled Next button", { url: location.href, pageState: extractPaginationStateFromDom() });
    return false;
  }

  const currentPagState = extractPaginationStateFromDom();
  const currentPageNum =
    currentPagState?.currentPage || session?.pageCount || 1;

  const nextPageNum = currentPageNum + 1;

  if (session) {
    console.log("[WarmGraph][PeopleSearch] state transition: acquiring -> navigating", { currentPageNum, nextPageNum, sessionState: session.state, url: location.href });
    session.pageExtractionComplete = false;
    session.state = "navigating";
    session.isNavigating = true;
    session.navigatingLabel = `Page ${currentPageNum} → Page ${nextPageNum}`;
    session.statusMessage = "Navigating...";
    session.checkpointSessionSync();
  }

  const oldUrl = location.href;
  const oldFirstProfile =
    document.querySelector('a[href*="/in/"]')?.href || null;

  try {
    console.log("[WarmGraph][PeopleSearch] autoAdvance clicking Next", { currentPageNum, nextPageNum, url: location.href });

    const scrollTarget = next.closest?.("button, a") || next;
    try {
      if (typeof scrollTarget.scrollIntoView === "function") {
        scrollTarget.scrollIntoView({
          block: "center",
          behavior: "smooth"
        });
      }
    } catch (_) {}

    await sleep(400);
    if (session && session.finishRequested) return false;

    // LinkedIn may replace pagination while the action delay is running.
    next = findEnabledPeopleSearchNextButton();
    if (!next) throw new Error("Next button unavailable after pagination re-render");

    const clickTarget = next.closest?.("button, a") || next;
    const targetHref = clickTarget.getAttribute?.("href") || clickTarget.closest?.("a")?.getAttribute?.("href");

    console.log("[NEXT CLICK]", {
      page: currentPageNum,
      target: nextPageNum,
      url: location.href
    });

    try {
      clickTarget.focus?.();
    } catch (_) {}

    if (typeof clickTarget.click === "function") {
      clickTarget.click();
    }

    console.log("[WarmGraph][PeopleSearch] autoAdvance: click returned", {
      page: currentPageNum,
      expectedNextPage: nextPageNum,
      url: location.href
    });

    const navigated = await waitForNewPageRender({
      oldUrl,
      oldFirstProfileUrl: oldFirstProfile,
      oldPageNum: currentPageNum,
      shouldCancel: () => !!(session && session.finishRequested),
      timeoutMs: 12000
    });
    console.log("[WarmGraph][PeopleSearch] autoAdvance: waitForNewPageRender resolved", {
      navigated,
      page: currentPageNum,
      url: location.href,
      engineType: getAcquisitionEngineType()
    });

    if (!navigated && session && session.finishRequested) return false;
    if (!navigated) {
      throw new Error("SPA navigation timeout");
    }

    await waitForPeopleCards();
    console.log("[WarmGraph][ARRIVED]", {
      page: extractPaginationStateFromDom().currentPage,
      url: location.href
    });

    console.log("[WarmGraph] Now on:", location.href);

  } catch (err) {
    console.error("[WarmGraph] Pagination failed:", err);

    if (session) {
      console.error("[WarmGraph][PeopleSearch] state transition: navigating -> interrupted", { message: err.message, url: location.href });
      session.state = "interrupted";
      session.isNavigating = false;
      session.navigatingLabel = null;
      session.statusMessage = "Pagination failed";
      session.checkpointSessionSync();
    }

    return false;
  }

  if (session) {
    console.log("[WarmGraph][PeopleSearch] state transition: navigating -> acquiring", { page: nextPageNum, url: location.href });
    session.state = "acquiring";
    session.isNavigating = false;
    session.navigatingLabel = null;
    session.statusMessage = "Auto Extracting";
    session.pageCount = nextPageNum;
    session.checkpointSessionSync();
  }

  return true;
}

function extractPaginationStateFromDom() {
  const result = {
    currentPage: 1,
    totalPages: 1,
    hasNext: false
  };

  debugPaginationRoots();
  const root = getPeopleSearchPaginationRoot();

  console.log("[PAGINATION ROOT]", {
    found: !!root,
    text: root?.textContent?.replace(/\s+/g, " ").trim()
  });

  if (!root) {
    console.log("[WarmGraph] pageState", result);
    return result;
  }

  const active =
    root.querySelector('[aria-current="true"]') ||
    root.querySelector(".artdeco-pagination__indicator--number.active");

  if (active) {
    const n = parseInt(active.textContent.trim(), 10);
    if (!Number.isNaN(n)) result.currentPage = n;
  }

  const nums = [...root.querySelectorAll("button, a, [role='button'], .artdeco-pagination__indicator")]
    .map(el => parseInt(el.textContent.trim(), 10))
    .filter(Number.isFinite);

  if (nums.length) {
    result.totalPages = Math.max(...nums);
  } else {
    result.totalPages = result.currentPage;
  }

  result.hasNext = !!findEnabledPeopleSearchNextButton();
  console.log("[WarmGraph] pageState", result);
  return result;
}

async function ensurePaginationVisible() {
  let lastHeight = 0;

  for (let i = 0; i < 8; i++) {
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: "smooth"
    });

    await new Promise(r => setTimeout(r, 700));

    const h = document.body.scrollHeight;
    if (h === lastHeight) break;
    lastHeight = h;
  }
}

function getCardLines(card) {
  return (card.innerText || "")
    .split("\n")
    .map(cleanText)
    .filter(Boolean);
}


function getSemanticText(root, patterns) {
  if (!root || typeof root.querySelector !== "function") {
    return null;
  }

  for (const selector of patterns) {
    const element =
      root.querySelector(selector);

    const text = cleanText(
      element &&
      (element.innerText || element.textContent)
    );

    if (text) {
      return text;
    }
  }

  return null;
}


function removeKnownText(value, knownValues) {
  let result = value;

  for (const knownValue of knownValues) {
    if (knownValue) {
      result = result.replace(
        knownValue,
        " "
      );
    }
  }

  return cleanText(result);
}


// =========================================================
// PROFILE / CARD DETECTION
// =========================================================

function getProfileAnchor(root) {
  const rawAnchors = root.querySelectorAll ? root.querySelectorAll('a[href*="/in/"]') : [];
  const primaryAnchors = Array.from(rawAnchors).filter(
    a => !a.closest?.('.entity-result__simple-insight, [data-field="mutual-connections"], [class*="mutual"]')
  );
  const anchors = primaryAnchors.length > 0 ? primaryAnchors : rawAnchors;
  let mainAnchor = null;
  let profileUrl = null;

  for (const anchor of anchors) {
    const norm = normalizeProfileUrl(anchor.href);
    if (norm) {
      mainAnchor = anchor;
      profileUrl = norm;
      break;
    }
  }

  if (!profileUrl) {
    if (root.tagName === "A" && root.href) {
      profileUrl = normalizeProfileUrl(root.href);
      mainAnchor = root;
    }
  }

  if (!profileUrl || !mainAnchor) return null;

  // Search explicit name elements in root
  const semanticName = getSemanticText(root, [
    "[data-test-person-name]",
    '[class*="name"]',
    '[class*="title"]',
    "h3",
    "h4",
    'span[aria-hidden="true"]'
  ]);

  const rawText = semanticName || cleanText(mainAnchor.innerText || mainAnchor.textContent || root.innerText || root.textContent);
  const name = cleanText(rawText)
    .replace(/\b(1st|2nd|3rd\+)(?!\w)/gi, "")
    .replace(/\b(connected\s*(?:on)?.*)/gi, "")
    .replace(/\b(message|connect|follow|remove)\b/gi, "")
    .replace(/[•·|,:-]+$/, "")
    .trim();

  if (name && name.length >= 2) {
    return {
      anchor: mainAnchor,
      profile_url: profileUrl,
      name
    };
  }

  return null;
}


function getCardRoot(anchor) {
  let current = anchor;
  let bestCandidate = anchor.parentElement || anchor;

  for (let i = 0; i < 8 && current && current !== document.body && current !== document.documentElement; i++) {
    const tag = current.tagName ? current.tagName.toLowerCase() : "";
    const role = current.getAttribute ? current.getAttribute("role") : null;
    const cls = current.className || "";

    const isExplicitCard = (
      tag === "li" ||
      role === "listitem" ||
      /card|entity|result|item|member|person|scaffold/i.test(cls)
    );

    const text = cleanText(current.innerText);

    if (isExplicitCard && text.length >= 10 && text.length <= 4000) {
      return current;
    }

    if (text.length >= 12 && text.length <= 3500) {
      bestCandidate = current;
    }

    current = current.parentElement;
  }

  return bestCandidate;
}


// =========================================================
// DEGREE
// =========================================================

function extractDegree(text) {

  const match =
    text.match(
      /\b(1st|2nd|3rd\+)(?!\w)/
    );

  return match
    ? match[1]
    : null;
}


// =========================================================
// MUTUAL CONNECTIONS
// =========================================================

function getRelationshipLines(card) {
  return getCardLines(card)
    .map(cleanText);
}


function extractMutualConnectionsText(
  card,
  text
) {

  const semanticMutual =
    getSemanticText(card, [
      '[data-field="mutual-connections"]',
      '[data-test-mutual-connections]',
      '[class*="mutual"]'
    ]);


  if (
    semanticMutual &&
    /mutual connections?/i.test(
      semanticMutual
    )
  ) {
    return semanticMutual;
  }


  const lines =
    getRelationshipLines(card);


  const mutualLine =
    lines.find((line) =>
      /mutual connections?/i.test(
        line
      )
    );


  if (mutualLine) {

    const mutualMatch =
      mutualLine.match(
        /([A-Za-z][^.!?]*?\b(?:mutual connections?|mutual connection)\b)/i
      );

    if (mutualMatch) {
      return cleanText(
        mutualMatch[1]
      );
    }
  }


  const afterDegree =
    text.replace(
      /^.*?\b(?:1st|2nd|3rd\+)(?!\w)/i,
      ""
    );


  const locationMatch =
    afterDegree.match(
      /\b[A-Z][^,\n]+,\s*[A-Z][^,\n]+(?:,\s*[A-Z][^,\n]+)?/
    );


  const afterLocation =
    locationMatch
      ? afterDegree.slice(
          locationMatch.index +
          locationMatch[0].length
        )
      : afterDegree;


  const match =
    afterLocation.match(
      /([^.!?]*?\b(?:mutual connections?|mutual connection)\b)/i
    );


  return match
    ? cleanText(match[1])
    : null;
}


function normalizeNameForComparison(value) {

  return (value || "")
    .toLocaleLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    )
    .trim();
}


function extractMutualConnectionNames(
  mutualText,
  targetName
) {

  if (!mutualText) {
    return [];
  }


  let namesText =
    mutualText
      .replace(
        /\s*&\s*\d+\s+other\s+mutual\s+connections?\s*$/i,
        ""
      )
      .replace(
        /\s+and\s+\d+\s+other\s+mutual\s+connections?\s*$/i,
        ""
      )
      .replace(
        /\s+other\s+mutual\s+connections?\s*$/i,
        ""
      )
      .replace(
        /\s+(?:is\s+a\s+mutual\s+connection|are\s+mutual\s+connections?)\s*$/i,
        ""
      )
      .trim();


  const targetNameKey =
    normalizeNameForComparison(
      targetName
    );


  /*
   * Handles:
   *
   * Person A is a mutual connection
   *
   * Person A and Person B are mutual connections
   *
   * Person A, Person B and Person C
   */

  return namesText
    .split(
      /\s*(?:,|&|\band\b)\s*/i
    )
    .map(cleanText)
    .filter(Boolean)
    .filter(
      (name) =>
        normalizeNameForComparison(
          name
        ) !== targetNameKey
    );
}


// =========================================================
// LOCATION
// =========================================================

function extractLocation(
  card,
  text,
  mutualText
) {

  const semanticLocation =
    getSemanticText(card, [
      '[data-field="location"]',
      '[data-test-location]',
      '[class*="location"]'
    ]);


  if (semanticLocation) {
    return semanticLocation;
  }


  const lines =
    getRelationshipLines(card);


  const mutualIndex =
    lines.findIndex((line) =>
      /mutual connections?/i.test(
        line
      )
    );


  const locationCandidates =
    lines
      .slice(
        0,
        mutualIndex >= 0
          ? mutualIndex
          : lines.length
      )
      .filter((line) =>
        line.includes(",") &&
        !/\b(?:1st|2nd|3rd\+)(?!\w)/i.test(line) &&
        !/mutual connections?/i.test(line)
      );


  if (
    locationCandidates.length > 0
  ) {

    return locationCandidates[
      locationCandidates.length - 1
    ];
  }


  const withoutPrefix =
    text.replace(
      /^.*?\b(?:1st|2nd|3rd\+)(?!\w)/i,
      ""
    );


  const beforeMutual =
    mutualText
      ? withoutPrefix.split(
          mutualText
        )[0]
      : withoutPrefix;


  const matches =
    beforeMutual.match(
      /\b[A-Z][^,\n]+,\s*[A-Z][^,\n]+(?:,\s*[A-Z][^,\n]+)?/g
    );


  return matches
    ? cleanText(
        matches[matches.length - 1]
      )
    : null;
}


// =========================================================
// FOLLOWERS
// =========================================================

function extractFollowers(
  card,
  text
) {

  const semanticFollowers =
    getSemanticText(card, [
      '[data-field="followers"]',
      '[data-test-followers]',
      '[class*="follower"]'
    ]);


  if (semanticFollowers) {
    return semanticFollowers;
  }


  const match =
    text.match(
      /\b[\d,.]+(?:K|M|B)?\s+followers\b/i
    );


  return match
    ? cleanText(match[0])
    : null;
}


// =========================================================
// HEADLINE
// =========================================================

function extractHeadline(
  card,
  text,
  name,
  degree,
  location,
  mutualText,
  followers
) {

  /*
   * First preference:
   * explicit headline element.
   */

  const semanticHeadline =
    getSemanticText(card, [
      '[data-field="headline"]',
      '[data-test-headline]',
      '[class*="headline"]'
    ]);


  if (
    semanticHeadline &&
    semanticHeadline !== name &&
    semanticHeadline !== location
  ) {
    return semanticHeadline;
  }


  /*
   * Second preference:
   * inspect individual card lines.
   *
   * Typical synthetic card:
   *
   * Target Person
   * Head of Corporate Development at Company B
   * 2nd
   * Person A is a mutual connection
   * Bengaluru, Karnataka, India
   * Connect
   */


  const lines =
    getRelationshipLines(card);


  const degreeIndex =
    lines.findIndex((line) =>
      new RegExp(
        `\\b${degree.replace(
          "+",
          "\\+"
        )}(?!\\w)`,
        "i"
      ).test(line)
    );


  const mutualIndex =
    lines.findIndex((line) =>
      /mutual connections?/i.test(
        line
      )
    );


  /*
   * Search the complete card for a likely
   * headline, excluding known metadata.
   */

  const candidateLines =
    lines.filter((line, index) => {

      if (line === name) {
        return false;
      }

      if (line === location) {
        return false;
      }

      if (line === followers) {
        return false;
      }

      if (
        degree &&
        new RegExp(
          `\\b${degree.replace(
            "+",
            "\\+"
          )}(?!\\w)`,
          "i"
        ).test(line)
      ) {
        return false;
      }

      if (
        /mutual connections?/i.test(
          line
        )
      ) {
        return false;
      }

      if (
        /^(connect|follow|message)$/i.test(
          line
        )
      ) {
        return false;
      }

      if (
        /^[\d,.]+(?:K|M|B)?\s+followers$/i.test(
          line
        )
      ) {
        return false;
      }

      return true;
    });


  /*
   * The first remaining meaningful line is
   * normally the headline.
   */

  if (
    candidateLines.length > 0
  ) {
    return candidateLines[0];
  }


  /*
   * Final fallback.
   */

  let remainder =
    text.replace(
      new RegExp(
        `^.*?\\b${degree.replace(
          "+",
          "\\+"
        )}(?!\\w)`,
        "i"
      ),
      ""
    );


  remainder =
    removeKnownText(
      remainder,
      [
        location,
        mutualText,
        followers,
        name
      ]
    );


  remainder =
    remainder.replace(
      /\b(?:connect|follow|message)\b/gi,
      " "
    );


  return (
    cleanText(remainder) ||
    null
  );
}


// =========================================================
// FIRST-DEGREE CONNECTION
// =========================================================

function extractFirstDegreeCard(
  card,
  profileAnchor
) {
  const text = cleanText(card.innerText);
  const isConnPage = isApprovedExtractionPage();
  const isFirstDegreeSearch = getAcquisitionEngineType() === "PEOPLE_SEARCH" && getSelectedPeopleSearchDegree() === "F";

  // Require "connected" or "1st" degree indicator ONLY if NOT on approved extraction page
  const hasConnectedIndicator = /connected/i.test(text) || /\b1st\b/i.test(text) || isFirstDegreeSearch;
  if (!isConnPage && !hasConnectedIndicator) {
    return null;
  }
  if (!isFirstDegreeSearch && /\b(2nd|3rd\+?)\b/i.test(text) && !hasConnectedIndicator && !isConnPage) {
    return null;
  }

  const lines = getCardLines(card);

  const connectedLine = lines.find((line) => /connected/i.test(line));

  const connectionDate = connectedLine
    ? cleanText(connectedLine.replace(/.*connected\s*(?:on)?\s*/i, ""))
    : null;

  const headlineCandidates = lines.filter((line) =>
    line !== profileAnchor.name &&
    !/connected/i.test(line) &&
    !/^(message|follow|connect|remove)$/i.test(line) &&
    !/\b1st\b/i.test(line)
  );

  const headline = headlineCandidates.length > 0 ? headlineCandidates[0] : null;
  const companyRes = resolveCompanyAndRoleType(card, text, headline);

  const locationLine = lines.find((line) =>
    line !== profileAnchor.name &&
    line !== headline &&
    !/connected/i.test(line) &&
    !/^(message|follow|connect|remove)$/i.test(line) &&
    !/\b(1st|2nd|3rd\+?)\b/i.test(line) &&
    /\b[A-Z][A-Za-z0-9\s.-]+,\s*[A-Z][A-Za-z0-9\s.-]+/i.test(line)
  );

  const mutualText = extractMutualConnectionsText(card, text);

  return {
    name: profileAnchor.name,
    profile_url: profileAnchor.profile_url,
    degree: "1st",
    connection_date: connectionDate,
    headline,
    company: companyRes.company,
    role_type: companyRes.role_type,
    location: locationLine || null,
    mutual_info: mutualText || null,
    relationship_type: "KNOWS",
    evidence_type: "connection_card",
    source: "linkedin_dom",
    page_url: typeof window !== "undefined" ? window.location.href : "",
    visible_text: text.slice(0, 500)
  };
}


// =========================================================
// RELATIONSHIP EVIDENCE
// =========================================================

function extractRelationshipEvidence(
  card,
  profileAnchor
) {

  const text =
    cleanText(card.innerText);


  const observedDegree =
    extractDegree(text);


  if (
    !observedDegree ||
    observedDegree === "1st"
  ) {
    return null;
  }


  const mutualText =
    extractMutualConnectionsText(
      card,
      text
    );


  if (
    observedDegree === "2nd" &&
    !mutualText
  ) {
    return null;
  }


  const mutualConnectionNames =
    extractMutualConnectionNames(
      mutualText,
      profileAnchor.name
    );


  const location =
    extractLocation(
      card,
      text,
      mutualText
    );


  const followers =
    extractFollowers(
      card,
      text
    );


  const headline =
    extractHeadline(
      card,
      text,
      profileAnchor.name,
      observedDegree,
      location,
      mutualText,
      followers
    );

  const companyRes = resolveCompanyAndRoleType(card, text, headline);

  return {
    name:
      profileAnchor.name,

    profile_url:
      profileAnchor.profile_url,

    observed_degree:
      observedDegree,

    headline,

    company:
      companyRes.company,

    role_type:
      companyRes.role_type,

    location,

    followers,

    mutual_connections_text:
      mutualText,

    mutual_connection_names:
      mutualConnectionNames,

    relationship_type:
      "OBSERVED_RELATIONSHIP",

    evidence_type:
      observedDegree === "2nd"
        ? "mutual_connection_ui"
        : "degree_indicator",

    source:
      "linkedin_dom",

    page_url:
      window.location.href,

    captured_at:
      new Date().toISOString(),

    visible_text:
      text
  };
}


// =========================================================
// RECORD MERGING
// =========================================================

function mergeRecord(previous = {}, current = {}) {
  const merged = { ...previous };

  for (const [key, value] of Object.entries(current)) {
    if (value !== null && value !== undefined && value !== "") {
      merged[key] = value;
    }
  }

  for (const k in previous) {
    if (previous[k] && !merged[k]) {
      merged[k] = previous[k];
    }
  }

  // Entity Extraction Enhancement (Task 9.2): Re-verify company normalization & resolution
  const companyRes = resolveCompanyAndRoleType(null, merged.visible_text || "", merged.headline || "", merged);
  if (companyRes.company) {
    merged.company = companyRes.company;
  }
  if (companyRes.role_type && !merged.role_type) {
    merged.role_type = companyRes.role_type;
  }

  return merged;
}


function recordFingerprint(record) {
  return JSON.stringify(
    record,
    Object.keys(record).sort()
  );
}


// =========================================================
// PAGE SCAN
// =========================================================

function scanLinkedInPage() {

  let firstDegreeAdded = 0;
  let firstDegreeUpdated = 0;

  let relationshipEvidenceAdded = 0;
  let relationshipEvidenceUpdated = 0;

  if (getAcquisitionEngineType() === "PEOPLE_SEARCH" && !getSelectedPeopleSearchDegree()) {
    return {
      first_degree_added: 0,
      first_degree_updated: 0,
      relationship_evidence_added: 0,
      relationship_evidence_updated: 0
    };
  }


  for (
    const anchor of document.querySelectorAll(
      'a[href*="/in/"]'
    )
  ) {

    const profileUrl =
      normalizeProfileUrl(
        anchor.href
      );


    if (!profileUrl) {
      continue;
    }


    const card =
      getCardRoot(anchor);


    if (!card) {
      continue;
    }


    const profileAnchor =
      getProfileAnchor(card);


    if (
      !profileAnchor ||
      profileAnchor.profile_url !== profileUrl
    ) {
      continue;
    }


    const firstDegree =
      extractFirstDegreeCard(
        card,
        profileAnchor
      );


    if (firstDegree) {

      const existing =
        connectionStore.get(
          profileUrl
        );


      connectionStore.set(
        profileUrl,
        mergeRecord(
          existing || {},
          firstDegree
        )
      );


      if (!existing) {
        firstDegreeAdded++;
      } else if (
        recordFingerprint(existing) !==
        recordFingerprint(firstDegree)
      ) {
        firstDegreeUpdated++;
      }


      continue;
    }


    const evidence =
      extractRelationshipEvidence(
        card,
        profileAnchor
      );


    if (!evidence) {
      continue;
    }


    const key =
      `${profileUrl}|${evidence.observed_degree}`;


    const existing =
      relationshipEvidenceStore.get(
        key
      );


    relationshipEvidenceStore.set(
      key,
      mergeRecord(
        existing || {},
        evidence
      )
    );


    if (!existing) {
      relationshipEvidenceAdded++;
    } else if (
      recordFingerprint(existing) !==
      recordFingerprint(evidence)
    ) {
      relationshipEvidenceUpdated++;
    }
  }


  return {

    first_degree_added:
      firstDegreeAdded,

    first_degree_updated:
      firstDegreeUpdated,

    relationship_evidence_added:
      relationshipEvidenceAdded,

    relationship_evidence_updated:
      relationshipEvidenceUpdated
  };
}


// =========================================================
// MANUAL EXTRACTION TRIGGER
// =========================================================

function scanAndMaybeSync() {

  const result =
    scanLinkedInPage();


  try {

    chrome.runtime.sendMessage({
      action:
        "clearRefreshBadge"
    });

  } catch (error) {

    // Safe to ignore if the extension
    // was reloaded while this page was open.

  }


  return result;
}


// =========================================================
// BOTTOM CONTAINER DIAGNOSTICS & TELEMETRY
// =========================================================

let lastObservedScrollEvent = null;
let scrollTelemetryListener = null;

if (typeof window !== "undefined") {
  scrollTelemetryListener = (e) => {
    try {
      const target = e.target;
      let desc = "window";
      if (target && target !== window && target !== document) {
        const tag = target.tagName ? target.tagName.toLowerCase() : "";
        const idStr = target.id ? `#${target.id}` : "";
        const cls = target.className ? `.${target.className.toString().trim().split(/\s+/).join('.')}` : "";
        desc = `${tag}${idStr}${cls}`;
      }
      lastObservedScrollEvent = {
        timestamp: Date.now(),
        targetDescription: desc
      };
    } catch (err) {}
  };
  window.addEventListener("scroll", scrollTelemetryListener, { capture: true, passive: true });
}

function inspectBottomTelemetry(container, loader, preCardCount, postCardCount, preScrollHeight, postScrollHeight, waitMetrics) {
  if (!container) return null;

  const scrollTop = container.scrollTop !== undefined ? container.scrollTop : (typeof window !== "undefined" ? window.scrollY : 0);
  const scrollHeight = container.scrollHeight || 0;
  const clientHeight = container.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 0);
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  const distanceFromBottom = Math.max(0, maxScrollTop - scrollTop);

  const containerRect = container.getBoundingClientRect ? container.getBoundingClientRect() : null;

  let loaderRect = null;
  let loaderVisibleInContainer = false;
  if (loader) {
    if (loader.getBoundingClientRect) {
      const r = loader.getBoundingClientRect();
      loaderRect = {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        width: Math.round(r.width),
        height: Math.round(r.height)
      };
      if (containerRect) {
        loaderVisibleInContainer = r.top >= containerRect.top - 100 && r.bottom <= containerRect.bottom + 100;
      } else {
        loaderVisibleInContainer = r.top >= 0 && r.bottom <= (typeof window !== "undefined" ? window.innerHeight : 1000);
      }
    }
  }

  const bottomElements = [];
  try {
    const listRoot = container.querySelector ? (container.querySelector('.scaffold-finite-scroll__content, ul, ol') || container) : container;
    const children = listRoot.children || [];
    const childCount = children.length;
    const startIndex = Math.max(0, childCount - 8);

    for (let i = startIndex; i < childCount; i++) {
      const el = children[i];
      if (!el) continue;
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      const cls = el.className ? `.${el.className.toString().trim().split(/\s+/).join('.')}` : "";
      const idStr = el.id ? `#${el.id}` : "";
      const textSnippet = (el.innerText || el.textContent || "").slice(0, 40).replace(/\s+/g, " ").trim();
      let rectStr = "";
      if (el.getBoundingClientRect) {
        const r = el.getBoundingClientRect();
        rectStr = `[top:${Math.round(r.top)}, bot:${Math.round(r.bottom)}, h:${Math.round(r.height)}]`;
      }
      bottomElements.push(`${tag}${idStr}${cls} ${rectStr} "${textSnippet}"`);
    }
  } catch (e) {}

  const scrollEventObserved = (lastObservedScrollEvent && (Date.now() - lastObservedScrollEvent.timestamp < 4000)) ? "YES" : "NO";
  const scrollEventTarget = lastObservedScrollEvent ? lastObservedScrollEvent.targetDescription : "None";

  const wm = waitMetrics || {};

  return {
    scrollEventObserved,
    scrollEventTarget,
    scrollTop: Math.round(scrollTop * 10) / 10,
    maxScrollTop: Math.round(maxScrollTop * 10) / 10,
    distanceFromBottom: Math.round(distanceFromBottom * 10) / 10,
    scrollHeightBefore: Math.round((preScrollHeight || scrollHeight) * 10) / 10,
    scrollHeightAfter: Math.round((postScrollHeight || scrollHeight) * 10) / 10,
    cardCountBefore: preCardCount,
    cardCountAfter: postCardCount,
    profileLinkCountBefore: preCardCount,
    profileLinkCountAfter: postCardCount,
    mutationsObserved: wm.mutationRecordCount !== undefined ? `${wm.mutationRecordCount} records` : (wm.mutationObserved ? "YES" : "NO"),
    newDomNodes: wm.addedSummary || "None",
    tempLoadingDetected: wm.tempLoadingDetected || "None detected",
    elementsNearBottom: bottomElements,
    loaderFound: !!loader,
    loaderBoundingClientRect: loaderRect,
    loaderVisibleInContainer,
    mutationObserved: wm.mutationObserved ? "YES" : "NO",
    newCards: Math.max(0, postCardCount - preCardCount)
  };
}


function mergeRecord(existing = {}, fresh = {}) {
  const merged = { ...existing, ...fresh };
  for (const k in existing) {
    if (existing[k] && !fresh[k]) {
      merged[k] = existing[k];
    }
  }

  const companyRes = resolveCompanyAndRoleType(null, merged.visible_text || "", merged.headline || "", merged);
  if (companyRes.company) {
    merged.company = companyRes.company;
  }
  if (companyRes.role_type && !merged.role_type) {
    merged.role_type = companyRes.role_type;
  }

  return merged;
}

const ACQUISITION_MIN_DELAY_MS = 2000;
const ACQUISITION_MAX_DELAY_MS = 5000;

function getRandomAcquisitionDelayMs() {
  if (typeof window !== "undefined" && window.TEST_ACQUISITION_DELAY_MS !== undefined) {
    return window.TEST_ACQUISITION_DELAY_MS;
  }
  return Math.floor(Math.random() * (ACQUISITION_MAX_DELAY_MS - ACQUISITION_MIN_DELAY_MS + 1)) + ACQUISITION_MIN_DELAY_MS;
}

async function startAutomaticAcquisition() {
  const engineType = getAcquisitionEngineType();
  console.log("[WarmGraph] Engine:", engineType, { pathname: location.pathname, search: location.search });
  if (!isApprovedExtractionPage()) {
    console.log("[WarmGraph] Auto-start returned: page is not approved", { engineType, url: location.href });
    return;
  }

  if (acquisitionSession.manuallyFinished) {
    console.log("[WarmGraph] Auto-start skipped: session was manually finished");
    return;
  }

  if (acquisitionSession.state === "completed" || acquisitionSession.state === "resting" || acquisitionSession.completionStatus === "complete") {
    if (engineType === "PEOPLE_SEARCH") {
      console.log("[WarmGraph] Resetting completed/resting session for fresh People Search crawl");
      acquisitionSession.reset(true);
      acquisitionSession.activeDegreeFilter = getSelectedPeopleSearchDegree();
      acquisitionSession.engineType = "PEOPLE_SEARCH";
    }
  }

  if (window.__warmgraphAcquisitionRunning || acquisitionSession.isRunning || acquisitionSession.activeLoopPromise) {
    console.log("[WarmGraph] Auto-start returned: existing session", {
      state: acquisitionSession.state,
      running: !!window.__warmgraphAcquisitionRunning,
      url: location.href
    });
    return;
  }

  console.log("[WarmGraph] Auto starting extraction", { engineType, url: location.href });
  return acquisitionSession.start("acquiring");
}

class ConnectionAcquisitionSession {
  get running() {
    return !!(
      this.isRunning ||
      (typeof window !== "undefined" && window.__warmgraphAcquisitionRunning) ||
      this.activeLoopPromise
    );
  }

  constructor() {
    this.sessionId = `warmgraph_session_${Date.now()}`;
    this.connections = new Map();
    this.relationshipEvidence = new Map();
    this.seenProfiles = new Set();
    this.hasSavedSession = false;
    this._hydrationPromise = null;
    this.reset(false);
  }

  reset(clearStores = false) {
    this.state = "idle";
    this.finishRequested = false;
    this.pauseRequested = false;
    this.manuallyFinished = false;
    this.activeDegreeFilter = null;
    this.pendingDegreeRestart = null;
    if (clearStores) {
      this.sessionId = `warmgraph_session_${Date.now()}`;
      this.connections = new Map();
      this.relationshipEvidence = new Map();
      this.seenProfiles = new Set();
      this.hasSavedSession = false;
    }
    if (!this.connections) {
      this.connections = new Map();
    }
    if (!this.relationshipEvidence) {
      this.relationshipEvidence = new Map();
    }
    if (!this.seenProfiles) {
      this.seenProfiles = new Set();
    }
    this.lockedPath = CONNECTIONS_LOCKED_PATH;
    this.pausedRemainingMs = null;
    this.pageCount = 0;
    this.currentPage = 0;
    this.totalPages = 0;
    this.pageExtractionComplete = false;
    this.expectedTotal = 0;
    this.isPartial = false;
    this.statusMessage = "";
    this.syncStatus = "idle";
    this.syncMessage = "";
    this.lastBatchNewConnections = 0;
    this.lastBatchNewEvidence = 0;
    this.countdownSeconds = 0;
    this.nextSyncDelay = 0;
    this.nextBatchAt = null;
    this.nextSyncAt = null;
    this.activeFilter = null;
    this.activeLoopPromise = null;
    this.shouldCancel = false;
    this.isTabHidden = false;
  }

  checkpointSessionSync() {
    const status = this.getStatus();

    // ─── CANONICAL currentSession (Single Source of Truth) ───────────────────
    // content.js is the ONLY writer. overlay.js and popup.js are pure readers.
    const engineType = status.engineType || status.engine_type || getAcquisitionEngineType() || this.engineType || "CONNECTIONS";
    const canonicalTotal = engineType === "PEOPLE_SEARCH"
      ? (this.totalConnections ?? 0)
      : (this.totalConnections || status.totalConnections || status.expected_total || 0);
    let rawExtracted = this.connections ? this.connections.size : (status.extractedConnections || status.collected_count || 0);
    const canonicalStateRaw = status.state || "idle";
    const isCompleteState = canonicalStateRaw === "resting" || canonicalStateRaw === "completed" || this.completionStatus === "complete";

    let canonicalActual = (this.actualProfiles && this.actualProfiles > 0)
      ? this.actualProfiles
      : (isCompleteState && rawExtracted > 0 ? rawExtracted : (canonicalTotal > 0 ? canonicalTotal : rawExtracted));

    if (isCompleteState && rawExtracted > 0) {
      canonicalActual = rawExtracted;
      this.actualProfiles = rawExtracted;
    }

    const canonicalComplete = isCompleteState || (canonicalActual > 0 && rawExtracted >= canonicalActual);
    const canonicalExtracted = rawExtracted;

    let canonicalState = canonicalStateRaw;
    if ((canonicalStateRaw === "resting" || canonicalStateRaw === "completed") && !canonicalComplete) {
      canonicalState = "paused";
    }

    const canonicalPct = canonicalActual > 0
      ? (canonicalComplete ? 100 : Math.min(99, Math.round((canonicalExtracted / canonicalActual) * 100)))
      : (canonicalExtracted > 0 ? 100 : 0);

    const profileUrlList = Array.from(this.connections.values())
      .map(c => c.profile_url)
      .filter(Boolean);

    const pagState = extractPaginationStateFromDom();
    if (engineType === "PEOPLE_SEARCH" && getAcquisitionEngineType() === "PEOPLE_SEARCH") {
      this.currentPage = pagState.currentPage || this.currentPage;
      this.totalPages = Math.max(this.totalPages || 0, pagState.totalPages || 0, this.currentPage || 0);
    }
    const currentPage = this.currentPage || pagState.currentPage || this.pageCount || 1;
    const totalPages = this.totalPages || pagState.totalPages || 1;
    const pageLabel = engineType === "PEOPLE_SEARCH"
      ? `Page ${currentPage} of ${totalPages}`
      : (pagState?.label || (this.pageCount > 0 ? `Page ${this.pageCount}` : ""));

    const currentSessionObj = {
      sessionId: this.sessionId,
      engineType,
      engine_type: engineType,
      totalConnections: canonicalTotal,
      actualProfiles: canonicalActual,
      extractedConnections: canonicalExtracted,
      importedRecords: this.importedRecords,
      progressPercent: canonicalPct,
      state: canonicalState,
      degreeFilter: this.activeDegreeFilter || getSelectedPeopleSearchDegree(),
      syncStatus: canonicalComplete ? "synced" : (this.syncStatus || status.sync_status || "idle"),
      lastSyncedAt: canonicalComplete ? (this.lastSyncTimestamp || new Date().toISOString()) : (this.lastSyncTimestamp || null),
      nextBatchAt: canonicalComplete ? null : (status.nextBatchAt || null),
      estimatedRemainingMs: canonicalComplete ? null : (this.estimatedRemainingMs || status.pausedRemainingMs || null),
      lastKnownActualProfiles: canonicalActual,
      currentPage,
      totalPages,
      remainingProfiles: Math.max(0, canonicalActual - canonicalExtracted),
      pausedRemainingMs: canonicalComplete ? null : (status.pausedRemainingMs || null),
      countdownSeconds: canonicalComplete ? 0 : (status.countdown_seconds || 0),
      statusMessage: canonicalComplete ? "You're all caught up ✨" : (status.status_message || ""),
      paginationLabel: pageLabel,
      isNavigating: !!this.isNavigating,
      navigatingLabel: this.navigatingLabel || null,
      known_profile_urls: profileUrlList,
      extracted_count: canonicalExtracted
    };
    // ─────────────────────────────────────────────────────────────────────────

    // Legacy acquisition_session kept for backward-compat with background.js handlers
    const sessionObj = {
      sessionId: this.sessionId,
      engineType,
      engine_type: engineType,
      lockedPath: status.lockedPath || CONNECTIONS_LOCKED_PATH,
      state: canonicalState,
      degreeFilter: this.activeDegreeFilter || getSelectedPeopleSearchDegree(),
      expectedTotal: canonicalTotal,
      totalConnections: canonicalTotal,
      actualProfiles: canonicalActual,
      importedRecords: this.importedRecords,
      pausedRemainingMs: status.pausedRemainingMs,
      collectedConnections: status.connections,
      connections: status.connections,
      collectedCount: canonicalExtracted,
      extractedConnections: canonicalExtracted,
      remainingConnections: status.remainingConnections,
      remaining_count: status.remaining_count,
      progress_percent: canonicalPct,
      progressPercent: canonicalPct,
      nextSyncDelay: status.nextSyncDelay,
      nextBatchAt: status.nextBatchAt,
      nextSyncAt: status.nextSyncAt,
      countdown_seconds: status.countdown_seconds,
      countdownSeconds: status.countdown_seconds,
      active_filter: status.active_filter,
      activeFilter: status.active_filter,
      first_degree_count: status.first_degree_count,
      relationshipEvidence: status.relationship_evidence,
      relationship_evidence: status.relationship_evidence,
      relationshipEvidenceCount: status.relationship_evidence_count,
      pageCount: status.page_count,
      completionStatus: status.completion_status,
      isPartial: status.is_partial,
      statusMessage: status.status_message,
      syncStatus: this.syncStatus || status.sync_status || "idle",
      syncMessage: status.sync_message,
      lastSyncedAt: this.lastSyncTimestamp || null,
      last_synced_at: this.lastSyncTimestamp || null,
      telemetry: status.telemetry,
      paginationLabel: pageLabel,
      known_profile_urls: profileUrlList,
      extracted_count: canonicalExtracted,
      lastUpdated: new Date().toISOString()
    };

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      try {
        const storagePayload = {
          acquisition_session: sessionObj,
          currentSession: currentSessionObj,
          last_synced_profile_urls: profileUrlList,
          known_profile_urls: profileUrlList,
          extracted_count: canonicalExtracted,
          warmgraph_staging_graph: {
            sessionId: this.sessionId,
            connections: Array.from(this.connections.values()),
            updatedAt: new Date().toISOString()
          }
        };

        if (canonicalComplete) {
          storagePayload.warmgraph_active_graph = {
            actualProfiles: canonicalActual,
            totalConnections: canonicalTotal,
            connections: Array.from(this.connections.values()),
            promotedAt: new Date().toISOString()
          };
          storagePayload.warmgraph_sync_journal = null;
        } else {
          storagePayload.warmgraph_sync_journal = {
            sessionId: this.sessionId,
            extractedConnections: canonicalExtracted,
            seenUrls: Array.from(this.seenProfiles),
            scrollCursor: this.pageCount,
            batchNumber: this.pageCount,
            state: canonicalState,
            updatedAt: new Date().toISOString()
          };
        }

        chrome.storage.local.set(storagePayload);
      } catch (e) {}
    }

    if (typeof window !== "undefined" && typeof window.updateWarmGraphOverlay === "function") {
      window.updateWarmGraphOverlay(currentSessionObj);
    }
    this.syncFinishButtonVisibility(currentSessionObj);
  }

  syncFinishButtonVisibility(status = this.getStatus()) {
    if (typeof document === "undefined" || getAcquisitionEngineType() !== "PEOPLE_SEARCH") return;
    const finishButton = document.querySelector("#warmgraph-btn-finish-sync");
    if (!finishButton) return;
    const isCompleted = status.state === "completed" || status.state === "resting";
    const hasNext = extractPaginationStateFromDom().hasNext;
    finishButton.style.display = !isCompleted && this.pageExtractionComplete && !hasNext ? "flex" : "none";
  }

  checkpointSession() {
    this.checkpointSessionSync();
    const status = this.getStatus();
    if (typeof window !== "undefined" && typeof window.updateWarmGraphOverlay === "function") {
      window.updateWarmGraphOverlay(status);
    }
    this.syncFinishButtonVisibility(status);
    const payload = {
      action: "UPDATE_SESSION",
      sessionId: this.sessionId,
      lockedPath: status.lockedPath || CONNECTIONS_LOCKED_PATH,
      connections: status.connections,
      relationship_evidence: status.relationship_evidence,
      expectedTotal: status.expected_total,
      totalConnections: status.totalConnections,
      actualProfiles: status.actualProfiles,
      extractedConnections: status.extractedConnections,
      remainingConnections: status.remainingConnections,
      progressPercent: status.progressPercent,
      pausedRemainingMs: status.pausedRemainingMs,
      nextSyncDelay: status.nextSyncDelay,
      nextBatchAt: status.nextBatchAt,
      nextSyncAt: status.nextSyncAt,
      pageCount: status.page_count,
      state: status.state,
      completionStatus: status.completion_status,
      isPartial: status.is_partial,
      statusMessage: status.status_message,
      syncStatus: status.sync_status,
      syncMessage: status.sync_message,
      telemetry: status.telemetry
    };

    if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
      try {
        chrome.runtime.sendMessage(payload, () => {});
      } catch (e) {}
    }
  }

  async initOrHydrateSession() {
    if (this._hydrationPromise) return this._hydrationPromise;
    this._hydrationPromise = new Promise((resolve) => {
      const applySession = (session, canonical, savedGraphs = {}) => {
        // canonical = the currentSession SSOT object (written by checkpointSessionSync)
        // session   = the legacy acquisition_session (has connection payloads)
        const savedStates = ["acquiring", "collecting", "resumed", "waiting", "waiting_for_content", "settling", "navigating", "paused", "interrupted", "completed", "resting"];
        const merged = (canonical && savedStates.includes(canonical.state))
          ? canonical
          : ((session && savedStates.includes(session.state)) ? session : (canonical || session));
        if (merged && savedStates.includes(merged.state)) {
          this.hasSavedSession = true;
          if (merged.sessionId) this.sessionId = merged.sessionId;
          this.engineType = merged.engineType || merged.engine_type || this.engineType;
          this.activeDegreeFilter = merged.degreeFilter || this.activeDegreeFilter;
          if (merged.lockedPath) this.lockedPath = merged.lockedPath;

          // ── Restore FROZEN totals from canonical SSOT ──────────────────────
          // Never derive actualProfiles from extractedConnections here.
          if (merged.totalConnections) {
            this.totalConnections = merged.totalConnections;
            this.expectedTotal = merged.totalConnections;
            this.actualProfiles = merged.totalConnections;
          } else if (session) {
            const t = session.totalConnections || session.expectedTotal || 0;
            if (t > 0) {
              this.totalConnections = t;
              this.expectedTotal = t;
              this.actualProfiles = t;
            }
          }
          if (merged) {
            const savedActual = merged.lastKnownActualProfiles || merged.actualProfiles || 0;
            if (savedActual > 0 && (!this.actualProfiles || this.actualProfiles < savedActual)) {
              this.actualProfiles = savedActual;
            }
            if (merged.currentPage) this.currentPage = merged.currentPage;
            if (merged.totalPages) this.totalPages = merged.totalPages;
          }
          // ───────────────────────────────────────────────────────────────────

          if (merged.importedRecords !== undefined) this.importedRecords = merged.importedRecords;
          if (merged.pausedRemainingMs !== undefined) this.pausedRemainingMs = merged.pausedRemainingMs;
          if (merged.syncStatus) this.syncStatus = merged.syncStatus;
          if (merged.nextBatchAt) this.nextBatchAt = merged.nextBatchAt;
          if (merged.countdownSeconds !== undefined) this.countdownSeconds = merged.countdownSeconds;

          // Restore connection payload from acquisition_session (has actual arrays)
          const sessionMatches = session && (!session.sessionId || !merged.sessionId || session.sessionId === merged.sessionId);
          const src = sessionMatches ? session : merged;
          if (src.pageCount) this.pageCount = src.pageCount;
          if (src.completionStatus) this.completionStatus = src.completionStatus;
          if (src.isPartial !== undefined) this.isPartial = src.isPartial;
          if (src.statusMessage) this.statusMessage = src.statusMessage;
          if (src.syncMessage) this.syncMessage = src.syncMessage;
          if (src.nextSyncDelay) this.nextSyncDelay = src.nextSyncDelay;
          if (src.nextSyncAt) this.nextSyncAt = src.nextSyncAt;

          const sessionConnections = src.collectedConnections || src.connections || [];
          const graphConnections = savedGraphs.warmgraph_staging_graph?.connections || savedGraphs.warmgraph_active_graph?.connections || [];
          const storedConnections = sessionConnections.length ? sessionConnections : graphConnections;
          storedConnections.forEach(c => {
            const key = this.getDeduplicationKey(c);
            if (key) {
              const existing = this.connections.get(key);
              this.connections.set(key, mergeRecord(existing || {}, c));
              connectionStore.set(key, mergeRecord(connectionStore.get(key) || {}, c));
              this.seenProfiles.add(key);
            }
          });

          const storedEvidence = src.relationshipEvidence || src.relationship_evidence || [];
          storedEvidence.forEach(e => {
            const key = `${this.getDeduplicationKey(e)}|${e.observed_degree || "2nd"}`;
            if (key) {
              const existing = this.relationshipEvidence.get(key);
              this.relationshipEvidence.set(key, mergeRecord(existing || {}, e));
              relationshipEvidenceStore.set(key, mergeRecord(relationshipEvidenceStore.get(key) || {}, e));
              this.seenProfiles.add(key);
            }
          });

          if (!isConnectionsPage()) {
            if (["acquiring", "waiting", "waiting_for_content", "settling", "interrupted"].includes(merged.state)) {
              this.state = "paused";
              this.statusMessage = "Return to Connections to continue syncing.";
              if (merged.nextBatchAt && merged.nextBatchAt > Date.now()) {
                this.pausedRemainingMs = merged.nextBatchAt - Date.now();
              }
            } else {
              this.state = merged.state;
            }
          } else {
            if (merged.state === "paused" && (this.pausedRemainingMs || merged.pausedRemainingMs)) {
              const remMs = this.pausedRemainingMs || merged.pausedRemainingMs;
              this.nextSyncDelay = remMs;
              this.nextBatchAt = Date.now() + remMs;
              this.nextSyncAt = new Date(this.nextBatchAt).toISOString();
            }
            if (merged.state === "acquiring" || merged.state === "interrupted" || merged.state === "paused") {
              this.state = "acquiring";
            } else {
              this.state = merged.state;
            }
          }
        }
        resolve(this.getStatus());
      };

      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(["currentSession", "acquisition_session", "last_synced_profile_urls", "warmgraph_sync_journal", "warmgraph_staging_graph", "warmgraph_active_graph"], (res) => {
            if (res && res.last_synced_profile_urls && Array.isArray(res.last_synced_profile_urls)) {
              if (!this.seenProfiles) this.seenProfiles = new Set();
              res.last_synced_profile_urls.forEach(url => {
                const norm = normalizeProfileUrl(url);
                if (norm) this.seenProfiles.add(`url:${norm}`);
              });
            }
            const journalSeenUrls = res && res.warmgraph_sync_journal && res.warmgraph_sync_journal.seenUrls;
            if (Array.isArray(journalSeenUrls)) {
              journalSeenUrls.forEach(value => {
                const rawUrl = typeof value === "string" && value.startsWith("url:") ? value.slice(4) : value;
                const norm = normalizeProfileUrl(rawUrl);
                if (norm) this.seenProfiles.add(`url:${norm}`);
              });
            }
            applySession(
              res ? res.acquisition_session : null,
              res ? res.currentSession : null,
              res || {}
            );
          });
        } else {
          applySession(null, null);
        }
      } catch (e) {
        applySession(null, null);
      }
    });
    return this._hydrationPromise;
  }

  async resume() {
    await this.initOrHydrateSession();
    if (!this.hasSavedSession) return this.start("acquiring");
    if (["completed", "resting"].includes(this.state)) return this.getStatus();
    if (this.activeLoopPromise || this.isRunning || (typeof window !== "undefined" && window.__warmgraphAcquisitionRunning)) {
      return this.getStatus();
    }
    this.state = "acquiring";
    this.shouldCancel = false;
    return this.start("acquiring");
  }

  async finishAndSync() {
    this.finishRequested = true;
    this.pauseRequested = false;
    this.manuallyFinished = true;
    this.shouldCancel = true;
    if (this.nextBatchResolver) this.nextBatchResolver();
    if (this.activeLoopPromise) {
      await this.activeLoopPromise;
      return this.getStatus();
    }
    await this.completeAndSync();
    return this.getStatus();
  }

  pause() {
    this.pauseRequested = true;
    this.finishRequested = false;
    this.shouldCancel = true;
    if (this.nextBatchResolver) this.nextBatchResolver();
    if (!this.activeLoopPromise) {
      this.state = "paused";
      this.statusMessage = "Progress saved. Continue when you're ready.";
      this.checkpointSessionSync();
    }
  }

  async completeAndSync() {
    this.finishRequested = false;
    this.pauseRequested = false;
    this.manuallyFinished = true;
    this.state = "completed";
    this.completionStatus = "complete";
    this.isPartial = false;
    this.syncStatus = "idle";
    this.statusMessage = "Workspace Up To Date";
    this.nextBatchAt = null;
    this.nextSyncDelay = 0;
    this.countdownSeconds = 0;
    this.pausedRemainingMs = null;
    this.estimatedRemainingMs = null;
    this.actualProfiles = this.connections.size;
    this.totalConnections = this.connections.size;
    this.expectedTotal = this.connections.size;
    await this.checkpointSession();
    await this.autoSyncToBackend();
  }

  getDeduplicationKey(record) {
    if (record.profile_url) {
      const norm = normalizeProfileUrl(record.profile_url);
      if (norm) return `url:${norm}`;
    }
    if (record.provider_id || record.profile_id) {
      return `id:${record.provider_id || record.profile_id}`;
    }
    const normName = normalizeNameForComparison(record.name);
    const fallbackUrl = record.profile_url ? (normalizeProfileUrl(record.profile_url) || "") : "";
    return `name:${normName}|${fallbackUrl}`;
  }

  async scanCurrentPageForUnseen() {
    if (!this.seenProfiles) this.seenProfiles = new Set();
    if (getAcquisitionEngineType() === "PEOPLE_SEARCH" && !getSelectedPeopleSearchDegree()) {
      this.state = "paused";
      this.statusMessage = "Degree filter removed";
      this.checkpointSessionSync();
      return { newProfilesCount: 0, duplicatesSkippedCount: 0, totalVisibleCards: 0 };
    }
    let newProfilesCount = 0;
    let duplicatesSkippedCount = 0;
    const enrichmentPromises = [];
    const uniqueUrls = new Set();

    const rawDomCards = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]') : [];
    const domCards = Array.from(rawDomCards).filter(
      a => !a.closest?.('.entity-result__simple-insight, [data-field="mutual-connections"], [class*="mutual"]')
    );
    const processedCardRoots = new Set();

    for (const anchor of domCards) {
      const profileUrl = normalizeProfileUrl(anchor.href);
      if (!profileUrl) continue;
      uniqueUrls.add(profileUrl);

      const card = getCardRoot(anchor);
      if (!card || processedCardRoots.has(card)) continue;

      const profileAnchor = getProfileAnchor(card);
      let resolvedProfileAnchor = profileAnchor;
      if (!resolvedProfileAnchor && getAcquisitionEngineType() === "PEOPLE_SEARCH") {
        const titleText = getSemanticText(card, [
          ".entity-result__title-text a span[aria-hidden='true']",
          ".entity-result__title-text a",
          "h3",
          "h2"
        ]);
        const anchorText = cleanText(
          titleText || anchor.getAttribute("aria-label") || anchor.innerText || anchor.textContent
        );
        const fallbackName = cleanText(anchorText.split("\n")[0])
          .replace(/^view\s+/i, "")
          .replace(/['’]s\s+profile$/i, "")
          .replace(/\b(1st|2nd|3rd\+)\b/gi, "")
          .replace(/\b(connect|follow|message)\b/gi, "")
          .trim();
        if (fallbackName.length >= 2 && !/^(linkedin member|view profile)$/i.test(fallbackName)) {
          resolvedProfileAnchor = {
            anchor,
            profile_url: profileUrl,
            name: fallbackName
          };
        }
      }
      if (!resolvedProfileAnchor) continue;

      processedCardRoots.add(card);

      // 1. Scroll card into view
      try {
        if (typeof card.scrollIntoView === "function") {
          card.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      } catch (_) {}

      // Scroll delay: 120-180 ms
      await sleep(random(120, 180));

      // Pre-hover delay: 80-120 ms
      await sleep(random(80, 120));

      // Trigger mouse hover
      try {
        const hoverTarget = resolvedProfileAnchor.anchor || anchor;
        hoverTarget.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));
        hoverTarget.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
      } catch (_) {}

      // Hover dwell: 550-750 ms
      await sleep(random(550, 750));

      const firstDegree = extractFirstDegreeCard(card, resolvedProfileAnchor);
      if (firstDegree) {
        const key = this.getDeduplicationKey(firstDegree);
        if (this.seenProfiles.has(key)) {
          duplicatesSkippedCount++;
          const existing = this.connections.get(key);
          if (existing) {
            this.connections.set(key, mergeRecord(existing, firstDegree));
          }
        } else {
          this.seenProfiles.add(key);
          this.connections.set(key, firstDegree);
          connectionStore.set(key, firstDegree);
          newProfilesCount++;
        }

        if (typeof hoverIntelligenceEngine !== "undefined") {
          const p = hoverIntelligenceEngine.waitForProfileEnrichment(this.connections.get(key) || firstDegree, 1200);
          if (p && typeof p.then === "function") {
            enrichmentPromises.push(p);
          }
        }
      } else {
        const evidence = extractRelationshipEvidence(card, resolvedProfileAnchor);
        if (evidence) {
          const key = `${this.getDeduplicationKey(evidence)}|${evidence.observed_degree}`;
          if (this.seenProfiles.has(key)) {
            duplicatesSkippedCount++;
          } else {
            this.seenProfiles.add(key);
            this.relationshipEvidence.set(key, evidence);
            relationshipEvidenceStore.set(key, evidence);
            newProfilesCount++;
          }
        }
      }

      // Between profiles: 60-100 ms
      await sleep(random(60, 100));
    }

    this.lastBatchNewConnections = newProfilesCount;

    return {
      newProfilesCount,
      duplicatesSkippedCount,
      totalVisibleCards: processedCardRoots.size,
      uniqueUrlsCount: uniqueUrls.size,
      enrichmentPromises
    };
  }

  scanCurrentPage() {
    return this.scanCurrentPageForUnseen();
  }

  findScrollContainer(loaderEl) {
    const checkScrollable = (el) => {
      if (!el || el === document.body || el === document.documentElement) return null;
      try {
        const style = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle(el) : {};
        const overflowY = style.overflowY || style.overflow || "";
        const isScrollStyle = overflowY.includes("auto") || overflowY.includes("scroll") || overflowY.includes("overlay");
        if (isScrollStyle && el.scrollHeight > el.clientHeight + 5) {
          return el;
        }
      } catch (e) {}
      return null;
    };

    if (loaderEl) {
      let current = loaderEl.parentElement;
      while (current && current !== document.body && current !== document.documentElement) {
        const res = checkScrollable(current);
        if (res) return res;
        current = current.parentElement;
      }
    }

    const firstCardAnchor = document.querySelector ? document.querySelector('a[href*="/in/"]') : null;
    if (firstCardAnchor) {
      let current = firstCardAnchor.parentElement;
      while (current && current !== document.body && current !== document.documentElement) {
        const res = checkScrollable(current);
        if (res) return res;
        current = current.parentElement;
      }
    }

    const explicitContainers = document.querySelectorAll
      ? document.querySelectorAll('.scaffold-finite-scroll, .scaffold-layout__main, .mn-connections-list, main, section')
      : [];
    for (const el of explicitContainers) {
      const res = checkScrollable(el);
      if (res) return res;
    }

    return null;
  }

  async triggerContainerLoad(attemptNumber = 1) {
    await waitHumanActionDelay("Connection list scroll/load");
    const loader = document.querySelector ? document.querySelector('.scaffold-finite-scroll__loader, #infiniteLoader, [class*="loader"]') : null;

    if (loader && typeof loader.click === "function") {
      try { loader.click(); } catch (e) {}
    }

    if (!this.lastTelemetry) {
      this.lastTelemetry = {};
    }

    const telemetry = this.lastTelemetry;
    telemetry.attempt_number = attemptNumber;
    telemetry.expected_total = this.expectedTotal;
    telemetry.collected_count = this.connections.size;
    telemetry.loader_found = !!loader;
    if (!telemetry.trigger_method) {
      telemetry.trigger_method = "none";
    }

    const container = this.findScrollContainer(loader);
    const preCardCount = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;

    // HOTFIX 13.5.4: Faster Human Scroll (~35% faster): variable distance (180–280px, avg 230px)
    const scrollDistance = Math.floor(Math.random() * (280 - 180 + 1)) + 180;
    // Short settling pause after the deliberate, randomized pre-action delay.
    const scrollDelayMs = Math.floor(Math.random() * (500 - 300 + 1)) + 300;

    if (container) {
      telemetry.scroll_container_description = container.className ? `.${container.className.split(' ').join('.')}` : (container.id ? `#${container.id}` : container.tagName);
      const scrollTopBefore = container.scrollTop || 0;
      const scrollHeight = container.scrollHeight || 0;
      const clientHeight = container.clientHeight || 0;
      const maxScrollTop = Math.max(0, scrollHeight - clientHeight);

      telemetry.scroll_top_before = scrollTopBefore;
      telemetry.scroll_height = scrollHeight;
      telemetry.client_height = clientHeight;

      try {
        if (typeof container.scrollBy === "function") {
          container.scrollBy({ top: scrollDistance, behavior: "smooth" });
        } else {
          container.scrollTop = Math.min(maxScrollTop, scrollTopBefore + scrollDistance);
        }
        telemetry.scroll_top_after = container.scrollTop || 0;
        telemetry.trigger_method = "container_smooth_scrollBy";

        const isNearBottom = maxScrollTop - scrollTopBefore < 100 || container.scrollTop >= maxScrollTop - 10;

        if (isNearBottom) {
          const profileAnchors = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]') : [];
          const lastProfileAnchor = profileAnchors.length > 0 ? profileAnchors[profileAnchors.length - 1] : null;
          const lastCard = lastProfileAnchor ? getCardRoot(lastProfileAnchor) : null;
          const sentinel = loader || lastCard || (container.querySelector ? container.querySelector('.scaffold-finite-scroll__content > *:last-child, ul > *:last-child, li:last-child') : null);

          if (sentinel && typeof sentinel.scrollIntoView === "function") {
            try {
              sentinel.scrollIntoView({ block: "end", behavior: "smooth" });
              telemetry.trigger_method = loader ? "loader_scrollIntoView" : "last_card_scrollIntoView";
            } catch (e) {}
          }

          container.scrollTop = Math.max(0, maxScrollTop - 80);
          container.dispatchEvent(new Event("scroll", { bubbles: true }));
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("scroll", { bubbles: true }));
            window.dispatchEvent(new Event("resize", { bubbles: true }));
          }

          container.scrollTop = maxScrollTop;
          container.dispatchEvent(new Event("scroll", { bubbles: true }));
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("scroll", { bubbles: true }));
            window.dispatchEvent(new Event("resize", { bubbles: true }));
          }
        } else {
          container.dispatchEvent(new Event("scroll", { bubbles: true }));
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("scroll", { bubbles: true }));
          }
        }

        // Wait for smooth animation and human cadence delay
        await new Promise((r) => setTimeout(r, scrollDelayMs));

        // Micro pause: Every 10–15 scrolls, pause for 400–750ms
        this.humanScrollCount = (this.humanScrollCount || 0) + 1;
        if (!this.nextMicroPauseThreshold) {
          this.nextMicroPauseThreshold = Math.floor(Math.random() * (15 - 10 + 1)) + 10;
        }

        if (this.humanScrollCount >= this.nextMicroPauseThreshold) {
          this.humanScrollCount = 0;
          this.nextMicroPauseThreshold = Math.floor(Math.random() * (15 - 10 + 1)) + 10;
          const microPauseMs = Math.floor(Math.random() * (750 - 400 + 1)) + 400;
          await new Promise((r) => setTimeout(r, microPauseMs));
        }

      } catch (e) {}

      telemetry.bottom_telemetry = inspectBottomTelemetry(container, loader, preCardCount, preCardCount, scrollHeight, scrollHeight, null);

      return { success: true, telemetry, container };
    }

    telemetry.scroll_container_description = "window (document.documentElement)";
    const scroller = (document.scrollingElement || document.documentElement || document.body);
    const initialScrollY = typeof window !== "undefined" ? (window.scrollY || window.pageYOffset || (scroller ? scroller.scrollTop : 0)) : 0;
    const docScrollHeight = scroller ? scroller.scrollHeight : (document.documentElement ? document.documentElement.scrollHeight : 0);
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : (scroller ? scroller.clientHeight : 0);

    telemetry.scroll_top_before = initialScrollY;
    telemetry.scroll_height = docScrollHeight;
    telemetry.client_height = viewportHeight;

    try {
      if (typeof window !== "undefined" && typeof window.scrollBy === "function") {
        window.scrollBy({ top: scrollDistance, behavior: "smooth" });
      } else if (scroller) {
        scroller.scrollTop = (scroller.scrollTop || 0) + scrollDistance;
      }
      const newScrollY = typeof window !== "undefined" ? (window.scrollY || window.pageYOffset || (scroller ? scroller.scrollTop : 0)) : 0;
      telemetry.scroll_top_after = newScrollY;
      telemetry.trigger_method = "window_smooth_scrollBy";

      const fallbackAnchors = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]') : [];
      const lastProfileAnchor = fallbackAnchors.length > 0 ? fallbackAnchors[fallbackAnchors.length - 1] : null;
      const lastCard = lastProfileAnchor ? getCardRoot(lastProfileAnchor) : null;
      const sentinel = loader || lastCard;
      if (sentinel && typeof sentinel.scrollIntoView === "function") {
        try { sentinel.scrollIntoView({ block: "end", behavior: "smooth" }); } catch (e) {}
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("scroll", { bubbles: true }));
        window.dispatchEvent(new Event("resize", { bubbles: true }));
      }

      // Wait for smooth animation and human cadence delay
      await new Promise((r) => setTimeout(r, scrollDelayMs));

      // Micro pause: Every 10–15 scrolls, pause for 400–750ms
      this.humanScrollCount = (this.humanScrollCount || 0) + 1;
      if (!this.nextMicroPauseThreshold) {
        this.nextMicroPauseThreshold = Math.floor(Math.random() * (15 - 10 + 1)) + 10;
      }

      if (this.humanScrollCount >= this.nextMicroPauseThreshold) {
        this.humanScrollCount = 0;
        this.nextMicroPauseThreshold = Math.floor(Math.random() * (15 - 10 + 1)) + 10;
        const microPauseMs = Math.floor(Math.random() * (750 - 400 + 1)) + 400;
        await new Promise((r) => setTimeout(r, microPauseMs));
      }

    } catch (e) {}

    telemetry.bottom_telemetry = inspectBottomTelemetry(scroller, loader, preCardCount, preCardCount, docScrollHeight, docScrollHeight, null);

    return { success: true, telemetry, container: scroller };
  }

  async waitForDomCardsToIncrease(previousCardCount, timeoutMs = 500, container = null) {
    const startTime = Date.now();
    const observedAddedNodes = [];
    let mutationRecordCount = 0;
    let tempLoadingDetected = null;

    const targetContainer = container || (document.querySelector ? document.querySelector('main#workspace, main, section') : null) || (document.body || document.documentElement);

    let subObserver = null;
    let interval = null;
    let mutationObserved = false;
    let newCards = 0;

    await new Promise((resolve) => {
      let resolved = false;

      const finishWait = (hasMutation = false, cardDiff = 0) => {
        if (resolved) return;
        resolved = true;
        if (subObserver) {
          try { subObserver.disconnect(); console.log("[WarmGraph] Card wait observer cleaned up", { page: this.pageCount }); } catch (e) {}
        }
        if (interval) clearInterval(interval);
        mutationObserved = hasMutation;
        newCards = cardDiff;
        resolve();
      };

      try {
        if (typeof MutationObserver !== "undefined" && targetContainer) {
          subObserver = new MutationObserver((mutations) => {
            mutationRecordCount += mutations.length;
            for (const m of mutations) {
              if (m.addedNodes && m.addedNodes.length > 0) {
                for (const node of m.addedNodes) {
                  if (node.nodeType === 1) {
                    const tag = node.tagName ? node.tagName.toLowerCase() : "";
                    const cls = node.className ? `.${node.className.toString().trim().split(/\s+/).join('.')}` : "";
                    observedAddedNodes.push(`${tag}${cls}`.slice(0, 50));
                  }
                }
              }
            }
            const currentCards = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;
            if (currentCards > previousCardCount) {
              finishWait(true, currentCards - previousCardCount);
            }
          });
          subObserver.observe(targetContainer, { childList: true, subtree: true });
          console.log("[WarmGraph] Card wait observer created", { page: this.pageCount });
        }
      } catch (e) {}

      if (typeof setInterval === "function") {
        interval = setInterval(() => {
          const currentCards = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;
          if (currentCards > previousCardCount) {
            finishWait(true, currentCards - previousCardCount);
          } else if (Date.now() - startTime >= timeoutMs) {
            finishWait(false, 0);
          }
        }, 250);
      } else {
        const poll = () => {
          const currentCards = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;
          if (currentCards > previousCardCount) {
            finishWait(true, currentCards - previousCardCount);
          } else if (Date.now() - startTime >= timeoutMs) {
            finishWait(false, 0);
          } else if (typeof setTimeout === "function") {
            setTimeout(poll, 250);
          } else {
            finishWait(false, 0);
          }
        };
        poll();
      }
    });

    const uniqueAddedNodes = Array.from(new Set(observedAddedNodes)).slice(0, 6);
    const addedSummary = uniqueAddedNodes.length > 0 ? `${observedAddedNodes.length} nodes (${uniqueAddedNodes.join(', ')})` : "None";

    return {
      mutationObserved,
      newCards,
      mutationRecordCount,
      addedSummary,
      tempLoadingDetected: tempLoadingDetected || "None detected"
    };
  }

  async syncToBackend() {
    return this.autoSyncToBackend();
  }

  async autoSyncToBackend(isRetry = false) {
    if (this.state !== "completed" || this.isPartial) {
      this.syncStatus = "blocked";
      this.syncMessage = "Backend sync blocked: Partial or incomplete datasets are never synced automatically.";
      await this.checkpointSession();
      return false;
    }

    if (this.syncStatus === "synced") {
      return false;
    }

    if (this.syncStatus === "syncing" && !isRetry) {
      return false;
    }

    this.syncStatus = "syncing";
    this.syncMessage = "Saving your network to WarmGraph...";
    await this.checkpointSession();

    try {
      const ownerId = await getOwnerId();
      const payload = {
        owner_id: ownerId,
        source: "linkedin_dom",
        confirmed: true,
        connections: Array.from(this.connections.values()),
        relationship_evidence: Array.from(this.relationshipEvidence.values()),
        page_type: getPageType(),
        page_url: window.location.href
      };

      if (typeof fetch === "function") {
        const importPayload = {
          ...payload,
          expected_total: this.expectedTotal,
          collected_total: this.connections.size,
          completion_status: this.completionStatus || (this.state === "completed" ? "complete" : "incomplete")
        };
        console.log("=== IMPORT PAYLOAD ===");
        console.log(JSON.stringify(importPayload, null, 2));
        const res = await fetch(`${BACKEND_BASE_URL}/network/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(importPayload)
        });
        console.log("STATUS", res.status);
        console.log(await res.clone().text());

        if (res.ok) {
          const resData = await res.json().catch(() => ({}));
          this.syncStatus = "synced";
          this.syncMessage = "Backend sync completed successfully.";
          this.lastSyncTimestamp = new Date().toISOString();
          this.lastSyncError = null;
          this.syncRetryCount = 0;
          await this.checkpointSession();
        } else {
          const errData = await res.json().catch(() => ({}));
          this.syncStatus = "failed";
          this.syncMessage = errData.detail || `Backend returned HTTP ${res.status}`;
          this.lastSyncError = errData.detail || `HTTP ${res.status}`;
          await this.checkpointSession();
          this.scheduleSyncRetry();
        }
      }
    } catch (err) {
      this.syncStatus = "failed";
      this.syncMessage = err.message || "Network error while connecting to backend.";
      this.lastSyncError = err.message;
      await this.checkpointSession();
      this.scheduleSyncRetry();
    }
  }

  async finalizeAndSync() {
    this.state = "resting";
    this.completionStatus = "complete";
    this.syncStatus = "synced";
    this.isPartial = false;
    this.statusMessage = "Workspace Up To Date";
    this.nextBatchAt = null;
    this.nextSyncDelay = 0;
    this.countdownSeconds = 0;
    this.pausedRemainingMs = null;
    this.estimatedRemainingMs = null;
    if (getAcquisitionEngineType() === "PEOPLE_SEARCH" || this.connections.size > (this.actualProfiles || 0)) {
      const finalCount = this.connections.size;
      this.actualProfiles = finalCount;
      this.totalConnections = finalCount;
      this.expectedTotal = finalCount;
    }
    await this.checkpointSession();
    await this.autoSyncToBackend();
  }

  scheduleSyncRetry() {
    if (this.syncRetryTimer) return;
    if (!this.syncRetryCount) this.syncRetryCount = 0;
    const MAX_SYNC_RETRIES = 3;

    if (this.syncRetryCount < MAX_SYNC_RETRIES) {
      this.syncRetryCount++;
      const backoffMs = Math.min(10000, 3000 * Math.pow(2, this.syncRetryCount - 1));
      this.syncRetryTimer = setTimeout(() => {
        this.syncRetryTimer = null;
        if (this.state === "completed" && this.syncStatus === "failed") {
          this.autoSyncToBackend(true);
        }
      }, backoffMs);
    }
  }

  async runAcquisitionLoop() {
    if (this.running && this.isRunning) {
      console.log(`[LOOP START] ignored because acquisition already running: sessionId=${this.sessionId}`);
      return;
    }
    if (typeof window !== "undefined") {
      window.__warmgraphAcquisitionRunning = true;
    }
    this.isRunning = true;
    console.log(`[LOOP START] sessionId=${this.sessionId}`);

    try {
      if (getAcquisitionEngineType() !== "PEOPLE_SEARCH") this.pageCount = 0;
    this.shouldCancel = false;
    let consecutiveZeroNewCardScrolls = 0;
    const MAX_ZERO_NEW_CARD_SCROLLS = 4;
    const MAX_EXTRACTION_LIMIT = 350;

    if (!this.seenProfiles) this.seenProfiles = new Set();
    this.connections.forEach((c) => {
      const key = this.getDeduplicationKey(c);
      if (key) this.seenProfiles.add(key);
    });

    const domTotal = extractTotalConnectionsFromDom();
    const currentEngineType = getAcquisitionEngineType();
    const startingDegree = currentEngineType === "PEOPLE_SEARCH"
      ? (this.activeDegreeFilter || getSelectedPeopleSearchDegree())
      : null;
    if (startingDegree) this.activeDegreeFilter = startingDegree;
    console.log("[WarmGraph][PeopleSearch] runAcquisitionLoop started", {
      engineType: currentEngineType,
      page: this.pageCount,
      sessionId: this.sessionId,
      url: location.href,
      sessionState: this.state
    });
    if (currentEngineType === "PEOPLE_SEARCH") {
      // People Search: LinkedIn does not expose a total result count.
      // Show only the live indexed count (no denominator) while crawling.
      // actualProfiles will be set to the real extracted count at completion.
      if (this.pageCount === 0 && this.connections.size === 0) {
        this.totalConnections = 0;
        this.expectedTotal = 0;
        this.actualProfiles = 0;
      }
    } else if (domTotal && domTotal > 0) {
      this.totalConnections = Math.min(MAX_EXTRACTION_LIMIT, domTotal);
      this.expectedTotal = Math.min(MAX_EXTRACTION_LIMIT, domTotal);
      this.actualProfiles = Math.min(MAX_EXTRACTION_LIMIT, domTotal);
    } else {
      this.totalConnections = MAX_EXTRACTION_LIMIT;
      this.expectedTotal = MAX_EXTRACTION_LIMIT;
      this.actualProfiles = MAX_EXTRACTION_LIMIT;
    }

    const targetLimit = Math.min(MAX_EXTRACTION_LIMIT, this.actualProfiles || MAX_EXTRACTION_LIMIT);

    while (!this.shouldCancel) {
      if (currentEngineType === "PEOPLE_SEARCH" && !isPeopleSearchDegreeValid(startingDegree)) {
        this.state = "paused";
        this.statusMessage = getSelectedPeopleSearchDegree() ? "Degree filter changed" : "Degree filter removed";
        await this.checkpointSession();
        break;
      }
      if (!isConnectionsPage()) {
        this.state = "paused";
        this.statusMessage = currentEngineType === "PEOPLE_SEARCH" ? "Degree filter removed" : "Return to Connections to continue syncing.";
        if (this.nextBatchAt && this.nextBatchAt > Date.now()) {
          this.pausedRemainingMs = this.nextBatchAt - Date.now();
        }
        console.log("[WarmGraph] Session paused: page is no longer eligible", { sessionId: this.sessionId, page: this.pageCount, url: location.href });
        await this.checkpointSession();
        break;
      }

      if (currentEngineType === "PEOPLE_SEARCH") {
        const pageReady = await waitForPeopleCards();
        console.log("[DEBUG][CARDS]", {
          visible: document.querySelectorAll(".search-results-container li, .reusable-search__result-container").length
        });
        if (!isPeopleSearchDegreeValid(startingDegree)) {
          this.state = "paused";
          this.statusMessage = getSelectedPeopleSearchDegree() ? "Degree filter changed" : "Degree filter removed";
          await this.checkpointSession();
          break;
        }
        if (!pageReady) {
          this.state = "interrupted";
          this.isPartial = true;
          this.statusMessage = "LinkedIn results did not stabilize. Acquisition paused.";
          console.warn("[WarmGraph] Session interrupted: People Search cards not stable", { sessionId: this.sessionId, page: this.pageCount + 1, url: location.href });
          await this.checkpointSession();
          break;
        }
      } else if (this.pageCount === 0) {
        const pageReady = await waitForConnectionCardsToStabilize();
        if (!pageReady) {
          this.state = "interrupted";
          this.isPartial = true;
          this.statusMessage = "LinkedIn connection cards did not stabilize. Acquisition paused.";
          console.warn("[WarmGraph] Session interrupted: connection cards not stable", { sessionId: this.sessionId, url: location.href });
          await this.checkpointSession();
          break;
        }
      }

      if (currentEngineType === "PEOPLE_SEARCH") {
        const urlPage = parseInt(new URLSearchParams(location.search).get("page"), 10);
        this.currentPage = (Number.isFinite(urlPage) && urlPage > 0)
          ? urlPage
          : (this.currentPage || this.pageCount + 1);
        this.pageCount = this.currentPage;
        this.totalPages = Math.max(this.totalPages || 0, this.currentPage);
      } else {
        this.pageCount++;
      }
      this.pageExtractionComplete = false;
      console.log(`[LOOP PAGE] page=${this.pageCount}`);
      console.log("[WarmGraph][PeopleSearch] extraction page started", {
        page: this.pageCount,
        sessionId: this.sessionId,
        url: location.href,
        engineType: getAcquisitionEngineType()
      });

      // STEP 1: Begin Batch -> Overlay changes to "Auto Extracting"
      this.state = "acquiring";
      this.activeFilter = extractActiveFilterFromDom();
      const initialCount = this.connections.size;
      this.statusMessage = `Auto Extracting (${initialCount} / ${targetLimit} Connections)...`;
      if (currentEngineType !== "PEOPLE_SEARCH") await this.checkpointSession();

      let batchNewProfilesCount = 0;
      let batchDuplicatesSkipped = 0;
      let batchVisibleCardsCount = 0;

      let scrollAttemptsInBatch = 0;
      const MAX_SCROLL_ATTEMPTS_PER_BATCH = 6;
      let peopleSearchIdleRounds = 0;
      let degreeScopeStopped = false;

      while (!this.shouldCancel) {
        if (currentEngineType === "PEOPLE_SEARCH" && !isPeopleSearchDegreeValid(startingDegree)) {
          this.state = "paused";
          this.statusMessage = getSelectedPeopleSearchDegree() ? "Degree filter changed" : "Degree filter removed";
          await this.checkpointSession();
          degreeScopeStopped = true;
          break;
        }
        if (!isConnectionsPage()) {
          this.state = "paused";
          this.statusMessage = currentEngineType === "PEOPLE_SEARCH" ? "Degree filter removed" : "Return to Connections to continue syncing.";
          if (this.nextBatchAt && this.nextBatchAt > Date.now()) {
            this.pausedRemainingMs = this.nextBatchAt - Date.now();
          }
          console.log("[WarmGraph] Session paused during page", { sessionId: this.sessionId, page: this.pageCount, url: location.href });
          await this.checkpointSession();
          return;
        }

        if (currentEngineType === "PEOPLE_SEARCH") {
          console.log("[DEBUG] visible cards:", getPeopleSearchProfileUrls().length);
          console.log("[DEBUG] current page:", this.currentPage);
          const scanRes = await this.scanCurrentPageForUnseen();
          console.log("[DEBUG] scan result:", {
            newProfiles: scanRes.newProfilesCount,
            duplicates: scanRes.duplicatesSkippedCount,
            visible: scanRes.totalVisibleCards,
            totalStored: this.connections.size
          });
          batchNewProfilesCount += scanRes.newProfilesCount;
          batchDuplicatesSkipped += scanRes.duplicatesSkippedCount;
          batchVisibleCardsCount = scanRes.totalVisibleCards;

          // Await all enrichment jobs for this page before making pagination decision
          if (this.connections.size > 0 || scanRes.totalVisibleCards > 0) {
            const visibleCards = scanRes.totalVisibleCards;
            const uniqueUrls = scanRes.uniqueUrlsCount || visibleCards;
            const hoverQueued = scanRes.enrichmentPromises ? scanRes.enrichmentPromises.length : 0;
            let hoverCompleted = 0;

            if (scanRes.enrichmentPromises && scanRes.enrichmentPromises.length > 0) {
              const results = await Promise.allSettled(scanRes.enrichmentPromises);
              hoverCompleted = results.length;
            } else if (typeof hoverIntelligenceEngine !== "undefined") {
              await hoverIntelligenceEngine.waitForAllPending(5000);
              hoverCompleted = visibleCards;
            }

            const recordsStored = this.connections.size;

            console.log(`[PAGE] Visible cards: ${visibleCards}`);
            console.log(`[PAGE] Unique URLs: ${uniqueUrls}`);
            console.log(`[PAGE] Hover queued: ${hoverQueued}`);
            console.log(`[PAGE] Hover completed: ${hoverCompleted}`);
            console.log(`[PAGE] Records stored: ${recordsStored}`);

            await this.checkpointSession();
            console.log("[PAGE] Checkpoint complete");
            console.log("[PAGE] Safe to paginate");

            break;
          }

          if (peopleSearchIdleRounds === 0) {
            peopleSearchIdleRounds = 1;
            console.log("[WarmGraph] First zero-result scan; loading more of the current page...");
            await this.triggerContainerLoad(this.pageCount);
            await sleep(900);
            continue;
          }

          let previousCardCount = -1;
          let stableRounds = 0;
          const stableStart = Date.now();
          while (Date.now() - stableStart < 3000 && stableRounds < 2) {
            const cardCount = getPeopleSearchProfileUrls().length;
            if (cardCount === previousCardCount) stableRounds++;
            else stableRounds = 0;
            previousCardCount = cardCount;
            if (stableRounds < 2) await sleep(200);
          }

          if (stableRounds < 2) {
            peopleSearchIdleRounds = 0;
            await this.triggerContainerLoad(this.pageCount);
            continue;
          }

          console.log("[DEBUG] visible cards:", getPeopleSearchProfileUrls().length);
          console.log("[DEBUG] current page:", this.currentPage);
          const confirmationScan = await this.scanCurrentPageForUnseen();
          console.log("[DEBUG] scan result:", {
            newProfiles: confirmationScan.newProfilesCount,
            duplicates: confirmationScan.duplicatesSkippedCount,
            visible: confirmationScan.totalVisibleCards,
            totalStored: this.connections.size
          });
          batchNewProfilesCount += confirmationScan.newProfilesCount;
          batchDuplicatesSkipped += confirmationScan.duplicatesSkippedCount;
          batchVisibleCardsCount = confirmationScan.totalVisibleCards;
          if (confirmationScan.newProfilesCount > 0) {
            peopleSearchIdleRounds = 0;
            await this.checkpointSession();
            continue;
          }

          // A stable result list is not proof that extraction succeeded. Never
          // advance past a page when it contains profiles but the session has
          // not captured any records; preserve the page for a safe retry.
          const visibleProfileCount = getPeopleSearchProfileUrls().length;
          if (visibleProfileCount > 0 && this.connections.size === 0 && this.relationshipEvidence.size === 0) {
            this.state = "interrupted";
            this.isPartial = true;
            this.statusMessage = "Profiles are visible, but none could be extracted. Page was not advanced.";
            console.warn("[WarmGraph] People Search page not advanced: visible profiles produced zero records", {
              page: this.pageCount,
              visibleProfileCount,
              sessionId: this.sessionId,
              url: location.href
            });
            await this.checkpointSession();
            break;
          }

          if (typeof hoverIntelligenceEngine !== "undefined") {
            await hoverIntelligenceEngine.waitForAllPending(3000);
          }
          await this.checkpointSession();
          console.log(`[WarmGraph] Page exhausted after final confirmation scan. Profiles: ${this.connections.size}`);
          break;
        }

        scrollAttemptsInBatch++;
        const initialDomCardCount = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;

        // Perform smart scroll (human cadence)
        const loadRes = await this.triggerContainerLoad(this.pageCount);

        // Wait for DOM mutation (MutationObserver driven)
        await this.waitForDomCardsToIncrease(initialDomCardCount, 1500, loadRes.container);

        // Scan page for new unseen cards
        const scanRes = await this.scanCurrentPageForUnseen();
        batchNewProfilesCount += scanRes.newProfilesCount;
        batchDuplicatesSkipped += scanRes.duplicatesSkippedCount;
        batchVisibleCardsCount = scanRes.totalVisibleCards;

        if (scanRes.newProfilesCount > 0) {
          consecutiveZeroNewCardScrolls = 0;
          break;
        }

        consecutiveZeroNewCardScrolls++;

        const hasLoader = !!(typeof document !== "undefined" && typeof document.querySelector === "function" ? document.querySelector('.scaffold-finite-scroll__loader, #infiniteLoader, [class*="loader"]') : null);

        console.log(`[Batch ${this.pageCount}]\nVisible cards: ${batchVisibleCardsCount}\nNew profiles: 0\n\nScrolling for additional cards...`);

        if (consecutiveZeroNewCardScrolls >= MAX_ZERO_NEW_CARD_SCROLLS && !hasLoader) {
          break;
        }

        if (scrollAttemptsInBatch >= MAX_SCROLL_ATTEMPTS_PER_BATCH) {
          break;
        }
      }

      if (degreeScopeStopped || (currentEngineType === "PEOPLE_SEARCH" && !isPeopleSearchDegreeValid(startingDegree))) {
        this.state = "paused";
        this.statusMessage = getSelectedPeopleSearchDegree() ? "Degree filter changed" : "Degree filter removed";
        await this.checkpointSession();
        break;
      }
      this.pageExtractionComplete = true;

      const currentCount = this.connections.size;
      const nextDelayMs = getRandomAcquisitionDelayMs();
      const nextDelaySec = Math.round(nextDelayMs / 1000);

      const now = Date.now();
      if (this.lastBatchStartTime) {
        const batchDur = now - this.lastBatchStartTime;
        if (!this.batchDurations) this.batchDurations = [];
        this.batchDurations.push(batchDur);
        if (this.batchDurations.length > 5) this.batchDurations.shift();
      }
      this.lastBatchStartTime = now;
      const avgBatchMs = (this.batchDurations && this.batchDurations.length > 0)
        ? Math.round(this.batchDurations.reduce((a, b) => a + b, 0) / this.batchDurations.length)
        : 12000;
      const remainingProfiles = Math.max(0, targetLimit - currentCount);
      const avgNewPerBatch = Math.max(1, batchNewProfilesCount || 8);
      const remainingBatches = Math.ceil(remainingProfiles / avgNewPerBatch);
      this.estimatedRemainingMs = remainingBatches * (avgBatchMs + nextDelayMs);

      console.log(`[Batch ${this.pageCount}]\nVisible cards: ${batchVisibleCardsCount}\nNew profiles: ${batchNewProfilesCount}\nDuplicates skipped: ${batchDuplicatesSkipped}\n\nExtracted total: ${currentCount}/${targetLimit}\n\nNext delay: ${nextDelaySec}s`);

      if (currentEngineType === "PEOPLE_SEARCH") {
        console.log("[WarmGraph][PeopleSearch] page extraction complete", { page: this.pageCount, extracted: this.connections.size, url: location.href });
        if (this.finishRequested) break;

        // Keep People Search in its active UI state while deciding whether
        // another results page remains. Completion is committed only below,
        // after the final page scan and a no-next-page decision.
        this.state = "acquiring";
        this.statusMessage = "Auto Extracting";
        await ensurePaginationVisible();
        const pageState = extractPaginationStateFromDom();
        console.log(
          "[PAGINATION HTML]",
          document.querySelector(".artdeco-pagination")?.outerHTML ||
          document.querySelector('nav[aria-label*="Pagination" i]')?.outerHTML ||
          null
        );
        this.currentPage = pageState.currentPage || this.currentPage;
        this.totalPages = Math.max(this.totalPages || 0, pageState.totalPages || 0, this.currentPage || 0);
        console.log("[WarmGraph][PeopleSearch] pagination decision", { pageState, url: location.href });
        console.log("[WarmGraph][DECISION]", JSON.stringify({
          currentPage: pageState.currentPage,
          totalPages: pageState.totalPages,
          hasNext: pageState.hasNext,
          nextFound: !!findEnabledPeopleSearchNextButton()
        }, null, 2));

        if (pageState.hasNext) {
            console.log(
                `[WarmGraph] Advancing to Page ${pageState.currentPage + 1}`
            );

            console.log("[DEBUG] ABOUT TO NAVIGATE", {
              totalStored: this.connections.size,
              page: this.currentPage
            });
            const moved = await autoAdvanceToNextPage(this);

            if (moved) {
                continue;
            }

            break;
        }

        console.log("[WarmGraph] Final page reached");

        await this.finalizeAndSync();
        break;
      } else {
        const nextBtn = findPaginationNextButton();
        if (nextBtn) {
          console.log(`[WarmGraph] Found enabled Next button. Navigating to next page...`);
          await navigateToNextPageAndWait(this);
          this.scanCurrentPageForUnseen();
          await this.checkpointSession();
          continue;
        }

        await this.finalizeAndSync();
        break;
      }

      this.nextSyncDelay = nextDelayMs;
      this.nextBatchAt = Date.now() + nextDelayMs;
      this.nextSyncAt = new Date(this.nextBatchAt).toISOString();
      this.state = "waiting";
      this.statusMessage = `Next batch in ${nextDelaySec}s`;
      await this.checkpointSession();

      await this.waitForNextBatch(this.nextBatchAt);
      this.countdownSeconds = 0;
    }

      if (this.finishRequested) {
        await this.completeAndSync();
      } else if (this.pauseRequested) {
        this.pauseRequested = false;
        this.shouldCancel = false;
        this.state = "paused";
        this.statusMessage = "Progress saved. Continue when you're ready.";
        await this.checkpointSession();
      } else if (this.shouldCancel) {
        if (!/^Degree filter/.test(this.statusMessage || "")) {
          this.state = "idle";
          this.statusMessage = "Acquisition cancelled.";
        }
        await this.checkpointSession();
      }
    } finally {
      if (typeof window !== "undefined") {
        window.__warmgraphAcquisitionRunning = false;
      }
      this.isRunning = false;
      this.activeLoopPromise = null;
      this.nextBatchResolver = null;
      console.log(`[LOOP END] sessionId=${this.sessionId}`);
      console.log("[WarmGraph] Session ended", { sessionId: this.sessionId, page: this.pageCount, state: this.state, extracted: this.connections.size });
    }
  }

  async reconcileNetworkWithDom(forceCheck = false) {
    if (!isApprovedExtractionPage()) return { action: "continue" };

    const liveTotal = extractTotalConnectionsFromDom();
    if (!liveTotal || liveTotal <= 0) return { action: "continue" };

    const storedTotal = this.totalConnections || 0;
    const storedActual = this.actualProfiles || 0;
    const extractedCount = this.connections ? this.connections.size : 0;
    const isPreviousComplete = (this.state === "completed" || this.state === "resting") || (storedActual > 0 && extractedCount >= storedActual);

    // CASE A — Same Header Count & Previous Sync Complete (Skip Sync)
    if (storedTotal > 0 && liveTotal === storedTotal && isPreviousComplete && !forceCheck) {
      this.totalConnections = liveTotal;
      this.actualProfiles = storedActual || extractedCount;
      this.expectedTotal = liveTotal;
      this.state = "resting";
      this.syncStatus = "synced";
      this.statusMessage = "You're all caught up ✨";
      await this.checkpointSessionSync();
      return { action: "skip", reason: "equal" };
    }

    // CASE B — Same Header Count, but Incomplete (Resume)
    if (storedTotal > 0 && liveTotal === storedTotal && storedActual > 0 && extractedCount < storedActual && !forceCheck) {
      this.totalConnections = liveTotal;
      this.expectedTotal = liveTotal;
      this.statusMessage = `Resuming sync from ${extractedCount} of ${storedActual}...`;
      await this.checkpointSessionSync();
      return { action: "resume", extractedCount };
    }

    // CASE C — Live Header Higher (Incremental Sync)
    if (storedTotal > 0 && liveTotal > storedTotal) {
      const incrementalDiff = liveTotal - storedTotal;
      this.totalConnections = liveTotal;
      this.expectedTotal = liveTotal;
      this.statusMessage = `Found ${incrementalDiff} new connections ✨`;
      await this.checkpointSessionSync();
      return { action: "incremental", diff: incrementalDiff };
    }

    // CASE D — Live Lower (Archive & Full Rebuild)
    if (storedActual > 0 && liveActual < storedActual) {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        try {
          chrome.storage.local.get(["warmgraph_active_graph"], (res) => {
            if (res && res.warmgraph_active_graph) {
              chrome.storage.local.set({ warmgraph_archived_graph: res.warmgraph_active_graph });
            }
          });
        } catch (e) {}
      }
      this.connections.clear();
      this.relationshipEvidence.clear();
      this.seenProfiles.clear();
      if (typeof connectionStore !== "undefined") connectionStore.clear();
      if (typeof relationshipEvidenceStore !== "undefined") relationshipEvidenceStore.clear();
      this.totalConnections = liveTotal;
      this.actualProfiles = liveActual;
      this.expectedTotal = liveTotal;
      this.state = "acquiring";
      this.statusMessage = "Your network changed. Rebuilding your relationship graph.";
      await this.checkpointSessionSync();
      return { action: "rebuild" };
    }

    return { action: "continue" };
  }

  waitForNextBatch(nextBatchAt) {
    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          this.nextBatchResolver = null;
          if (intervalId) clearInterval(intervalId);
          resolve();
        }
      };

      this.nextBatchResolver = finish;

      const remaining = Math.max(0, nextBatchAt - Date.now());
      if (remaining <= 0) {
        finish();
        return;
      }

      const intervalId = setInterval(() => {
        if (!isConnectionsPage() || this.shouldCancel) {
          finish();
          return;
        }
        const now = Date.now();
        if (now >= nextBatchAt) {
          finish();
        } else {
          const remSec = Math.ceil((nextBatchAt - now) / 1000);
          this.countdownSeconds = remSec;
          this.statusMessage = `Next batch in ${remSec}s`;
          this.checkpointSessionSync();
        }
      }, 1000);

      setTimeout(finish, remaining + 100);
    });
  }

  start(stateName = "acquiring") {
    const engineType = getAcquisitionEngineType();
    if (engineType === "PEOPLE_SEARCH") this.engineType = engineType;
    if (engineType === "PEOPLE_SEARCH" && !this.activeDegreeFilter) {
      this.activeDegreeFilter = getSelectedPeopleSearchDegree();
    }
    console.log("[WarmGraph][PeopleSearch] startAutomaticAcquisition check", {
      engineType,
      requestedState: stateName,
      url: location.href,
      running: !!((typeof window !== "undefined" && window.__warmgraphAcquisitionRunning) || this.isRunning || this.activeLoopPromise),
      state: this.state
    });
    if (engineType === "CONNECTIONS") {
      console.log("[WarmGraph][PeopleSearch] start returned: Connections page initializes workspace only");
      this.state = "connections_ready";
      this.statusMessage = "Workspace Ready";
      this.checkpointSessionSync();
      return this.getStatus();
    }
    if (!isApprovedExtractionPage()) {
      console.log("[WarmGraph][PeopleSearch] start returned: wrong or ineligible page", { engineType, url: location.href });
      this.state = "paused";
      this.statusMessage = engineType === "PEOPLE_SEARCH" ? "Degree filter removed" : "Return to LinkedIn Filtered Search to continue.";
      this.checkpointSessionSync();
      return this.getStatus();
    }
    if ((typeof window !== "undefined" && window.__warmgraphAcquisitionRunning) || this.isRunning || this.activeLoopPromise) {
      console.log("[WarmGraph][PeopleSearch] start returned: existing acquisition session", {
        windowRunning: !!(typeof window !== "undefined" && window.__warmgraphAcquisitionRunning),
        isRunning: this.isRunning,
        hasActiveLoopPromise: !!this.activeLoopPromise
      });
      return this.getStatus();
    }
    if ((this.state === "acquiring" || this.state === "collecting" || this.state === "waiting_for_content" || this.state === "settling") && this.activeLoopPromise) {
      console.log("[WarmGraph][PeopleSearch] start returned: active loop already owns session state", { state: this.state, url: location.href });
      return this.getStatus();
    }
    if (!this.sessionId) {
      this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    this.lockedPath = CONNECTIONS_LOCKED_PATH;
    this.shouldCancel = false;
    this.finishRequested = false;
    this.pauseRequested = false;
    this.manuallyFinished = false;
    this.completionStatus = "incomplete";
    this.state = stateName;
    console.log("[WarmGraph][PeopleSearch] state transition: start -> runAcquisitionLoop", { state: stateName, url: location.href });
    const runPromise = this.runAcquisitionLoop();
    this.activeLoopPromise = runPromise.finally(() => {
      if (typeof window !== "undefined") window.__warmgraphAcquisitionRunning = false;
      this.isRunning = false;
      if (this.activeLoopPromise === trackedPromise) this.activeLoopPromise = null;
      console.log("[WarmGraph] Session lifecycle released", { sessionId: this.sessionId, page: this.pageCount, state: this.state });
    });
    const trackedPromise = this.activeLoopPromise;
    if (engineType !== "PEOPLE_SEARCH") this.checkpointSessionSync();
    return this.getStatus();
  }

  cancel() {
    this.shouldCancel = true;
    this.state = "idle";
    this.checkpointSessionSync();
    return { success: true };
  }

  getStatus() {
    const collected = this.connections.size;
    const engineType = getAcquisitionEngineType() || this.engineType || "CONNECTIONS";
    const isPeopleSearchSession = engineType === "PEOPLE_SEARCH";
    const expected = this.expectedTotal || (isPeopleSearchSession
      ? (this.totalConnections || this.actualProfiles || collected)
      : Math.max(collected, 1));
    const rawActual = this.actualProfiles !== undefined ? this.actualProfiles : (expected > 1 ? expected - 1 : (expected || collected || 1));
    const isCompletedOrResting = (this.state === "completed" || this.state === "resting" || this.completionStatus === "complete") && (rawActual > 0 && collected >= rawActual);
    const actual = rawActual;
    const remaining = Math.max(0, actual - collected);
    const isOpenEndedPeopleSearch = getAcquisitionEngineType() === "PEOPLE_SEARCH" && !isCompletedOrResting;
    const progressPct = actual > 0 ? (collected >= actual ? 100 : Math.min(99, Math.floor((collected / actual) * 100))) : (collected > 0 && !isOpenEndedPeopleSearch ? 100 : 0);
    const imported = this.importedRecords;
    const activeFilterObj = this.activeFilter || extractActiveFilterFromDom();
    const now = Date.now();
    const isPaused = this.state === "paused" || this.state === "interrupted" || !isConnectionsPage();
    const derivedCountdown = isPaused
      ? (this.pausedRemainingMs ? Math.ceil(this.pausedRemainingMs / 1000) : (this.countdownSeconds || 0))
      : ((this.nextBatchAt && this.nextBatchAt > now) ? Math.max(0, Math.ceil((this.nextBatchAt - now) / 1000)) : (this.countdownSeconds || 0));

    return {
      sessionId: this.sessionId,
      engineType,
      engine_type: engineType,
      lockedPath: this.lockedPath || CONNECTIONS_LOCKED_PATH,
      state: isPaused && (this.state === "acquiring" || this.state === "waiting") ? "paused" : this.state,
      completion_status: this.completionStatus || (this.state === "completed" ? (collected >= expected ? "complete" : "complete_rendered_dataset") : "incomplete"),
      page_count: this.pageCount,
      expected_total: expected,
      // SSOT: totalConnections is the frozen LinkedIn header value from runAcquisitionLoop start
      totalConnections: isPeopleSearchSession ? (this.totalConnections ?? 0) : (this.totalConnections || expected),
      actualProfiles: actual,
      lastKnownActualProfiles: isPaused ? Math.max(actual || 0, collected) : actual,
      collected_count: collected,
      extractedConnections: collected,
      importedRecords: imported,
      pausedRemainingMs: this.pausedRemainingMs,
      estimatedRemainingMs: this.estimatedRemainingMs || null,
      progress_percent: progressPct,
      progressPercent: progressPct,
      countdown_seconds: derivedCountdown,
      countdownSeconds: derivedCountdown,
      nextSyncDelay: this.nextSyncDelay || 0,
      nextBatchAt: this.nextBatchAt || (this.nextSyncDelay ? now + this.nextSyncDelay : null),
      nextSyncAt: this.nextSyncAt || (this.nextBatchAt ? new Date(this.nextBatchAt).toISOString() : null),
      active_filter: activeFilterObj,
      remaining_count: remaining,
      remainingConnections: remaining,
      remainingProfiles: remaining,
      first_degree_count: collected,
      relationship_evidence_count: this.relationshipEvidence.size,
      last_batch_new_connections: this.lastBatchNewConnections,
      last_batch_new_evidence: this.lastBatchNewEvidence,
      is_partial: this.isPartial,
      status_message: isPaused ? "Return to Connections to continue syncing." : this.statusMessage,
      statusMessage: isPaused ? "Return to Connections to continue syncing." : this.statusMessage,
      isNavigating: !!this.isNavigating,
      navigatingLabel: this.navigatingLabel || null,
      sync_status: this.syncStatus,
      sync_message: this.syncMessage,
      last_synced_at: this.lastSyncTimestamp || null,
      telemetry: this.lastTelemetry || null,
      container_diagnostics: inspectLiveScrollContainers(),
      connections: Array.from(this.connections.values()),
      relationship_evidence: Array.from(this.relationshipEvidence.values()),
      reliable_dom_total: this.totalConnections || expected,
      paginationLabel: isPeopleSearchSession && this.currentPage
        ? `Page ${this.currentPage} of ${this.totalPages || 1}`
        : ((extractPaginationStateFromDom()?.label) || (this.pageCount > 0 ? `Page ${this.pageCount}` : "")),
      currentPage: isPeopleSearchSession
        ? (this.currentPage || extractPaginationStateFromDom()?.currentPage || this.pageCount)
        : (extractPaginationStateFromDom()?.currentPage || this.pageCount),
      totalPages: isPeopleSearchSession
        ? (this.totalPages || extractPaginationStateFromDom()?.totalPages || null)
        : (extractPaginationStateFromDom()?.totalPages || null),
      known_profile_urls: Array.from(this.connections.values()).map(c => c.profile_url).filter(Boolean),
      extracted_count: collected
    };
  }

  finish() {
    const status = this.getStatus();
    return {
      success: true,
      data: {
        state: status.state,
        is_partial: status.is_partial,
        status_message: status.status_message,
        sync_status: status.sync_status,
        sync_message: status.sync_message,
        expected_total: status.expected_total,
        collected_count: status.collected_count,
        remaining_count: status.remaining_count,
        page_type: getPageType(),
        page_url: window.location.href,
        first_degree_count: status.first_degree_count,
        relationship_evidence_count: status.relationship_evidence_count,
        connections: status.connections,
        relationship_evidence: status.relationship_evidence,
        reliable_dom_total: status.reliable_dom_total
      },
      status
    };
  }
}

const acquisitionSession = new ConnectionAcquisitionSession();
if (typeof window !== "undefined") {
  window.acquisitionSession = acquisitionSession;
}

function inspectLiveScrollContainers() {
  const candidates = [];
  const addCandidate = (el, label) => {
    if (!el || candidates.some(c => c.element === el)) return;
    try {
      const style = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle(el) : {};
      const overflowY = style.overflowY || style.overflow || "none";
      const scrollHeight = el.scrollHeight || 0;
      const clientHeight = el.clientHeight || 0;
      const scrollTop = el.scrollTop || 0;
      const hasLoader = !!(el.querySelector && el.querySelector('.scaffold-finite-scroll__loader, #infiniteLoader, [class*="loader"]'));
      const cardCount = el.querySelectorAll ? el.querySelectorAll('a[href*="/in/"]').length : 0;
      const tag = el.tagName ? el.tagName.toLowerCase() : "unknown";
      const cls = el.className ? `.${el.className.toString().trim().split(/\s+/).join('.')}` : "";
      const idStr = el.id ? `#${el.id}` : "";

      candidates.push({
        element: el,
        label,
        description: `${tag}${idStr}${cls}`.slice(0, 90),
        scrollHeight,
        clientHeight,
        scrollTop,
        overflowY,
        hasLoader,
        cardCount,
        isScrollable: (overflowY.includes("auto") || overflowY.includes("scroll") || overflowY.includes("overlay")) && scrollHeight > clientHeight
      });
    } catch (e) {}
  };

  // 1. Document & Body
  if (typeof document !== "undefined") {
    if (document.documentElement) addCandidate(document.documentElement, "document.documentElement");
    if (document.body) addCandidate(document.body, "document.body");
  }

  // 2. Finite scroll loader & ancestors
  const loader = document.querySelector ? document.querySelector('.scaffold-finite-scroll__loader, #infiniteLoader, [class*="loader"]') : null;
  if (loader) {
    let cur = loader.parentElement;
    let depth = 1;
    while (cur && depth <= 6) {
      addCandidate(cur, `loader_ancestor_${depth}`);
      cur = cur.parentElement;
      depth++;
    }
  }

  // 3. Card anchor & ancestors
  const firstCard = document.querySelector ? document.querySelector('a[href*="/in/"]') : null;
  if (firstCard) {
    let cur = firstCard.parentElement;
    let depth = 1;
    while (cur && depth <= 6) {
      addCandidate(cur, `card_ancestor_${depth}`);
      cur = cur.parentElement;
      depth++;
    }
  }

  // 4. Explicit selectors
  const explicitEls = document.querySelectorAll
    ? document.querySelectorAll('.scaffold-finite-scroll, .scaffold-layout__main, .mn-connections-list, main, section')
    : [];
  explicitEls.forEach((el, i) => addCandidate(el, `explicit_${i+1}`));

  return candidates.map(c => {
    const { element, ...rest } = c;
    return rest;
  });
}

function extractActiveFilterFromDom() {
  try {
    if (typeof document === "undefined") return null;

    const filterSelectors = [
      '.search-reusables__filter-pill-button',
      '[data-test-pill]',
      '.artdeco-pill',
      'button[aria-label*="Filter"]',
      'button[aria-label*="Company"]',
      'button[aria-label*="School"]',
      'button[aria-label*="Location"]',
      'button[aria-label*="Industry"]',
      'button[aria-pressed="true"]',
      '.search-reusables__value-label'
    ];

    for (const sel of filterSelectors) {
      const els = document.querySelectorAll ? document.querySelectorAll(sel) : [];
      for (const el of els) {
        const text = (el.innerText || el.textContent || "").trim();
        if (text && !/^(all filters|filters|reset|clear)$/i.test(text)) {
          const parts = text.split(/[:\n]+/);
          if (parts.length > 1) {
            return { category: parts[0].trim(), label: parts[1].trim() };
          }
          return { category: "Active Filter", label: text };
        }
      }
    }

    const searchHeader = document.querySelector ? document.querySelector('h1, h2, .search-results-page, .search-results__total') : null;
    if (searchHeader) {
      const text = (searchHeader.innerText || searchHeader.textContent || "").trim();
      const match = text.match(/for\s+"([^"]+)"/i) || text.match(/at\s+([A-Z][A-Za-z0-9\s&]+)/);
      if (match) {
        return { category: "Filter", label: match[1].trim() };
      }
    }
  } catch (e) {}
  return null;
}

function extractTotalConnectionsFromDom() {
  if (!isConnectionsPage()) {
    return null;
  }
  if (getAcquisitionEngineType() === "PEOPLE_SEARCH") {
    return null;
  }
  try {
    const selectors = [
      'h1', 'h2', 'h3', 'header', 'main',
      '[class*="connections"]', '[class*="count"]', '[data-test-connections-count]',
      '[class*="search-results"]', '[class*="entity-header"]', '.scaffold-finite-scroll__content'
    ];
    const elements = document.querySelectorAll ? document.querySelectorAll(selectors.join(',')) : [];

    const patterns = [
      /Connections?\s*\(\s*([\d,.\s]+)\s*\)/i,
      /\b([\d,.\s]+)\s+connections?\b/i,
      /\b([\d,.\s]+)\s+results?\b/i,
      /\b\d+\s+of\s+([\d,.\s]+)\b/i
    ];

    for (const el of elements) {
      const text = (el.innerText || el.textContent || "").trim();
      for (const pat of patterns) {
        const match = text.match(pat);
        if (match) {
          const cleanNum = match[1].replace(/[,.\s]/g, "");
          const num = parseInt(cleanNum, 10);
          if (!isNaN(num) && num > 0) {
            return num;
          }
        }
      }
    }

    const docText = document.body ? (document.body.innerText || document.body.textContent || "") : (document.documentElement ? (document.documentElement.innerText || document.documentElement.textContent || "") : "");
    for (const pat of patterns) {
      const match = docText.match(pat);
      if (match) {
        const cleanNum = match[1].replace(/[,.\s]/g, "");
        const num = parseInt(cleanNum, 10);
        if (!isNaN(num) && num > 0) {
          return num;
        }
      }
    }
  } catch (e) {
    // ignore DOM parsing errors
  }
  return 350;
}

if (typeof window !== "undefined") {
  window.getAcquisitionEngineType = getAcquisitionEngineType;
  window.getRandomAcquisitionDelayMs = getRandomAcquisitionDelayMs;
  window.extractTotalConnectionsFromDom = extractTotalConnectionsFromDom;
}

async function maybeAutoStartAcquisition() {
  console.log("[WarmGraph][PeopleSearch] maybeAutoStartAcquisition entered", { url: location.href });
  await acquisitionSession.initOrHydrateSession();
  const engineType = getAcquisitionEngineType();
  console.log("[WarmGraph][PeopleSearch] maybeAutoStartAcquisition page check", { engineType, url: location.href });

  if (engineType === "CONNECTIONS") {
    // Phase A — Connections Initialization
    // Resolve owner identity & read total connection count silently. Do NOT scrape profiles here.
    try {
      await detectAndPersistOwnerIdentity();
    } catch (_) {}

    const domTotal = extractTotalConnectionsFromDom();
    if (domTotal && domTotal > 0) {
      acquisitionSession.totalConnections = domTotal;
      acquisitionSession.expectedTotal = domTotal;
      acquisitionSession.actualProfiles = domTotal;
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          total_connections: domTotal,
          totalConnections: domTotal,
          total_network_size: domTotal,
          workspace_ready: true
        });
      }
    }
    acquisitionSession.state = "connections_ready";
    acquisitionSession.statusMessage = "Workspace Ready";
    acquisitionSession.checkpointSessionSync();
    return;
  }

  if (engineType === "PEOPLE_SEARCH") {
    if (!getSelectedPeopleSearchDegree()) {
      acquisitionSession.shouldCancel = true;
      acquisitionSession.state = "paused";
      acquisitionSession.statusMessage = "Degree filter removed";
      if (acquisitionSession.nextBatchResolver) acquisitionSession.nextBatchResolver();
      acquisitionSession.checkpointSessionSync();
      return;
    }
    // Phase B — Filtered People Extraction
    // Resume persisted progress before considering a fresh session.
    if (acquisitionSession.hasSavedSession && ["completed", "resting"].includes(acquisitionSession.state)) {
      acquisitionSession.checkpointSessionSync();
      return;
    }
    if (!window.__warmgraphAcquisitionRunning) {
      if (acquisitionSession.hasSavedSession) {
        await acquisitionSession.resume();
      } else {
        acquisitionSession.start();
      }
    } else {
      console.log("[WarmGraph][PeopleSearch] auto-start returned: acquisition already running");
    }
    return;
  }

  console.log("[WarmGraph][PeopleSearch] auto-start returned: wrong page", { engineType, url: location.href });

  // Non-approved page (Feed, Home, Jobs, etc.)
  if (
    acquisitionSession.state === "acquiring" ||
    acquisitionSession.state === "waiting" ||
    acquisitionSession.state === "building" ||
    acquisitionSession.state === "waiting_for_content" ||
    acquisitionSession.state === "settling" ||
    acquisitionSession.state === "interrupted"
  ) {
    acquisitionSession.state = "paused";
    acquisitionSession.statusMessage = "Return to LinkedIn Filtered Search to continue.";
    if (acquisitionSession.nextBatchAt && acquisitionSession.nextBatchAt > Date.now()) {
      acquisitionSession.pausedRemainingMs = acquisitionSession.nextBatchAt - Date.now();
    }
    acquisitionSession.checkpointSessionSync();
  }
}

let initialAutoStartTimer = setTimeout(maybeAutoStartAcquisition, 100);

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (acquisitionSession && ["acquiring", "waiting_for_content", "settling", "waiting"].includes(acquisitionSession.state)) {
      acquisitionSession.state = "paused";
      acquisitionSession.statusMessage = "Return to LinkedIn Filtered Search to continue.";
      if (acquisitionSession.nextBatchAt && acquisitionSession.nextBatchAt > Date.now()) {
        acquisitionSession.pausedRemainingMs = acquisitionSession.nextBatchAt - Date.now();
      }
      acquisitionSession.checkpointSessionSync();
    }
    if (scanTimer) clearTimeout(scanTimer);
    if (pageScanObserver) {
      pageScanObserver.disconnect();
      console.log("[WarmGraph] Page scan observer cleaned up", { url: location.href });
    }
    if (peopleSearchPollTimer) clearInterval(peopleSearchPollTimer);
    if (spaRouteObserver) {
      spaRouteObserver.disconnect();
      console.log("[WarmGraph] SPA route observer cleaned up", { url: location.href });
    }
    if (spaStartTimer) clearTimeout(spaStartTimer);
    if (initialScanTimer) clearTimeout(initialScanTimer);
    if (initialAutoStartTimer) clearTimeout(initialAutoStartTimer);
    if (manualPaginationClickListener) document.removeEventListener("click", manualPaginationClickListener, true);
    if (scrollTelemetryListener) window.removeEventListener("scroll", scrollTelemetryListener, true);
    if (visibilityChangeListener) document.removeEventListener("visibilitychange", visibilityChangeListener);
  });

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    visibilityChangeListener = () => {
      if (document.visibilityState === "visible") {
        if (acquisitionSession) {
          acquisitionSession.isTabHidden = false;
          if (getAcquisitionEngineType() === "PEOPLE_SEARCH") {
            if (acquisitionSession.manuallyFinished || (acquisitionSession.state === "completed" && acquisitionSession.completionStatus === "complete")) return;
            if (!window.__warmgraphAcquisitionRunning) {
              acquisitionSession.start();
            } else if (acquisitionSession.nextBatchAt && Date.now() >= acquisitionSession.nextBatchAt) {
              if (acquisitionSession.nextBatchResolver) {
                acquisitionSession.nextBatchResolver();
              }
            }
          }
        }
      } else {
        if (acquisitionSession) {
          acquisitionSession.isTabHidden = true;
        }
      }
    };
    document.addEventListener("visibilitychange", visibilityChangeListener);
  }
}


// =========================================================
// POPUP MESSAGE HANDLER
// =========================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    switch (message.action) {
      case "GET_OWNER_IDENTITY": {
        // Popup requesting live identity from this tab — detect, persist, and return
        detectAndPersistOwnerIdentity().then(ownerId => {
          if (ownerId) {
            sendResponse({
              success: true,
              ownerId,
              profileUrl: `https://www.linkedin.com/in/${detectLinkedInOwnerSlug() || ownerId}`
            });
          } else {
            // Identity not detectable from this page — return whatever is cached
            chrome.storage.local.get(["warmgraph_owner", "ownerId"], (res) => {
              const owner = res.warmgraph_owner;
              sendResponse({
                success: !!(owner?.ownerId || res.ownerId),
                ownerId: owner?.ownerId || res.ownerId || null,
                profileUrl: owner?.profileUrl || null
              });
            });
          }
        }).catch(err => {
          sendResponse({ success: false, error: err.message });
        });
        return true; // async
      }
      case "SYNC_AGAIN":
      case "syncAgain":
      case "SYNC_NETWORK":
      case "syncNetwork": {
        if (isApprovedExtractionPage()) {
          (async () => {
            if ((typeof window !== "undefined" && window.__warmgraphAcquisitionRunning) || acquisitionSession.isRunning || acquisitionSession.activeLoopPromise) {
              console.log("[WarmGraph] Extraction session active. Resuming existing session...");
              acquisitionSession.state = "acquiring";
              acquisitionSession.checkpointSessionSync();
            } else {
              const rec = await acquisitionSession.reconcileNetworkWithDom(true);
              if (rec.action !== "skip") {
                acquisitionSession.start();
              } else {
                console.log("[WarmGraph] Session complete. Performing incremental sync only...");
                acquisitionSession.scanCurrentPageForUnseen();
                acquisitionSession.state = "resting";
                acquisitionSession.checkpointSessionSync();
                acquisitionSession.autoSyncToBackend();
              }
            }
          })();
        } else {
          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: "NAVIGATE_AND_RESUME_SYNC" });
          }
        }
        sendResponse({ success: true });
        break;
      }
      case "RUN_NEXT_BATCH":
      case "runNextBatch":
      case "triggerNextBatch": {
        if (isConnectionsPage()) {
          if (getAcquisitionEngineType() === "PEOPLE_SEARCH") {
            if (acquisitionSession.nextBatchResolver) {
              acquisitionSession.nextBatchResolver();
            } else if (!window.__warmgraphAcquisitionRunning && findEnabledPeopleSearchNextButton()) {
              acquisitionSession.start("acquiring");
            }
          } else if (acquisitionSession.nextBatchResolver) {
            acquisitionSession.nextBatchResolver();
          } else if (!window.__warmgraphAcquisitionRunning) {
            const extractedCount = acquisitionSession.connections ? acquisitionSession.connections.size : 0;
            const targetCount = acquisitionSession.actualProfiles || acquisitionSession.expectedTotal || 0;
            if (targetCount === 0 || extractedCount < targetCount) {
              acquisitionSession.start();
            }
          }
        }
        sendResponse({ success: true, running: !!(typeof window !== "undefined" && window.__warmgraphAcquisitionRunning) });
        break;
      }
      case "startAutomatedAcquisition": {
        acquisitionSession.resume().then(status => {
          sendResponse({ success: true, status, batch: status });
        }).catch(error => {
          sendResponse({ success: false, error: error.message });
        });
        return true;
      }
      case "startCollection": {
        acquisitionSession.reset(true);
        if (!acquisitionSession.sessionId) {
          acquisitionSession.sessionId = `warmgraph_session_${Date.now()}`;
        }
        acquisitionSession.state = "collecting";
        acquisitionSession.scanCurrentPage();
        const status = { ...acquisitionSession.getStatus(), state: "collecting" };
        sendResponse({
          success: true,
          status,
          batch: status
        });
        break;
      }
      case "pauseCollection": {
        acquisitionSession.pause();
        const status = { ...acquisitionSession.getStatus(), state: "paused" };
        sendResponse({
          success: true,
          status
        });
        break;
      }
      case "resumeCollection": {
        acquisitionSession.state = "collecting";
        acquisitionSession.scanCurrentPage();
        const status = { ...acquisitionSession.getStatus(), state: "collecting" };
        sendResponse({
          success: true,
          status,
          batch: status
        });
        break;
      }
      case "finishCollection":
      case "finishAcquisition": {
        acquisitionSession.finishAndSync().then(status => {
          sendResponse({ success: true, status, data: status });
        }).catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      }
      case "cancelCollection":
      case "cancelAcquisition": {
        acquisitionSession.cancel();
        acquisitionSession.reset(true);
        sendResponse({
          success: true,
          status: acquisitionSession.getStatus()
        });
        break;
      }
      case "getCollectionStatus":
      case "getAcquisitionStatus": {
        let status = acquisitionSession.getStatus();
        if (message.action === "getCollectionStatus" && status.state === "acquiring") {
          status = { ...status, state: "collecting" };
        }
        sendResponse({
          success: true,
          status
        });
        break;
      }
      case "extractLinkedIn": {
        const result = scanAndMaybeSync();
        sendResponse({
          success: true,
          page_type: getPageType(),
          page_url: window.location.href,
          first_degree_count: connectionStore.size,
          relationship_evidence_count: relationshipEvidenceStore.size,
          batch_added: result.first_degree_added,
          relationship_evidence_added: result.relationship_evidence_added,
          connections: Array.from(connectionStore.values()),
          relationship_evidence: Array.from(relationshipEvidenceStore.values())
        });
        break;
      }
      case "syncToBackend": {
        if (message.force && getAcquisitionEngineType() === "PEOPLE_SEARCH") {
          if (!getSelectedPeopleSearchDegree()) {
            sendResponse({ success: false, sync_status: "blocked", error: "A LinkedIn degree filter is required to sync People Search results." });
            break;
          }
          if (["completed", "resting"].includes(acquisitionSession.state) && acquisitionSession.completionStatus === "complete" && !acquisitionSession.isPartial) {
            acquisitionSession.state = "completed";
            acquisitionSession.syncStatus = "idle";
          }
        }
        acquisitionSession.syncToBackend().then(() => {
          sendResponse({
            success: acquisitionSession.syncStatus === "synced",
            sync_status: acquisitionSession.syncStatus,
            sync_message: acquisitionSession.syncMessage,
            error: acquisitionSession.syncStatus === "synced" ? null : (acquisitionSession.syncMessage || "Backend synchronization failed.")
          });
        }).catch(err => {
          sendResponse({
            success: false,
            sync_status: "failed",
            sync_message: err.message,
            error: err.message
          });
        });
        return true;
      }
      default:
        return false;
    }
  } catch (error) {
    sendResponse({
      success: false,
      error: error.message
    });
  }
  return true;
});


// =========================================================
// HOVER INTELLIGENCE ENGINE (TASK 13.5.8)
// Enriches existing graph records with metadata from LinkedIn's
// floating profile hover cards. Works on any LinkedIn page.
// Browser-agnostic: no hashed class names, no user-agent checks.
// =========================================================

class HoverIntelligenceEngine {
  constructor() {
    // Per-session cache — each normalized profile URL is processed once.
    this._hoverCache = new Set();
    // Pending extraction timer handle for the current candidate.
    this._pendingTimer = null;
    this._pendingCards = new Map();
    this._pendingProfiles = new Map();
    this._processingBatch = false;
    // The MutationObserver instance, created lazily on start().
    this._observer = null;
    // Whether the engine has been started.
    this._started = false;
  }

  /**
   * Return true when a newly-inserted DOM node looks like a LinkedIn
   * floating profile hover card. Uses only generic, stable signals:
   *   - role="dialog" | role="tooltip" | role="listbox"
   *   - aria-label / aria-describedby presence
   *   - contains at least one profile link (<a href*="/in/">)
   * Never matches on hashed/generated CSS class names.
   */
  _isHoverCard(node) {
    try {
      if (!node || node.nodeType !== 1) return false;

      const role = node.getAttribute("role");
      const isFloating =
        role === "dialog" || role === "tooltip" || role === "listbox";

      const hasAriaLabel =
        node.hasAttribute("aria-label") ||
        node.hasAttribute("aria-describedby") ||
        node.hasAttribute("aria-live");

      const hasProfileLink =
        typeof node.querySelector === "function" &&
        !!node.querySelector('a[href*="/in/"]');

      return (isFloating || hasAriaLabel) && hasProfileLink;
    } catch (_) {
      return false;
    }
  }

  /**
   * Extract enrichment data from a hover card element.
   * Returns null when the card does not contain a usable profile URL.
   */
  _extractFromHoverCard(card) {
    try {
      // Profile URL
      const profileAnchor = card.querySelector('a[href*="/in/"]');
      if (!profileAnchor) return null;

      const profileUrl = normalizeProfileUrl(profileAnchor.href);
      if (!profileUrl) return null;

      // Name — try semantic selectors, fall back to aria-label on the anchor.
      let name = null;
      const nameSelectors = [
        '[data-field="name"]',
        'span[class*="name"]',
        'div[class*="name"]',
        'h1', 'h2', 'h3'
      ];
      for (const sel of nameSelectors) {
        try {
          const el = card.querySelector(sel);
          if (el) {
            const t = cleanText(el.innerText || el.textContent);
            if (t && t.length > 1 && t.length < 100) { name = t; break; }
          }
        } catch (_) {}
      }
      if (!name && profileAnchor.getAttribute("aria-label")) {
        name = cleanText(profileAnchor.getAttribute("aria-label"));
      }

      // Headline
      let headline = null;
      const headlineSelectors = [
        '[data-field="headline"]',
        'span[class*="headline"]',
        'div[class*="headline"]',
        'p[class*="subtitle"]',
        '.entity-result__primary-subtitle'
      ];
      for (const sel of headlineSelectors) {
        try {
          const el = card.querySelector(sel);
          if (el) {
            const t = cleanText(el.innerText || el.textContent);
            if (t && t.length > 1) { headline = t; break; }
          }
        } catch (_) {}
      }

      // Location
      let location = null;
      const locationSelectors = [
        '[data-field="location"]',
        'span[class*="location"]',
        'div[class*="location"]',
        'span[class*="subline"]'
      ];
      for (const sel of locationSelectors) {
        try {
          const el = card.querySelector(sel);
          if (el) {
            const t = cleanText(el.innerText || el.textContent);
            if (t && t.length > 1 && t.length < 120) { location = t; break; }
          }
        } catch (_) {}
      }

      // Mutual connections
      const cardText = cleanText(card.innerText || "");
      const mutualText = extractMutualConnectionsText(card, cardText);
      const mutualNames = mutualText ? extractMutualConnectionNames(mutualText, name) : null;

      // Profile photo URL
      let photoUrl = null;
      try {
        const img = card.querySelector('img[src*="licdn"], img[src*="media.licdn"]') ||
                    card.querySelector('img[aria-hidden]') ||
                    card.querySelector('img');
        if (img && img.src && img.src.startsWith("http")) photoUrl = img.src;
      } catch (_) {}

      // Company / role_type derived from headline
      const companyRes = resolveCompanyAndRoleType(card, cardText, headline);

      // Education
      let education = null;
      const educationSelectors = [
        '[data-field="education"]',
        'span[class*="education"]',
        'div[class*="education"]',
        '.pv-entity__degree-info',
        '.entity-result__secondary-subtitle'
      ];
      for (const sel of educationSelectors) {
        try {
          const el = card.querySelector(sel);
          if (el) {
            const t = cleanText(el.innerText || el.textContent);
            if (t && t.length > 1 && t.length < 150) { education = t; break; }
          }
        } catch (_) {}
      }
      if (!education && cardText) {
        const eduMatch = cardText.match(/\b(University|College|Institute|Academy|School|B\.?Tech|M\.?Tech|B\.?A|M\.?A|Ph\.?D|Bachelor|Master)\b[^•·\n,]{2,60}/i);
        if (eduMatch) {
          education = cleanText(eduMatch[0]);
        }
      }

      return {
        name,
        profile_url: profileUrl,
        headline,
        company: companyRes.company || null,
        role_type: companyRes.role_type || null,
        education: education || null,
        location,
        mutual_connections_text: mutualText || null,
        mutual_connection_names: mutualNames || null,
        photo_url: photoUrl || null,
        source: "hover_card",
        captured_at: new Date().toISOString()
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * Attempt to enrich the connection store with data from a hover card.
   * Called after a brief debounce delay once the card is detected.
   */
  _processCard(card) {
    try {
      const data = this._extractFromHoverCard(card);
      if (!data || !data.profile_url) return;

      // Skip if already processed this profile in this session.
      const cacheKey = `url:${data.profile_url}`;
      if (this._hoverCache.has(cacheKey)) return;
      this._hoverCache.add(cacheKey);

      const dedupKey = `url:${data.profile_url}`;

      // Read existing records from both stores.
      const existingInSession =
        acquisitionSession && acquisitionSession.connections
          ? acquisitionSession.connections.get(dedupKey)
          : null;
      const existingInStore = connectionStore.get(dedupKey);
      const existing = existingInSession || existingInStore || null;

      // Fill-missing-only merge: mergeRecord(previous, current) lets `current` win.
      // We want existing graph data to win and hover to fill only missing fields,
      // so pass hover data as `previous` and existing as `current`.
      const merged = existing ? mergeRecord(data, existing) : data;

      // Write to both stores — same pattern as scanCurrentPageForUnseen().
      if (acquisitionSession && acquisitionSession.connections) {
        acquisitionSession.connections.set(dedupKey, merged);
      }
      connectionStore.set(dedupKey, merged);

      const pending = this._pendingProfiles.get(dedupKey);
      if (pending) {
        clearTimeout(pending.timer);
        this._pendingProfiles.delete(dedupKey);
        pending.resolve(merged);
      }

      // Persist to storage only when the acquisition loop is idle (avoids
      // interfering with an active extraction run).
      const sessionState = acquisitionSession ? acquisitionSession.state : null;
      const isSafeToCheckpoint =
        sessionState === "idle" ||
        sessionState === "completed" ||
        sessionState === "paused" ||
        sessionState === null ||
        sessionState === undefined;

      if (
        isSafeToCheckpoint &&
        acquisitionSession &&
        typeof acquisitionSession.checkpointSessionSync === "function"
      ) {
        acquisitionSession.checkpointSessionSync();
      }
    } catch (_) {
      // Never let hover enrichment throw — must not interrupt the acquisition loop.
    }
  }

  waitForProfileEnrichment(visibleProfile, timeout = 1200) {
    const profileUrl = normalizeProfileUrl(visibleProfile && visibleProfile.profile_url);
    if (!profileUrl) return Promise.resolve(visibleProfile);

    const key = `url:${profileUrl}`;
    if (this._isAlreadyEnriched(profileUrl)) return Promise.resolve(visibleProfile);

    const previous = this._pendingProfiles.get(key);
    if (previous) return previous.promise;

    let resolveWait;
    const promise = new Promise(resolve => { resolveWait = resolve; });
    const pending = {
      promise,
      resolve: resolveWait,
      visibleProfile,
      timer: setTimeout(() => {
        this._pendingProfiles.delete(key);
        resolveWait(visibleProfile);
      }, Math.max(0, timeout))
    };
    this._pendingProfiles.set(key, pending);
    return promise;
  }

  getPendingCount() {
    return this._pendingProfiles ? this._pendingProfiles.size : 0;
  }

  async waitForAllPending(timeoutMs = 5000) {
    if (!this._pendingProfiles || this._pendingProfiles.size === 0) return;

    const pendingPromises = Array.from(this._pendingProfiles.values()).map(p => p.promise);

    await Promise.race([
      Promise.allSettled(pendingPromises),
      sleep(timeoutMs)
    ]);
  }

  _getHoverProfileUrl(card) {
    try {
      const anchor = card && card.querySelector('a[href*="/in/"]');
      return anchor ? normalizeProfileUrl(anchor.href) : null;
    } catch (_) {
      return null;
    }
  }

  _isAlreadyEnriched(profileUrl) {
    if (!profileUrl) return true;
    const key = `url:${profileUrl}`;
    if (this._hoverCache.has(key)) return true;

    const record = (acquisitionSession && acquisitionSession.connections && acquisitionSession.connections.get(key)) || connectionStore.get(key);
    return !!(record && (
      record.source === "hover_card" ||
      record.photo_url ||
      record.education
    ));
  }

  /**
   * Queue hover cards and process up to five at a time after a short render delay.
   * This queue is observer-driven and never blocks People Search scrolling.
   */
  _scheduleExtraction(card) {
    const profileUrl = this._getHoverProfileUrl(card);
    if (!profileUrl || this._isAlreadyEnriched(profileUrl)) return;

    const key = `url:${profileUrl}`;
    const pendingProfile = this._pendingProfiles.get(key);
    if (!pendingProfile) return;
    if (pendingProfile) {
      clearTimeout(pendingProfile.timer);
      pendingProfile.timer = setTimeout(() => {
        this._pendingProfiles.delete(key);
        pendingProfile.resolve(pendingProfile.visibleProfile);
      }, 250);
    }
    this._pendingCards.set(key, card);
    if (this._pendingTimer) return;

    this._pendingTimer = setTimeout(() => {
      this._pendingTimer = null;
      this._processPendingBatches();
    }, 180);
  }

  async _processPendingBatches() {
    if (this._processingBatch) return;
    this._processingBatch = true;
    try {
      while (this._pendingCards.size > 0) {
        const batch = Array.from(this._pendingCards.entries()).slice(0, 5);
        batch.forEach(([key]) => this._pendingCards.delete(key));
        await Promise.all(batch.map(([, card]) => Promise.resolve().then(() => this._processCard(card))));
      }
    } finally {
      this._processingBatch = false;
      if (this._pendingCards.size > 0 && !this._pendingTimer) {
        this._pendingTimer = setTimeout(() => {
          this._pendingTimer = null;
          this._processPendingBatches();
        }, 180);
      }
    }
  }

  /**
   * Start observing the DOM for hover card insertions.
   * Creates exactly one dedicated MutationObserver — entirely separate
   * from the existing acquisition loop observer.
   */
  start() {
    if (this._started) return;
    this._started = true;

    try {
      this._observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (this._isHoverCard(node)) {
              this._scheduleExtraction(node);
            } else if (node.nodeType === 1 && typeof node.children !== "undefined") {
              // LinkedIn sometimes wraps the hover card in a portal/overlay div.
              try {
                for (const child of node.children) {
                  if (this._isHoverCard(child)) {
                    this._scheduleExtraction(child);
                  }
                }
              } catch (_) {}
            }
          }
        }
      });

      const root =
        (typeof document !== "undefined" && document.body) ||
        (typeof document !== "undefined" && document.documentElement);

      if (root) {
        this._observer.observe(root, { childList: true, subtree: true });
        console.log("[WarmGraph] Hover observer created");
      }
    } catch (_) {
      // Gracefully fail in non-browser or restricted environments.
    }
  }

  /**
   * Stop the observer and clean up pending timers. Called on page unload.
   */
  stop() {
    try {
      if (this._pendingTimer) {
        clearTimeout(this._pendingTimer);
        this._pendingTimer = null;
      }
      this._pendingCards.clear();
      this._pendingProfiles.forEach(pending => {
        clearTimeout(pending.timer);
        pending.resolve(pending.visibleProfile);
      });
      this._pendingProfiles.clear();
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
        console.log("[WarmGraph] Hover observer cleaned up");
      }
      this._started = false;
    } catch (_) {}
  }

  /** Expose the hover cache for testing. */
  get hoverCache() {
    return this._hoverCache;
  }
}

// Instantiate the global hover intelligence engine singleton.
const hoverIntelligenceEngine = new HoverIntelligenceEngine();

if (typeof window !== "undefined" && typeof document !== "undefined") {
  hoverIntelligenceEngine.start();

  // Piggyback on the existing beforeunload handler to clean up.
  window.addEventListener("beforeunload", () => {
    hoverIntelligenceEngine.stop();
  });
}

// Expose for testing and debugging.
if (typeof window !== "undefined") {
  window.HoverIntelligenceEngine = HoverIntelligenceEngine;
  window.hoverIntelligenceEngine = hoverIntelligenceEngine;
}


// =========================================================
// MUTATION OBSERVER
// =========================================================

let initialScanTimer = null;
let peopleSearchPollTimer = null;
let spaStartTimer = null;
let pageScanObserver = null;
let spaRouteObserver = null;
let manualPaginationClickListener = null;
let __wgCurrentUrl = location.href;
let observedPeopleSearchFirstProfileUrl = getPeopleSearchProfileUrls()[0] || null;
let handlingPeopleSearchUrlChange = false;
let lastLoggedPeopleSearchRetryUrl = null;

const SCAN_DEBOUNCE_MS = 800;

// Diagnostic only: correlate a manual pagination click with the next URL event.
manualPaginationClickListener = (event) => {
  const target = event.target && event.target.closest
    ? event.target.closest('.artdeco-pagination button, .artdeco-pagination a, button[aria-label*="Next" i], a[aria-label*="Next" i]')
    : null;
  if (!target) return;
  const beforeUrl = location.href;
  console.log("[WarmGraph][PeopleSearch] manual pagination click", {
    label: target.getAttribute("aria-label"),
    text: cleanText(target.innerText || target.textContent),
    beforeUrl
  });
  setTimeout(() => console.log("[WarmGraph][PeopleSearch] manual pagination click after event", {
    beforeUrl,
    afterUrl: location.href,
    urlChanged: beforeUrl !== location.href
  }), 0);
};
document.addEventListener("click", manualPaginationClickListener, true);

async function handlePeopleSearchUrlChange(trigger = "direct") {
  const nextUrl = window.location.href;
  const engineType = getAcquisitionEngineType();
  const changed = nextUrl !== __wgCurrentUrl;

  if (changed) {
    console.log("WG BUILD 12:58", getAcquisitionEngineType(), location.href);
    console.log("[WarmGraph][PeopleSearch] URL observer fired", {
      pathname: window.location.pathname,
      search: window.location.search,
      detectedBy: trigger,
      eligible: engineType === "PEOPLE_SEARCH",
      engineType,
      retryScheduled: isEligiblePeopleSearch() && engineType !== "PEOPLE_SEARCH",
      url: nextUrl
    });
  }

  // LinkedIn often updates the SPA path and its search parameters in separate
  // history/DOM steps. Do not consume that URL transition until the filtered
  // People Search route is actually eligible; otherwise a later parameter
  // update leaves the URL unchanged and this handler would never retry.
  if (!isEligiblePeopleSearch()) {
    if (changed) console.log("[WarmGraph][PeopleSearch] handler returned: pathname is not People Search", { pathname: window.location.pathname, url: nextUrl });
    __wgCurrentUrl = nextUrl;
    observedPeopleSearchFirstProfileUrl = null;
    return;
  }

  if (engineType !== "PEOPLE_SEARCH") {
    if (changed && lastLoggedPeopleSearchRetryUrl !== nextUrl) {
      lastLoggedPeopleSearchRetryUrl = nextUrl;
      console.log("[WarmGraph][PeopleSearch] handler deferred: People Search path not eligible yet; interval retry remains scheduled", { pathname: window.location.pathname, search: window.location.search, url: nextUrl });
    }
    return;
  }
  lastLoggedPeopleSearchRetryUrl = null;

  if (nextUrl === __wgCurrentUrl) {
    if (changed) console.log("[WarmGraph][PeopleSearch] handler returned: URL already handled", { url: nextUrl });
    return;
  }
  __wgCurrentUrl = nextUrl;
  acquisitionSession.pageExtractionComplete = false;

  const selectedDegree = getSelectedPeopleSearchDegree();
  if (!selectedDegree) {
    acquisitionSession.state = "paused";
    acquisitionSession.statusMessage = "Degree filter removed";
    if (acquisitionSession.isRunning || acquisitionSession.activeLoopPromise) {
      acquisitionSession.shouldCancel = true;
      if (acquisitionSession.nextBatchResolver) acquisitionSession.nextBatchResolver();
    }
    acquisitionSession.checkpointSessionSync();
    console.log("[WarmGraph][PeopleSearch] extraction stopped: degree filter removed", { url: nextUrl });
    return;
  }

  const previousDegree = acquisitionSession.activeDegreeFilter;
  if (previousDegree && previousDegree !== selectedDegree) {
    if (acquisitionSession.pendingDegreeRestart) return;
    acquisitionSession.pendingDegreeRestart = selectedDegree;
    console.log("[WarmGraph][PeopleSearch] degree filter changed; starting a fresh scoped acquisition", {
      previousDegree,
      selectedDegree,
      url: nextUrl
    });
    const restartForSelectedDegree = async () => {
      acquisitionSession.pendingDegreeRestart = null;
      if (getAcquisitionEngineType() !== "PEOPLE_SEARCH" || getSelectedPeopleSearchDegree() !== selectedDegree) return;
      acquisitionSession.reset(true);
      acquisitionSession.activeDegreeFilter = selectedDegree;
      acquisitionSession.engineType = "PEOPLE_SEARCH";
      acquisitionSession.start("acquiring");
    };
    if (acquisitionSession.activeLoopPromise) {
      acquisitionSession.shouldCancel = true;
      if (acquisitionSession.nextBatchResolver) acquisitionSession.nextBatchResolver();
      acquisitionSession.activeLoopPromise.finally(restartForSelectedDegree);
    } else {
      restartForSelectedDegree();
    }
    return;
  }

  if (acquisitionSession.manuallyFinished) {
    return;
  }

  if (acquisitionSession.state === "completed" || acquisitionSession.state === "resting" || acquisitionSession.completionStatus === "complete") {
    if (engineType === "PEOPLE_SEARCH") {
      acquisitionSession.reset(true);
      acquisitionSession.activeDegreeFilter = getSelectedPeopleSearchDegree();
      acquisitionSession.engineType = "PEOPLE_SEARCH";
    } else {
      return;
    }
  }

  if (
    acquisitionSession.running ||
    acquisitionSession.state === "acquiring" ||
    acquisitionSession.state === "navigating" ||
    window.__warmgraphAcquisitionRunning ||
    handlingPeopleSearchUrlChange
  ) {
    console.log("[URL OBSERVER] ignored because acquisition already running");
    return;
  }
  console.log("[WarmGraph][PeopleSearch] eligible SPA route; waiting for result cards", { url: nextUrl });
  handlingPeopleSearchUrlChange = true;

  acquisitionSession.isNavigating = true;
  acquisitionSession.state = "navigating";
  acquisitionSession.statusMessage = "Waiting for LinkedIn...";
  console.log("[WarmGraph][PeopleSearch] state transition: URL changed -> navigating", { url: nextUrl });
  acquisitionSession.checkpointSessionSync();

  try {
    let cards;
    try {
      cards = await waitForPeopleResultCards(10000);
    } catch (error) {
      console.warn("[WarmGraph][PeopleSearch] handler returned: result cards unavailable", { error: error.message, url: nextUrl });
      acquisitionSession.state = "interrupted";
      acquisitionSession.isPartial = true;
      acquisitionSession.statusMessage = "LinkedIn results did not finish loading. Acquisition paused.";
      acquisitionSession.checkpointSessionSync();
      return;
    }

    const currentProfiles = getPeopleSearchProfileUrls();
    if (cards.length === 0 || currentProfiles.length === 0) {
      console.warn("[WarmGraph][PeopleSearch] handler returned: result cards unavailable", { cardCount: cards.length, profileCount: currentProfiles.length, url: nextUrl });
      acquisitionSession.state = "interrupted";
      acquisitionSession.isPartial = true;
      acquisitionSession.statusMessage = "LinkedIn results did not finish loading. Acquisition paused.";
      acquisitionSession.checkpointSessionSync();
      return;
    }

    observedPeopleSearchFirstProfileUrl = currentProfiles[0];
    acquisitionSession.completionStatus = "incomplete";
    acquisitionSession.isPartial = false;
    acquisitionSession.state = "acquiring";
    acquisitionSession.statusMessage = "Auto Extracting";
    console.log("[WarmGraph][PeopleSearch] state transition: waiting_for_content -> acquiring", { profileCount: currentProfiles.length, firstProfile: currentProfiles[0], url: location.href });
    acquisitionSession.checkpointSessionSync();
    acquisitionSession.start("acquiring");
  } finally {
    handlingPeopleSearchUrlChange = false;
    console.log("[WarmGraph][PeopleSearch] URL handler finished", { state: acquisitionSession.state, url: location.href });
  }
}


pageScanObserver =
  new MutationObserver(
    (mutations) => {
      handlePeopleSearchUrlChange("mutation-observer");

      if (
        !mutations.some(
          (mutation) =>
            mutation.addedNodes.length > 0
        )
      ) {
        return;
      }


      if (scanTimer) {
        clearTimeout(scanTimer);
      }


      scanTimer =
        setTimeout(
          scanAndMaybeSync,
          SCAN_DEBOUNCE_MS
        );
    }
  );


try {
  pageScanObserver.observe(
    document.body || document.documentElement,
    {
      childList: true,
      subtree: true
    }
  );
  console.log("[WarmGraph] Page scan observer created", { url: location.href });
} catch (e) {
  // Ignore observer error in virtual environment
}

if (typeof setInterval === "function") {
  peopleSearchPollTimer = setInterval(() => handlePeopleSearchUrlChange("poll"), 1000);
}


// Initial scan so the content store
// is ready when the popup is opened.

initialScanTimer = setTimeout(
  scanAndMaybeSync,
  1500
);

// =========================================================
// LINKEDIN SPA NAVIGATION OBSERVER
// =========================================================

let __wgLastUrl = location.href;

function handleSpaNavigation() {
  const engine = getAcquisitionEngineType();

  if (!engine) return;

  console.log("[WarmGraph] SPA route:", engine);

  // The shared acquisitionSession owns all acquisition starts.
  if (window.__warmgraphAcquisitionRunning || acquisitionSession.activeLoopPromise) {
    console.log("[WarmGraph] SPA auto-start skipped: shared session already active", { engine, state: acquisitionSession.state });
    return;
  }

  if (spaStartTimer) clearTimeout(spaStartTimer);
  spaStartTimer = setTimeout(() => {
    if (getAcquisitionEngineType()) {
      startAutomaticAcquisition();
    }
  }, 1200);
}

spaRouteObserver = new MutationObserver(() => {
  if (location.href !== __wgLastUrl) {
    __wgLastUrl = location.href;
    handleSpaNavigation();
  }
});
spaRouteObserver.observe(document.body, {
  childList: true,
  subtree: true
});
console.log("[WarmGraph] SPA route observer created", { url: location.href });
