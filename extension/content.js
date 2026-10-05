if (typeof window !== "undefined") {
  window.__warmgraphInstanceId ||= (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
}
const instanceId = typeof window !== "undefined" ? window.__warmgraphInstanceId : "unknown";

console.log("[WG_RUNTIME] content_loaded", {
  instanceId,
  url: typeof window !== "undefined" ? window.location.href : "",
  readyState: typeof document !== "undefined" ? document.readyState : ""
});

const connectionStore = new Map();
const relationshipEvidenceStore = new Map();


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
    const candidateSelectors = [
      "a.global-nav__me-photo[href*='/in/']",
      ".global-nav__me a[href*='/in/']",
      "[data-view-name='nav-profile-section'] a[href*='/in/']",
      "a[href*='/in/'][data-control-name='nav.settings_view_profile']",
      "a[href*='/in/'][data-control-name*='identity_welcome_message']",
      "a[href*='/in/'][data-control-name*='nav.settings']",
      ".nav-profile-menu__link a[href*='/in/']",
      ".mn-identity-badge a[href*='/in/']",
      ".feed-identity-module a[href*='/in/']",
      "[data-control-name*='identity_profile_photo'][href*='/in/']"
    ];

    for (const sel of candidateSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.href) {
          const match = el.href.match(/\/in\/([^/?#]+)/);
          if (match && match[1] && match[1] !== "undefined") return match[1];
        }
      } catch (_) {}
    }

    // Secondary scan: check identity scripts or embedded json
    const codeBlocks = document.querySelectorAll('code[id*="bpr-guid-"]');
    for (const cb of codeBlocks) {
      const txt = cb.textContent || "";
      if (txt.includes('"publicIdentifier"')) {
        const match = txt.match(/"publicIdentifier"\s*:\s*"([^"]+)"/);
        if (match && match[1] && !match[1].includes("/")) return match[1];
      }
    }
  } catch (e) {
    // Non-browser environment - ignore
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
 * Detect the owner's LinkedIn identity from storage or DOM, or create a stable
 * local session owner ID immediately so acquisition never stalls in "Identity Pending".
 */
async function detectAndPersistOwnerIdentity() {
  const instId = typeof window !== "undefined" ? window.__warmgraphInstanceId : "unknown";

  // Step 1: Check existing persisted owner identity
  const stored = await new Promise(r => chrome.storage.local.get(["warmgraph_owner", "ownerId", "externalProfileUrl"], r));
  const currentOwner = stored && stored.warmgraph_owner;
  const existingOwnerId = currentOwner?.ownerId || (stored && stored.ownerId) || "";

  if (existingOwnerId) {
    // If we already have a real slug or local owner ID, preserve it
    cachedOwnerId = existingOwnerId;
    console.log("[WG_RUNTIME] owner_init", {
      instanceId: instId,
      existingOwnerId,
      resolvedOwnerId: existingOwnerId,
      source: currentOwner?.source || "storage"
    });
    return cachedOwnerId;
  }

  // Step 2: Try DOM detection from navigation or identity modules
  const slug = detectLinkedInOwnerSlug();
  const ownerId = slug ? slugToOwnerId(slug) : `wg_owner_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const profileUrl = slug ? `https://www.linkedin.com/in/${slug}` : null;
  const source = slug ? "linkedin_nav" : "local_session";

  const ownerRecord = {
    ownerId,
    profileUrl,
    name: "",
    detectedAt: new Date().toISOString(),
    source
  };

  await new Promise(r => chrome.storage.local.set({
    warmgraph_owner: ownerRecord,
    ownerId,
    externalProfileUrl: profileUrl
  }, r));

  cachedOwnerId = ownerId;

  console.log("[WG_RUNTIME] owner_init", {
    instanceId: instId,
    existingOwnerId: null,
    resolvedOwnerId: ownerId,
    source
  });

  return ownerId;
}

/**
 * Get the canonical owner ID.
 */
function getOwnerId() {
  if (cachedOwnerId) {
    return Promise.resolve(cachedOwnerId);
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(["warmgraph_owner", "ownerId"], async (result) => {
      const storedId = result?.warmgraph_owner?.ownerId || result?.ownerId;
      if (storedId) {
        cachedOwnerId = storedId;
        resolve(cachedOwnerId);
        return;
      }

      // Establish identity immediately
      const id = await detectAndPersistOwnerIdentity();
      resolve(id);
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

const CONNECTIONS_LOCKED_PATH = "/mynetwork/invite-connect/connections/";

function isApprovedExtractionPage() {
  if (typeof window === "undefined" || !window.location) return false;
  const url = window.location.href || "";
  const path = window.location.pathname || "";
  const search = window.location.search || "";
  const isConn = path.includes(CONNECTIONS_LOCKED_PATH) ||
                 path.includes("/mynetwork/invite-connect/connections") ||
                 url.includes("/mynetwork/invite-connect/connections") ||
                 url.includes("connections.html");
  const isFirstDegreeSearch = path.includes("/search/results/people/") &&
    (search.includes('network=%5B%22F%22%5D') || search.includes('network=["F"]') || search.includes('network=%5B%22F%22') || search.includes('network=["F"'));
  return isConn || isFirstDegreeSearch;
}

function isConnectionsPage() {
  return isApprovedExtractionPage();
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
  const anchors = root.querySelectorAll ? root.querySelectorAll('a[href*="/in/"]') : [];
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
  const pageType = getPageType();
  const isConnectionsPage = (
    pageType === "linkedin_network" ||
    (typeof window !== "undefined" && window.location.href.includes("/mynetwork/invite-connect/connections/")) ||
    (typeof window !== "undefined" && window.location.href.includes("connections.html"))
  );

  // Require "connected" or "1st" degree indicator ONLY if NOT on connections page
  const hasConnectedIndicator = /connected/i.test(text) || /\b1st\b/i.test(text);
  if (!isConnectionsPage && !hasConnectedIndicator) {
    return null;
  }
  if (/\b(2nd|3rd\+?)\b/i.test(text) && !hasConnectedIndicator) {
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

  return {
    name: profileAnchor.name,
    profile_url: profileAnchor.profile_url,
    degree: "1st",
    connection_date: connectionDate,
    headline,
    company: companyRes.company,
    role_type: companyRes.role_type,
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

if (typeof window !== "undefined") {
  window.addEventListener("scroll", (e) => {
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
  }, { capture: true, passive: true });
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

const ACQUISITION_MIN_DELAY_MS = 7000;
const ACQUISITION_MAX_DELAY_MS = 10000;

function getRandomAcquisitionDelayMs() {
  if (typeof window !== "undefined" && window.TEST_ACQUISITION_DELAY_MS !== undefined) {
    return window.TEST_ACQUISITION_DELAY_MS;
  }
  return Math.floor(Math.random() * (ACQUISITION_MAX_DELAY_MS - ACQUISITION_MIN_DELAY_MS + 1)) + ACQUISITION_MIN_DELAY_MS;
}

class ConnectionAcquisitionSession {
  constructor() {
    this.sessionId = `warmgraph_session_${Date.now()}`;
    this.connections = new Map();
    this.relationshipEvidence = new Map();
    this.seenProfiles = new Set();
    this.reset(false);
  }

  reset(clearStores = false) {
    this.state = "idle";
    if (clearStores) {
      this.sessionId = `warmgraph_session_${Date.now()}`;
      this.connections = new Map();
      this.relationshipEvidence = new Map();
      this.seenProfiles = new Set();
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
    const canonicalTotal = this.totalConnections || status.totalConnections || status.expected_total || 0;
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

    const currentSessionObj = {
      sessionId: this.sessionId,
      totalConnections: canonicalTotal,
      actualProfiles: canonicalActual,
      extractedConnections: canonicalExtracted,
      importedRecords: this.importedRecords,
      progressPercent: canonicalPct,
      state: canonicalState,
      syncStatus: canonicalComplete ? "synced" : (this.syncStatus || status.sync_status || "idle"),
      lastSyncedAt: canonicalComplete ? (this.lastSyncTimestamp || new Date().toISOString()) : (this.lastSyncTimestamp || null),
      nextBatchAt: canonicalComplete ? null : (status.nextBatchAt || null),
      estimatedRemainingMs: canonicalComplete ? null : (this.estimatedRemainingMs || status.pausedRemainingMs || null),
      lastKnownActualProfiles: canonicalActual,
      pausedRemainingMs: canonicalComplete ? null : (status.pausedRemainingMs || null),
      countdownSeconds: canonicalComplete ? 0 : (status.countdown_seconds || 0),
      statusMessage: canonicalComplete ? "You're all caught up ✨" : (status.status_message || "")
    };
    // ─────────────────────────────────────────────────────────────────────────

    // Legacy acquisition_session kept for backward-compat with background.js handlers
    const sessionObj = {
      sessionId: this.sessionId,
      lockedPath: status.lockedPath || CONNECTIONS_LOCKED_PATH,
      state: canonicalState,
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
      lastUpdated: new Date().toISOString()
    };

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      try {
        const storagePayload = {
          acquisition_session: sessionObj,
          currentSession: currentSessionObj,
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
  }

  checkpointSessionAsync() {
    this.checkpointSessionSync();
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["warmgraph_active_graph", "currentSession"], () => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  checkpointSession() {
    this.checkpointSessionSync();
    const status = this.getStatus();
    if (typeof window !== "undefined" && typeof window.updateWarmGraphOverlay === "function") {
      window.updateWarmGraphOverlay(status);
    }
    const payload = {
      action: "UPDATE_SESSION",
      sessionId: this.sessionId,
      lockedPath: status.lockedPath || CONNECTIONS_LOCKED_PATH,
      connections: (this.connections.size <= 200 || status.state === "completed" || status.state === "resting") ? status.connections : [],
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
    return new Promise((resolve) => {
      const applySession = (session, canonical) => {
        // canonical = the currentSession SSOT object (written by checkpointSessionSync)
        // session   = the legacy acquisition_session (has connection payloads)
        const merged = canonical || session;
        if (merged && ["acquiring", "waiting", "paused", "interrupted", "completed", "resting"].includes(merged.state)) {
          if (merged.sessionId) this.sessionId = merged.sessionId;
          if (merged.lockedPath) this.lockedPath = merged.lockedPath;

          // ── Restore FROZEN totals from canonical SSOT ──────────────────────
          // Never derive actualProfiles from extractedConnections here.
          if (canonical && canonical.totalConnections) {
            this.totalConnections = canonical.totalConnections;
            this.expectedTotal = canonical.totalConnections;
            // Prefer the stored actualProfiles (frozen -1 offset); fall back to totalConnections
            this.actualProfiles = (canonical.actualProfiles && canonical.actualProfiles > 0)
              ? canonical.actualProfiles
              : canonical.totalConnections;
          } else if (session) {
            const t = session.totalConnections || session.expectedTotal || 0;
            if (t > 0) {
              this.totalConnections = t;
              this.expectedTotal = t;
              this.actualProfiles = (session.actualProfiles && session.actualProfiles > 0)
                ? session.actualProfiles
                : t;
            }
          }
          // ───────────────────────────────────────────────────────────────────

          if (merged.importedRecords !== undefined) this.importedRecords = merged.importedRecords;
          if (merged.pausedRemainingMs !== undefined) this.pausedRemainingMs = merged.pausedRemainingMs;
          if (merged.syncStatus) this.syncStatus = merged.syncStatus;
          if (merged.nextBatchAt) this.nextBatchAt = merged.nextBatchAt;
          if (merged.countdownSeconds !== undefined) this.countdownSeconds = merged.countdownSeconds;

          // Restore connection payload from acquisition_session (has actual arrays)
          const src = session || merged;
          if (src.pageCount) this.pageCount = src.pageCount;
          if (src.completionStatus) this.completionStatus = src.completionStatus;
          if (src.isPartial !== undefined) this.isPartial = src.isPartial;
          if (src.statusMessage) this.statusMessage = src.statusMessage;
          if (src.syncMessage) this.syncMessage = src.syncMessage;
          if (src.nextSyncDelay) this.nextSyncDelay = src.nextSyncDelay;
          if (src.nextSyncAt) this.nextSyncAt = src.nextSyncAt;

          const storedConnections = src.collectedConnections || src.connections || [];
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
          chrome.storage.local.get(["currentSession", "acquisition_session"], (res) => {
            applySession(
              res ? res.acquisition_session : null,
              res ? res.currentSession : null
            );
          });
        } else {
          applySession(null, null);
        }
      } catch (e) {
        applySession(null, null);
      }
    });
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

  scanCurrentPageForUnseen() {
    if (!this.seenProfiles) this.seenProfiles = new Set();
    let newProfilesCount = 0;
    let duplicatesSkippedCount = 0;

    const domCards = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]') : [];
    const processedCardRoots = new Set();

    for (const anchor of domCards) {
      const profileUrl = normalizeProfileUrl(anchor.href);
      if (!profileUrl) continue;

      const card = getCardRoot(anchor);
      if (!card || processedCardRoots.has(card)) continue;

      const profileAnchor = getProfileAnchor(card);
      if (!profileAnchor) continue;

      processedCardRoots.add(card);

      const firstDegree = extractFirstDegreeCard(card, profileAnchor);
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
        continue;
      }

      const evidence = extractRelationshipEvidence(card, profileAnchor);
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

    this.lastBatchNewConnections = newProfilesCount;

    return {
      newProfilesCount,
      duplicatesSkippedCount,
      totalVisibleCards: processedCardRoots.size
    };
  }

  scanCurrentPage() {
    return this.scanCurrentPageForUnseen();
  }

  getVisibleProfileKeys() {
    const keys = new Set();
    // Restrict to connection card containers to avoid picking up nav/sidebar /in/ links
    const cardSelectors = [
      '.mn-connection-card',
      '.mn-connections-list li',
      '.scaffold-finite-scroll__content li',
      '.scaffold-finite-scroll__content .entity-result',
      '[data-view-name="connections-list-item"]',
      '.connection-card'
    ];
    let cardEls = [];
    if (document.querySelectorAll) {
      for (const sel of cardSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          cardEls = Array.from(els);
          break;
        }
      }
      // Fallback: all /in/ anchors (broad, but last resort)
      if (cardEls.length === 0) {
        cardEls = Array.from(document.querySelectorAll('a[href*="/in/"]'));
      }
    }
    for (const el of cardEls) {
      // If el is an anchor, use directly; otherwise find /in/ links within the card
      const anchors = el.tagName === 'A' ? [el] : (el.querySelectorAll ? el.querySelectorAll('a[href*="/in/"]') : []);
      for (const a of anchors) {
        const norm = normalizeProfileUrl(a.href);
        if (norm) {
          keys.add(norm);
          break; // one key per card
        }
      }
    }
    return keys;
  }

  resolveScrollContainer() {
    // 1. Check ancestors of connections list or loader
    const listEl = document.querySelector ? document.querySelector('.mn-connections-list, .scaffold-finite-scroll__content, .scaffold-finite-scroll') : null;
    let cur = listEl;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      try {
        const style = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle(cur) : {};
        const oy = style.overflowY || style.overflow || "";
        if ((oy.includes("auto") || oy.includes("scroll") || oy.includes("overlay")) && cur.scrollHeight > cur.clientHeight + 10) {
          return cur;
        }
      } catch (_) {}
      cur = cur.parentElement;
    }

    // 2. Check explicit layout elements
    const explicitEls = document.querySelectorAll ? document.querySelectorAll('.scaffold-layout__main, .scaffold-finite-scroll, main') : [];
    for (const el of explicitEls) {
      try {
        const style = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle(el) : {};
        const oy = style.overflowY || style.overflow || "";
        if ((oy.includes("auto") || oy.includes("scroll") || oy.includes("overlay")) && el.scrollHeight > el.clientHeight + 10) {
          return el;
        }
      } catch (_) {}
    }

    // 3. Document scroller fallback
    return document.scrollingElement || document.documentElement || document.body;
  }

  findLoadMoreButton() {
    const selectors = [
      'button.scaffold-finite-scroll__load-button',
      'button[aria-label*="Load more" i]',
      'button[aria-label*="Show more" i]',
      'button[aria-label*="See more" i]',
      '#infiniteLoader',
      'button#nextPage',
      'button#nextPageBottom'
    ];

    for (const sel of selectors) {
      const el = document.querySelector ? document.querySelector(sel) : null;
      if (el && !el.disabled && el.offsetParent !== null) {
        return el;
      }
    }

    const allButtons = document.querySelectorAll ? document.querySelectorAll('button') : [];
    for (const b of allButtons) {
      if (b.disabled || b.offsetParent === null) continue;
      const txt = (b.innerText || b.textContent || "").trim().toLowerCase();
      if (txt === "load more" || txt === "show more" || txt === "see more connections" || txt.includes("next page")) {
        return b;
      }
    }
    return null;
  }

  async performTraversalStep(container) {
    const isDoc = (container === document.body || container === document.documentElement || container === document.scrollingElement);
    const scrollTopBefore = isDoc
      ? (window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0)
      : (container ? container.scrollTop : 0);
    const scrollHeight = container ? container.scrollHeight : (document.documentElement ? document.documentElement.scrollHeight : 0);
    const clientHeight = container ? container.clientHeight : (window.innerHeight || 800);
    const isAtBottom = (scrollTopBefore + clientHeight >= scrollHeight - 50);

    // 1. Check for Load More button
    const loadMoreBtn = this.findLoadMoreButton();
    if (loadMoreBtn) {
      try {
        loadMoreBtn.click();
        return {
          method: "load_more",
          moved: true,
          scrollTopBefore,
          scrollHeight,
          clientHeight,
          isAtBottom: false
        };
      } catch (_) {}
    }

    // 2. Container or Window Scroll
    const scrollStep = Math.max(500, Math.floor(clientHeight * 0.75));
    let moved = false;

    if (container && !isDoc) {
      const prev = container.scrollTop;
      container.scrollTop = Math.min(scrollHeight - clientHeight, container.scrollTop + scrollStep);
      moved = (container.scrollTop !== prev);
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
    }

    if (!moved || isDoc) {
      const prevWinY = window.scrollY || 0;
      if (typeof window.scrollBy === "function") {
        window.scrollBy({ top: scrollStep, behavior: "instant" });
      } else {
        const scroller = document.scrollingElement || document.documentElement || document.body;
        if (scroller) scroller.scrollTop = (scroller.scrollTop || 0) + scrollStep;
      }
      const newWinY = window.scrollY || 0;
      if (newWinY !== prevWinY) moved = true;
      window.dispatchEvent(new Event("scroll", { bubbles: true }));
    }

    // Also trigger intersection observers on sentinel / last card
    const anchors = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]') : [];
    if (anchors.length > 0) {
      const lastAnchor = anchors[anchors.length - 1];
      const sentinel = (lastAnchor.closest && lastAnchor.closest('li, .mn-connection-card, [class*="card"]')) || lastAnchor;
      if (sentinel && typeof sentinel.scrollIntoView === "function") {
        try {
          sentinel.scrollIntoView({ block: "end", behavior: "instant" });
        } catch (_) {}
      }
    }

    return {
      method: "scroll",
      moved,
      scrollTopBefore,
      scrollHeight,
      clientHeight,
      isAtBottom
    };
  }

  async syncToBackend() {
    return this.autoSyncToBackend();
  }

  async autoSyncToBackend(isRetry = false) {
    if (this.state !== "completed" || this.isPartial) {
      this.syncStatus = "blocked";
      this.syncMessage = "Backend sync blocked: Partial or incomplete datasets are never synced automatically.";
      await this.checkpointSessionAsync();
      return false;
    }

    if (this.syncStatus === "synced" || this.autoSyncCompleted) {
      return false;
    }

    if (this.syncInFlight && !isRetry) {
      return false;
    }

    this.syncInFlight = true;
    const ownerId = await getOwnerId();

    // LOG 1: [WG_AUTO_SYNC] FINAL_STATE
    console.log("[WG_AUTO_SYNC] FINAL_STATE", {
      sessionId: this.sessionId,
      ownerId,
      totalConnections: this.totalConnections || this.expectedTotal,
      targetProfiles: this.actualProfiles || this.expectedTotal,
      actualProfiles: this.connections.size,
      completionStatus: this.completionStatus || "complete",
      verifiedExhaustion: true,
      connectionStoreCount: typeof connectionStore !== "undefined" ? connectionStore.size : 0,
      checkpointConnectionCount: this.connections.size
    });

    // LOG 2: [WG_AUTO_SYNC] REQUEST
    console.log("[WG_AUTO_SYNC] REQUEST", {
      sessionId: this.sessionId,
      connectionCount: this.connections.size,
      expectedTotal: this.expectedTotal || this.totalConnections,
      completionStatus: this.completionStatus || "complete"
    });

    this.syncStatus = "syncing";
    this.syncMessage = "Saving your network to WarmGraph...";
    await this.checkpointSessionAsync();

    try {
      let syncResult = null;

      // Invoke canonical SYNC_NETWORK background path (same path as manual Sync Again)
      if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
        syncResult = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ type: "SYNC_NETWORK", action: "SYNC_NETWORK" }, (res) => {
              if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
              } else {
                resolve(res || { success: true });
              }
            });
          } catch (err) {
            resolve({ success: false, error: err.message });
          }
        });
      }

      if (syncResult && syncResult.success) {
        this.syncStatus = "synced";
        this.syncMessage = "Network Successfully Synced ✓";
        this.lastSyncTimestamp = new Date().toISOString();
        this.lastSyncError = null;
        this.autoSyncCompleted = true;
        this.syncInFlight = false;

        console.log("[WG_AUTO_SYNC] SUCCESS", {
          status: 200,
          connectionCount: this.connections.size
        });

        await this.checkpointSessionAsync();
        return true;
      }

      // Fallback direct POST /network/import if runtime message response was empty or failed
      const payload = {
        owner_id: ownerId,
        source: "linkedin_dom",
        confirmed: true,
        connections: Array.from(this.connections.values()),
        relationship_evidence: Array.from(this.relationshipEvidence.values()),
        page_type: getPageType(),
        page_url: window.location.href,
        expected_total: this.expectedTotal || this.connections.size,
        collected_total: this.connections.size,
        completion_status: this.completionStatus || "complete"
      };

      if (typeof fetch === "function") {
        const res = await fetch(`${BACKEND_BASE_URL}/network/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          this.syncStatus = "synced";
          this.syncMessage = "Network Successfully Synced ✓";
          this.lastSyncTimestamp = new Date().toISOString();
          this.lastSyncError = null;
          this.autoSyncCompleted = true;
          this.syncInFlight = false;

          console.log("[WG_AUTO_SYNC] SUCCESS", {
            status: res.status,
            connectionCount: this.connections.size
          });

          await this.checkpointSessionAsync();
          return true;
        } else {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.detail || `Backend returned HTTP ${res.status}`;

          this.syncStatus = "failed";
          this.syncMessage = "Network sync failed — Sync Again to retry.";
          this.lastSyncError = errMsg;
          this.syncInFlight = false;

          console.log("[WG_AUTO_SYNC] FAILURE", {
            status: res.status,
            error: errMsg
          });

          await this.checkpointSessionAsync();
          return false;
        }
      }
    } catch (err) {
      const errMsg = err.message || "Network error while connecting to backend.";
      this.syncStatus = "failed";
      this.syncMessage = "Network sync failed — Sync Again to retry.";
      this.lastSyncError = errMsg;
      this.syncInFlight = false;

      console.log("[WG_AUTO_SYNC] FAILURE", {
        status: 500,
        error: errMsg
      });

      await this.checkpointSessionAsync();
      return false;
    }
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

  async finishSessionAsComplete() {
    this.state = "completed";
    this.completionStatus = "complete";
    this.verifiedExhaustion = true;
    this.isPartial = false;
    this.statusMessage = "You're all caught up ✨";
    this.nextBatchAt = null;
    this.nextSyncDelay = 0;
    this.countdownSeconds = 0;
    this.pausedRemainingMs = null;
    this.estimatedRemainingMs = null;

    // STEP 1 & 2: Await final checkpoint persistence so warmgraph_active_graph is written to disk BEFORE sync
    await this.checkpointSessionAsync();

    // STEP 3: Trigger automatic completion sync via canonical path
    await this.autoSyncToBackend();
  }

  async runAcquisitionLoop() {
    if (typeof window !== "undefined") {
      window.__warmgraphAcquisitionRunning = true;
    }
    this.isRunning = true;
    this.pageCount = 0;
    this.shouldCancel = false;

    if (!this.seenProfiles) this.seenProfiles = new Set();
    this.connections.forEach((c) => {
      const key = this.getDeduplicationKey(c);
      if (key) this.seenProfiles.add(key);
    });

    // ── SSOT: Freeze totalConnections and actualProfiles with live DOM header ────
    const domTotal = extractTotalConnectionsFromDom();
    if (domTotal && domTotal > 0) {
      const liveTarget = Math.max(domTotal - 1, 0);
      if (!this.totalConnections || this.totalConnections !== domTotal || this.actualProfiles !== liveTarget) {
        this.totalConnections = domTotal;
        this.expectedTotal = domTotal;
        this.actualProfiles = liveTarget;
      }
    }

    // Step 1: Initial extraction of cards visible in initial view
    this.state = "acquiring";
    this.statusMessage = "Mapping your network...";
    const initialScan = this.scanCurrentPageForUnseen();
    if (initialScan.newProfilesCount > 0) {
      await this.checkpointSession();
    }

    let consecutiveZeroProgressCount = 0;
    const MAX_ZERO_PROGRESS = 4;

    while (!this.shouldCancel) {
      // 1. Guard route: must remain on approved connections page
      if (!isConnectionsPage()) {
        this.state = "paused";
        this.statusMessage = "Return to Connections to continue syncing.";
        if (this.nextBatchAt && this.nextBatchAt > Date.now()) {
          this.pausedRemainingMs = this.nextBatchAt - Date.now();
        }
        await this.checkpointSession();
        break;
      }

      // 2. Check if target reached
      const currentCount = this.connections.size;
      const targetCount = this.actualProfiles || this.expectedTotal || 0;
      if (targetCount > 0 && currentCount >= targetCount) {
        await this.finishSessionAsComplete();
        break;
      }

      this.pageCount++;

      // 3. Before traversal: capture visible profile keys and container state
      const keysBefore = this.getVisibleProfileKeys();
      const container = this.resolveScrollContainer();

      // 4. Perform traversal (scroll or Load More click)
      this.state = "waiting";
      this.statusMessage = "Loading connections...";
      const traversal = await this.performTraversalStep(container);

      // 5. Pacing delay: allow LinkedIn enough time to render
      // Human-paced ~7-10s interval (or TEST_ACQUISITION_DELAY_MS in automated tests)
      const delayMs = getRandomAcquisitionDelayMs();
      const delaySec = Math.round(delayMs / 1000);
      this.nextSyncDelay = delayMs;
      this.nextBatchAt = Date.now() + delayMs;
      this.nextSyncAt = new Date(this.nextBatchAt).toISOString();
      this.statusMessage = `Next batch in ${delaySec}s`;
      await this.checkpointSession();

      await this.waitForNextBatch(this.nextBatchAt);

      if (this.shouldCancel) break;

      // 6. After traversal: extract all newly exposed cards
      this.state = "acquiring";
      this.statusMessage = "Mapping your network...";
      const scanRes = this.scanCurrentPageForUnseen();

      // 7. Check for new profile keys
      if (scanRes.newProfilesCount > 0) {
        consecutiveZeroProgressCount = 0;
        await this.checkpointSession();

        // Check if target reached
        if (targetCount > 0 && this.connections.size >= targetCount) {
          await this.finishSessionAsComplete();
          break;
        }
      } else {
        // No new profiles in this batch — assess stall reason and initiate controlled render recovery
        const container = this.resolveScrollContainer();
        const isDoc = (container === document.body || container === document.documentElement || container === document.scrollingElement);
        const currentScrollTop = isDoc
          ? (window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0)
          : (container ? container.scrollTop : 0);
        const scrollHeight = container ? container.scrollHeight : (document.documentElement ? document.documentElement.scrollHeight : 0);
        const clientHeight = container ? container.clientHeight : (window.innerHeight || 800);
        const visibleKeys = Array.from(this.getVisibleProfileKeys());

        let stallReason = "rendering_lag";
        if (traversal.moved === false) {
          stallReason = "scrolling_stuck";
        } else if (targetCount > 0 && this.connections.size >= targetCount) {
          stallReason = "target_reached";
        } else if (traversal.isAtBottom && !this.findLoadMoreButton()) {
          stallReason = "at_bottom";
        }

        console.log("[WG_RENDER_WAIT]", {
          extracted: this.connections.size,
          target: targetCount,
          scrollTop: currentScrollTop,
          scrollHeight,
          clientHeight,
          visibleKeys: visibleKeys.length,
          reason: stallReason
        });

        this.state = "WAITING_FOR_RENDER";
        this.statusMessage = "Waiting for LinkedIn to load more connections...";
        await this.checkpointSession();

        let recoveryProgressMade = false;

        for (let attempt = 1; attempt <= 3; attempt++) {
          if (this.shouldCancel || !isConnectionsPage()) break;

          const activeContainer = this.resolveScrollContainer();
          const activeIsDoc = (activeContainer === document.body || activeContainer === document.documentElement || activeContainer === document.scrollingElement);
          const prevScrollTop = activeIsDoc
            ? (window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0)
            : (activeContainer ? activeContainer.scrollTop : 0);
          const newKeysBefore = this.scanCurrentPageForUnseen().newProfilesCount;

          // Controlled recovery per attempt:
          // Attempt 1: Passive 1.5s wait for DOM to render existing pending cards
          // Attempt 2: Active scroll nudge (-150px then +250px) to awaken LinkedIn's IntersectionObserver
          // Attempt 3: Check Load More button OR sentinel scrollIntoView on last card anchor
          if (attempt === 2) {
            if (!activeIsDoc && activeContainer) {
              activeContainer.scrollTop = Math.max(0, activeContainer.scrollTop - 150);
              activeContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
              await new Promise(r => setTimeout(r, 200));
              activeContainer.scrollTop = activeContainer.scrollTop + 250;
              activeContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
            } else {
              if (typeof window.scrollBy === "function") {
                window.scrollBy({ top: -150, behavior: "instant" });
                window.dispatchEvent(new Event("scroll", { bubbles: true }));
                await new Promise(r => setTimeout(r, 200));
                window.scrollBy({ top: 250, behavior: "instant" });
                window.dispatchEvent(new Event("scroll", { bubbles: true }));
              }
            }
          } else if (attempt === 3) {
            const loadMoreBtn = this.findLoadMoreButton();
            if (loadMoreBtn) {
              try { loadMoreBtn.click(); } catch (_) {}
            } else {
              const anchors = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]') : [];
              if (anchors.length > 0) {
                const lastAnchor = anchors[anchors.length - 1];
                const sentinel = (lastAnchor.closest && lastAnchor.closest('li, .mn-connection-card, [class*="card"]')) || lastAnchor;
                if (sentinel && typeof sentinel.scrollIntoView === "function") {
                  try { sentinel.scrollIntoView({ block: "end", behavior: "instant" }); } catch (_) {}
                }
              }
            }
          }

          const waitTime = attempt === 1 ? 1500 : 2000;
          await new Promise(r => setTimeout(r, waitTime));

          const recScan = this.scanCurrentPageForUnseen();
          const newKeysAfter = recScan.newProfilesCount;
          const newScrollTop = activeIsDoc
            ? (window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0)
            : (activeContainer ? activeContainer.scrollTop : 0);

          const recovered = (recScan.newProfilesCount > 0);

          console.log("[WG_RENDER_RECOVERY]", {
            attempt,
            previousScrollTop: prevScrollTop,
            newScrollTop,
            newKeysBefore,
            newKeysAfter,
            recovered
          });

          if (recovered) {
            recoveryProgressMade = true;
            this.state = "acquiring";
            this.statusMessage = "Resuming extraction...";
            consecutiveZeroProgressCount = 0;
            await this.checkpointSession();
            break;
          }
        }

        if (recoveryProgressMade) {
          if (targetCount > 0 && this.connections.size >= targetCount) {
            await this.finishSessionAsComplete();
            break;
          }
          continue;
        }

        // Bounded recovery completed without new keys — evaluate genuine exhaustion
        const hasLoader = !!(document.querySelector && document.querySelector('.scaffold-finite-scroll__loader, #infiniteLoader, [class*="loader"]'));
        const hasLoadMore = !!this.findLoadMoreButton();

        const scrollStuck = (traversal.method === "scroll" && traversal.moved === false);
        if ((!hasLoader && !hasLoadMore && traversal.isAtBottom) || (scrollStuck && !hasLoader && !hasLoadMore)) {
          consecutiveZeroProgressCount++;
        } else if (hasLoader) {
          consecutiveZeroProgressCount = Math.max(0, consecutiveZeroProgressCount - 1);
        }

        if (consecutiveZeroProgressCount >= MAX_ZERO_PROGRESS) {
          await this.finishSessionAsComplete();
          break;
        }
      }
    }

    if (this.shouldCancel) {
      this.state = "paused";
      this.statusMessage = "Acquisition stopped. Progress saved.";
      await this.checkpointSession();
    }

    if (typeof window !== "undefined") {
      window.__warmgraphAcquisitionRunning = false;
    }
    this.isRunning = false;
    this.activeLoopPromise = null;
    this.nextBatchResolver = null;
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
    const liveActual = liveTotal > 1 ? liveTotal - 1 : liveTotal;
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
      }, 500);

      setTimeout(finish, remaining + 100);
    });
  }

  start(stateName = "acquiring") {
    if (!isConnectionsPage()) {
      this.state = "paused";
      this.statusMessage = "Return to Connections to continue syncing.";
      this.checkpointSessionSync();
      return this.getStatus();
    }

    const instId = typeof window !== "undefined" ? window.__warmgraphInstanceId : "unknown";
    console.log("[WG_RUNTIME] acquisition_start", {
      instanceId: instId,
      ownerId: cachedOwnerId,
      sessionId: this.sessionId,
      state: stateName
    });

    if ((typeof window !== "undefined" && window.__warmgraphAcquisitionRunning) || this.isRunning || this.activeLoopPromise) {
      return this.getStatus();
    }
    if ((this.state === "acquiring" || this.state === "collecting" || this.state === "waiting_for_content" || this.state === "settling") && this.activeLoopPromise) {
      return this.getStatus();
    }
    if (!this.sessionId) {
      this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    this.lockedPath = CONNECTIONS_LOCKED_PATH;
    this.shouldCancel = false;
    this.state = stateName;
    this.activeLoopPromise = this.runAcquisitionLoop();
    this.checkpointSessionSync();
    return this.getStatus();
  }

  cancel() {
    this.shouldCancel = true;
    this.state = "paused";
    this.statusMessage = "Extraction stopped. Progress saved.";
    if (this.nextBatchResolver) {
      this.nextBatchResolver();
      this.nextBatchResolver = null;
    }
    this.checkpointSessionSync();
    return { success: true };
  }

  getStatus() {
    const collected = this.connections.size;
    const expected = this.expectedTotal || Math.max(collected, 1);
    const rawActual = this.actualProfiles !== undefined ? this.actualProfiles : (expected > 1 ? expected - 1 : (expected || collected || 1));
    const isCompletedOrResting = (this.state === "completed" || this.state === "resting" || this.completionStatus === "complete") && (rawActual > 0 && collected >= rawActual);
    const actual = rawActual;
    const remaining = Math.max(0, actual - collected);
    const progressPct = actual > 0 ? (collected >= actual ? 100 : Math.min(99, Math.floor((collected / actual) * 100))) : (collected > 0 ? 100 : 0);
    const imported = this.importedRecords;
    const activeFilterObj = this.activeFilter || extractActiveFilterFromDom();
    const now = Date.now();
    const isPaused = this.state === "paused" || this.state === "interrupted" || !isConnectionsPage();
    const derivedCountdown = isPaused
      ? (this.pausedRemainingMs ? Math.ceil(this.pausedRemainingMs / 1000) : (this.countdownSeconds || 0))
      : ((this.nextBatchAt && this.nextBatchAt > now) ? Math.max(0, Math.ceil((this.nextBatchAt - now) / 1000)) : (this.countdownSeconds || 0));

    return {
      sessionId: this.sessionId,
      lockedPath: this.lockedPath || CONNECTIONS_LOCKED_PATH,
      state: isPaused && (this.state === "acquiring" || this.state === "waiting") ? "paused" : this.state,
      completion_status: this.completionStatus || (this.state === "completed" ? (collected >= expected ? "complete" : "complete_rendered_dataset") : "incomplete"),
      page_count: this.pageCount,
      expected_total: expected,
      // SSOT: totalConnections is the frozen LinkedIn header value from runAcquisitionLoop start
      totalConnections: this.totalConnections || expected,
      actualProfiles: actual,
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
      first_degree_count: collected,
      relationship_evidence_count: this.relationshipEvidence.size,
      last_batch_new_connections: this.lastBatchNewConnections,
      last_batch_new_evidence: this.lastBatchNewEvidence,
      is_partial: this.isPartial,
      status_message: isPaused ? "Return to Connections to continue syncing." : this.statusMessage,
      sync_status: this.syncStatus,
      sync_message: this.syncMessage,
      last_synced_at: this.lastSyncTimestamp || null,
      telemetry: this.lastTelemetry || null,
      container_diagnostics: inspectLiveScrollContainers(),
      connections: Array.from(this.connections.values()),
      relationship_evidence: Array.from(this.relationshipEvidence.values()),
      reliable_dom_total: this.totalConnections || expected
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
  return null;
}

if (typeof window !== "undefined") {
  window.getRandomAcquisitionDelayMs = getRandomAcquisitionDelayMs;
  window.extractTotalConnectionsFromDom = extractTotalConnectionsFromDom;
}

let isEnsuringAcquisition = false;
async function ensureConnectionsAcquisition() {
  const instId = typeof window !== "undefined" ? window.__warmgraphInstanceId : "unknown";
  const isConn = isConnectionsPage();

  console.log("[WG_RUNTIME] route_detected", {
    instanceId: instId,
    url: typeof window !== "undefined" ? window.location.href : "",
    isConnectionsPage: isConn
  });

  if (isEnsuringAcquisition) return;
  if (!isConn) {
    if (
      acquisitionSession &&
      (acquisitionSession.isRunning ||
        ["acquiring", "waiting", "building", "waiting_for_content", "settling"].includes(acquisitionSession.state))
    ) {
      acquisitionSession.shouldCancel = true;
      acquisitionSession.state = "paused";
      acquisitionSession.statusMessage = "Return to Connections to continue syncing.";
      if (acquisitionSession.nextBatchResolver) {
        acquisitionSession.nextBatchResolver();
        acquisitionSession.nextBatchResolver = null;
      }
      acquisitionSession.checkpointSessionSync();
    }
    return;
  }

  isEnsuringAcquisition = true;
  try {
    // 1. Establish owner identity immediately
    const ownerId = await detectAndPersistOwnerIdentity();

    // 2. Hydrate session from storage
    await acquisitionSession.initOrHydrateSession();

    // 3. Reconcile restored session against live LinkedIn DOM header
    const linkedinDisplayedTotal = extractTotalConnectionsFromDom();
    const restoredTargetProfiles = acquisitionSession.actualProfiles || acquisitionSession.expectedTotal || 0;
    const restoredConnectionCount = acquisitionSession.connections ? acquisitionSession.connections.size : 0;
    const restoredCompletionStatus = acquisitionSession.completionStatus || "incomplete";
    const restoredAutoSyncCompleted = !!acquisitionSession.autoSyncCompleted;

    let liveTargetProfiles = restoredTargetProfiles;
    let action = "PRESERVE_VALID_TARGET";

    if (linkedinDisplayedTotal && linkedinDisplayedTotal > 0) {
      liveTargetProfiles = Math.max(linkedinDisplayedTotal - 1, 0);

      if (restoredTargetProfiles > 0 && restoredTargetProfiles !== liveTargetProfiles) {
        action = "INVALIDATE_STALE_TARGET";
        acquisitionSession.totalConnections = linkedinDisplayedTotal;
        acquisitionSession.expectedTotal = linkedinDisplayedTotal;
        acquisitionSession.actualProfiles = liveTargetProfiles;
        acquisitionSession.completionStatus = "incomplete";
        acquisitionSession.autoSyncCompleted = false;
        acquisitionSession.syncInFlight = false;
        acquisitionSession.syncStatus = "idle";
        acquisitionSession.syncMessage = "";
        if (acquisitionSession.state === "completed" || acquisitionSession.state === "resting") {
          acquisitionSession.state = "acquiring";
          acquisitionSession.statusMessage = "Mapping your network...";
        }
      } else if (restoredTargetProfiles === 0) {
        action = "SET_NEW_TARGET";
        acquisitionSession.totalConnections = linkedinDisplayedTotal;
        acquisitionSession.expectedTotal = linkedinDisplayedTotal;
        acquisitionSession.actualProfiles = liveTargetProfiles;
      }
    }

    console.log("[WG_TARGET]", {
      linkedinDisplayedTotal: linkedinDisplayedTotal || "not_found_yet",
      targetProfiles: liveTargetProfiles,
      restoredTargetProfiles,
      restoredConnectionCount,
      restoredCompletionStatus,
      restoredAutoSyncCompleted,
      action
    });

    // 4. Immediately create & render overlay with reconciled state (actual/target mapped) BEFORE extraction loop starts
    acquisitionSession.checkpointSessionSync();
    if (typeof window !== "undefined" && typeof window.updateWarmGraphOverlay === "function") {
      window.updateWarmGraphOverlay(acquisitionSession.getStatus());
    }

    console.log("[WG_RUNTIME] connections_detected", {
      instanceId: instId,
      ownerReady: !!ownerId,
      sessionState: acquisitionSession.state,
      isRunning: acquisitionSession.isRunning || !!window.__warmgraphAcquisitionRunning
    });

    // 5. Check if session is genuinely completed for the reconciled target
    const extractedCount = acquisitionSession.connections ? acquisitionSession.connections.size : 0;
    const targetCount = acquisitionSession.actualProfiles || liveTargetProfiles;
    if (targetCount > 0 && extractedCount >= targetCount && acquisitionSession.completionStatus === "complete") {
      acquisitionSession.state = "completed";
      acquisitionSession.checkpointSessionSync();
      return;
    }

    // 6. Start acquisition if not already running
    if (!acquisitionSession.isRunning && !window.__warmgraphAcquisitionRunning) {
      console.log("[WG_START_CALLER]", {
        instanceId: instId,
        caller: "ensureConnectionsAcquisition",
        url: typeof window !== "undefined" ? window.location.href : "",
        isConnectionsPage: isConnectionsPage(),
        stack: new Error().stack
      });
      acquisitionSession.start();
    }
  } finally {
    isEnsuringAcquisition = false;
  }
}

let routeDebounceTimer = null;
function handleRouteChange() {
  if (routeDebounceTimer) clearTimeout(routeDebounceTimer);
  routeDebounceTimer = setTimeout(() => {
    const instId = typeof window !== "undefined" ? window.__warmgraphInstanceId : "unknown";
    const isConn = isConnectionsPage();
    console.log("[WG_ROUTE_DECISION]", {
      instanceId: instId,
      url: typeof window !== "undefined" ? window.location.href : "",
      pathname: typeof window !== "undefined" ? window.location.pathname : "",
      isConnectionsPage: isConn,
      ownerReady: !!cachedOwnerId,
      acquisitionRunning: !!((typeof window !== "undefined" && window.__warmgraphAcquisitionRunning) || (acquisitionSession && acquisitionSession.isRunning)),
      sessionState: acquisitionSession ? acquisitionSession.state : "none"
    });
    ensureConnectionsAcquisition();
  }, 250);
}

function hookHistoryEvents() {
  if (typeof window === "undefined" || window.__warmgraphHistoryHooked) return;
  window.__warmgraphHistoryHooked = true;

  const dispatchRouteChange = () => {
    window.dispatchEvent(new CustomEvent("warmgraph:routechange"));
  };

  const origPushState = window.history.pushState;
  if (typeof origPushState === "function") {
    window.history.pushState = function (...args) {
      const res = origPushState.apply(this, args);
      dispatchRouteChange();
      return res;
    };
  }

  const origReplaceState = window.history.replaceState;
  if (typeof origReplaceState === "function") {
    window.history.replaceState = function (...args) {
      const res = origReplaceState.apply(this, args);
      dispatchRouteChange();
      return res;
    };
  }

  window.addEventListener("popstate", dispatchRouteChange);
  window.addEventListener("warmgraph:routechange", handleRouteChange);

  let currentUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      dispatchRouteChange();
    }
  }, 500);
}

hookHistoryEvents();
setTimeout(ensureConnectionsAcquisition, 100);

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (acquisitionSession && ["acquiring", "waiting_for_content", "settling", "waiting"].includes(acquisitionSession.state)) {
      acquisitionSession.state = "paused";
      acquisitionSession.statusMessage = "Return to Connections to continue syncing.";
      if (acquisitionSession.nextBatchAt && acquisitionSession.nextBatchAt > Date.now()) {
        acquisitionSession.pausedRemainingMs = acquisitionSession.nextBatchAt - Date.now();
      }
      acquisitionSession.checkpointSessionSync();
    }
  });

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (acquisitionSession) {
          acquisitionSession.isTabHidden = false;
          if (isConnectionsPage()) {
            const extractedCount = acquisitionSession.connections ? acquisitionSession.connections.size : 0;
            const targetCount = acquisitionSession.actualProfiles || acquisitionSession.expectedTotal || 0;
            if (targetCount === 0 || extractedCount < targetCount) {
              if (!window.__warmgraphAcquisitionRunning) {
                const instId = typeof window !== "undefined" ? window.__warmgraphInstanceId : "unknown";
                console.log("[WG_START_CALLER]", {
                  instanceId: instId,
                  caller: "visibilitychange",
                  url: typeof window !== "undefined" ? window.location.href : "",
                  isConnectionsPage: isConnectionsPage(),
                  stack: new Error().stack
                });
                acquisitionSession.start();
              } else if (acquisitionSession.nextBatchAt && Date.now() >= acquisitionSession.nextBatchAt) {
                if (acquisitionSession.nextBatchResolver) {
                  acquisitionSession.nextBatchResolver();
                }
              }
            }
          }
        }
      } else {
        if (acquisitionSession) {
          acquisitionSession.isTabHidden = true;
        }
      }
    });
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
      case "syncAgain": {
        if (isApprovedExtractionPage()) {
          (async () => {
            const rec = await acquisitionSession.reconcileNetworkWithDom(true);
            if (rec.action !== "skip") {
              const instId = typeof window !== "undefined" ? window.__warmgraphInstanceId : "unknown";
              console.log("[WG_START_CALLER]", {
                instanceId: instId,
                caller: "onMessage:SYNC_AGAIN",
                url: typeof window !== "undefined" ? window.location.href : "",
                isConnectionsPage: isConnectionsPage(),
                stack: new Error().stack
              });
              acquisitionSession.start();
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
          if (acquisitionSession.nextBatchResolver) {
            acquisitionSession.nextBatchResolver();
          } else if (!window.__warmgraphAcquisitionRunning) {
            const extractedCount = acquisitionSession.connections ? acquisitionSession.connections.size : 0;
            const targetCount = acquisitionSession.actualProfiles || acquisitionSession.expectedTotal || 0;
            if (targetCount === 0 || extractedCount < targetCount) {
              const instId = typeof window !== "undefined" ? window.__warmgraphInstanceId : "unknown";
              console.log("[WG_START_CALLER]", {
                instanceId: instId,
                caller: "onMessage:RUN_NEXT_BATCH",
                url: typeof window !== "undefined" ? window.location.href : "",
                isConnectionsPage: isConnectionsPage(),
                stack: new Error().stack
              });
              acquisitionSession.start();
            }
          }
        }
        sendResponse({ success: true, running: !!(typeof window !== "undefined" && window.__warmgraphAcquisitionRunning) });
        break;
      }
      case "startAutomatedAcquisition": {
        let status;
        if (acquisitionSession.state === "acquiring") {
          status = acquisitionSession.getStatus();
        } else {
          const instId = typeof window !== "undefined" ? window.__warmgraphInstanceId : "unknown";
          console.log("[WG_START_CALLER]", {
            instanceId: instId,
            caller: "onMessage:startAutomatedAcquisition",
            url: typeof window !== "undefined" ? window.location.href : "",
            isConnectionsPage: isConnectionsPage(),
            stack: new Error().stack
          });
          status = acquisitionSession.start();
        }
        sendResponse({
          success: true,
          status,
          batch: status
        });
        break;
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
        acquisitionSession.state = "paused";
        acquisitionSession.checkpointSessionSync();
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
        acquisitionSession.scanCurrentPage();
        const res = acquisitionSession.finish();
        acquisitionSession.reset(true);
        sendResponse(res);
        break;
      }
      case "cancelCollection":
      case "cancelAcquisition": {
        acquisitionSession.cancel();
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
// MUTATION OBSERVER
// =========================================================

let scanTimer = null;

const SCAN_DEBOUNCE_MS = 800;


const observer =
  new MutationObserver(
    (mutations) => {

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
  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true
    }
  );
} catch (e) {
  // Ignore observer error in virtual environment
}


// Initial scan so the content store
// is ready when the popup is opened.

setTimeout(
  scanAndMaybeSync,
  1500
);