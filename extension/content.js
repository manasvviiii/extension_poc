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

const ACQUISITION_MIN_DELAY_MS = 8000;
const ACQUISITION_MAX_DELAY_MS = 30000;

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
            this.actualProfiles = canonical.totalConnections;
          } else if (session) {
            const t = session.totalConnections || session.expectedTotal || 0;
            if (t > 0) {
              this.totalConnections = t;
              this.expectedTotal = t;
              this.actualProfiles = t;
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
    const loader = document.querySelector ? document.querySelector('.scaffold-finite-scroll__loader, #infiniteLoader, [class*="loader"], [class*="next"], [id*="next"], button[aria-label*="Next"]') : null;

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

    // Task 8.9.3: Human-like scroll distance (120–180px, default/avg 150px)
    const scrollDistance = Math.floor(Math.random() * (180 - 120 + 1)) + 120;
    // Task 8.9.3: Inter-scroll delay (280–520ms)
    const scrollDelayMs = Math.floor(Math.random() * (520 - 280 + 1)) + 280;

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

        // Micro pause: Every 8–12 scrolls, pause for 900–1500ms
        this.humanScrollCount = (this.humanScrollCount || 0) + 1;
        if (!this.nextMicroPauseThreshold) {
          this.nextMicroPauseThreshold = Math.floor(Math.random() * (12 - 8 + 1)) + 8;
        }

        if (this.humanScrollCount >= this.nextMicroPauseThreshold) {
          this.humanScrollCount = 0;
          this.nextMicroPauseThreshold = Math.floor(Math.random() * (12 - 8 + 1)) + 8;
          const microPauseMs = Math.floor(Math.random() * (1500 - 900 + 1)) + 900;
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

      // Micro pause: Every 8–12 scrolls, pause for 900–1500ms
      this.humanScrollCount = (this.humanScrollCount || 0) + 1;
      if (!this.nextMicroPauseThreshold) {
        this.nextMicroPauseThreshold = Math.floor(Math.random() * (12 - 8 + 1)) + 8;
      }

      if (this.humanScrollCount >= this.nextMicroPauseThreshold) {
        this.humanScrollCount = 0;
        this.nextMicroPauseThreshold = Math.floor(Math.random() * (12 - 8 + 1)) + 8;
        const microPauseMs = Math.floor(Math.random() * (1500 - 900 + 1)) + 900;
        await new Promise((r) => setTimeout(r, microPauseMs));
      }

    } catch (e) {}

    telemetry.bottom_telemetry = inspectBottomTelemetry(scroller, loader, preCardCount, preCardCount, docScrollHeight, docScrollHeight, null);

    return { success: true, telemetry, container: scroller };
  }

  async waitForDomCardsToIncrease(previousCardCount, timeoutMs = 2500, container = null) {
    const startTime = Date.now();
    const observedAddedNodes = [];
    let mutationRecordCount = 0;
    let tempLoadingDetected = null;

    const targetContainer = container || (document.querySelector ? document.querySelector('main#workspace, main, section') : null) || (document.body || document.documentElement);

    let subObserver = null;
    let mutationObserved = false;
    let newCards = 0;

    await new Promise((resolve) => {
      let resolved = false;

      const finishWait = (hasMutation = false, cardDiff = 0) => {
        if (resolved) return;
        resolved = true;
        if (subObserver) {
          try { subObserver.disconnect(); } catch (e) {}
        }
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
        }
      } catch (e) {}

      if (typeof setInterval === "function") {
        const interval = setInterval(() => {
          const currentCards = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;
          if (currentCards > previousCardCount) {
            clearInterval(interval);
            finishWait(true, currentCards - previousCardCount);
          } else if (Date.now() - startTime >= timeoutMs) {
            clearInterval(interval);
            finishWait(false, 0);
          }
        }, 50);
      } else {
        const poll = () => {
          const currentCards = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;
          if (currentCards > previousCardCount) {
            finishWait(true, currentCards - previousCardCount);
          } else if (Date.now() - startTime >= timeoutMs) {
            finishWait(false, 0);
          } else if (typeof setTimeout === "function") {
            setTimeout(poll, 50);
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
        const res = await fetch(`${BACKEND_BASE_URL}/network/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            expected_total: this.expectedTotal,
            collected_total: this.connections.size,
            completion_status: this.completionStatus || (this.state === "completed" ? "complete" : "incomplete")
          })
        });

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
    if (typeof window !== "undefined") {
      window.__warmgraphAcquisitionRunning = true;
    }
    this.isRunning = true;
    this.pageCount = 0;
    this.shouldCancel = false;
    let consecutiveZeroNewCardScrolls = 0;
    const MAX_ZERO_NEW_CARD_SCROLLS = 4;

    if (!this.seenProfiles) this.seenProfiles = new Set();
    this.connections.forEach((c) => {
      const key = this.getDeduplicationKey(c);
      if (key) this.seenProfiles.add(key);
    });

    // ── SSOT: Freeze totalConnections and actualProfiles ONCE per session ────
    // Only read the LinkedIn header on the very first batch (or if never set).
    // Subsequent batches must NOT re-parse from DOM to prevent Feed/Home/Search
    // numbers (e.g. 5574 impressions) from overwriting the frozen header total.
    if (!this.totalConnections || this.totalConnections === 0) {
      const domTotal = extractTotalConnectionsFromDom();
      if (domTotal && domTotal > 0) {
        this.totalConnections = domTotal;
        this.expectedTotal = domTotal;
        // actualProfiles = linkedIn header - 1 (exclude the account owner)
        this.actualProfiles = domTotal > 1 ? domTotal - 1 : domTotal;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    while (!this.shouldCancel) {
      if (!isConnectionsPage()) {
        this.state = "paused";
        this.statusMessage = "Return to Connections to continue syncing.";
        if (this.nextBatchAt && this.nextBatchAt > Date.now()) {
          this.pausedRemainingMs = this.nextBatchAt - Date.now();
        }
        await this.checkpointSession();
        break;
      }

      this.pageCount++;

      // STEP 1: Begin Batch -> Overlay changes to "Building"
      this.state = "acquiring";
      this.activeFilter = extractActiveFilterFromDom();
      const initialCount = this.connections.size;
      const expectedText = this.expectedTotal ? ` of ${this.expectedTotal}` : '';
      this.statusMessage = `Building your relationship graph (${initialCount}${expectedText})...`;
      await this.checkpointSession();

      let batchNewProfilesCount = 0;
      let batchDuplicatesSkipped = 0;
      let batchVisibleCardsCount = 0;

      // STEP 2 & 3 & 4: Smart Scrolling & DOM Mutation Detection Loop
      let scrollAttemptsInBatch = 0;
      const MAX_SCROLL_ATTEMPTS_PER_BATCH = 6;

      while (!this.shouldCancel) {
        if (!isConnectionsPage()) {
          this.state = "paused";
          this.statusMessage = "Return to Connections to continue syncing.";
          if (this.nextBatchAt && this.nextBatchAt > Date.now()) {
            this.pausedRemainingMs = this.nextBatchAt - Date.now();
          }
          await this.checkpointSession();
          return;
        }

        scrollAttemptsInBatch++;
        const initialDomCardCount = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;

        // Perform smart scroll (human cadence)
        const loadRes = await this.triggerContainerLoad(this.pageCount);

        // Wait for DOM mutation (MutationObserver driven)
        const waitRes = await this.waitForDomCardsToIncrease(initialDomCardCount, 1500, loadRes.container);

        // Scan page for new unseen cards
        const scanRes = this.scanCurrentPageForUnseen();
        batchNewProfilesCount += scanRes.newProfilesCount;
        batchDuplicatesSkipped += scanRes.duplicatesSkippedCount;
        batchVisibleCardsCount = scanRes.totalVisibleCards;

        // NOTE: Do NOT re-parse DOM total here. totalConnections is frozen once
        // at session start to prevent Feed/Home DOM numbers from corrupting it.

        // If new profiles discovered: break out of scroll loop to complete batch!
        if (scanRes.newProfilesCount > 0) {
          consecutiveZeroNewCardScrolls = 0;
          break;
        }

        // Duplicate-only batch (0 new profiles): continue scrolling until new cards found
        consecutiveZeroNewCardScrolls++;

        const hasLoader = !!(typeof document !== "undefined" && typeof document.querySelector === "function" ? document.querySelector('.scaffold-finite-scroll__loader, #infiniteLoader, [class*="loader"]') : null);

        // Structured console debug log for duplicate-only batch
        console.log(`[Batch ${this.pageCount}]\nVisible cards: ${batchVisibleCardsCount}\nNew profiles: 0\n\nScrolling for additional cards...`);

        if (consecutiveZeroNewCardScrolls >= MAX_ZERO_NEW_CARD_SCROLLS && !hasLoader) {
          break;
        }

        if (scrollAttemptsInBatch >= MAX_SCROLL_ATTEMPTS_PER_BATCH) {
          break;
        }
      }

      // STEP 5: Increment extractedConnections, persist session, update overlay immediately
      const currentCount = this.connections.size;
      const nextDelayMs = getRandomAcquisitionDelayMs();
      const nextDelaySec = Math.round(nextDelayMs / 1000);

      // Calculate estimated remaining time (Section 8 formula)
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
      const remainingProfiles = Math.max(0, (this.actualProfiles || this.expectedTotal || 0) - currentCount);
      const avgNewPerBatch = Math.max(1, batchNewProfilesCount || 8);
      const remainingBatches = Math.ceil(remainingProfiles / avgNewPerBatch);
      this.estimatedRemainingMs = remainingBatches * (avgBatchMs + nextDelayMs);

      // Structured console debug log for batch completion
      console.log(`[Batch ${this.pageCount}]\nVisible cards: ${batchVisibleCardsCount}\nNew profiles: ${batchNewProfilesCount}\nDuplicates skipped: ${batchDuplicatesSkipped}\n\nExtracted total: ${currentCount}/${this.expectedTotal || currentCount}\n\nNext delay: ${nextDelaySec}s`);

      // Persist session immediately after successful batch
      await this.checkpointSession();

      // Check completion conditions
      const hasLoader = !!(typeof document !== "undefined" && typeof document.querySelector === "function" ? document.querySelector('.scaffold-finite-scroll__loader, #infiniteLoader, [class*="loader"]') : null);

      const targetActual = this.actualProfiles || this.expectedTotal;
      if ((targetActual > 0 && currentCount >= targetActual) || (consecutiveZeroNewCardScrolls >= MAX_ZERO_NEW_CARD_SCROLLS && !hasLoader)) {
        this.state = "resting";
        this.completionStatus = "complete";
        this.syncStatus = "synced";
        this.isPartial = false;
        this.statusMessage = "You're all caught up ✨";
        this.nextBatchAt = null;
        this.nextSyncDelay = 0;
        this.countdownSeconds = 0;
        this.pausedRemainingMs = null;
        this.estimatedRemainingMs = null;
        await this.checkpointSession();
        await this.autoSyncToBackend();
        break;
      }

      // STEP 6: Return overlay to "Waiting" with fresh random delay (8-30s)
      this.nextSyncDelay = nextDelayMs;
      this.nextBatchAt = Date.now() + nextDelayMs;
      this.nextSyncAt = new Date(this.nextBatchAt).toISOString();
      this.state = "waiting";
      this.statusMessage = `Next batch in ${nextDelaySec}s`;
      await this.checkpointSession();

      // Inter-batch delay driven by nextBatchAt & background alarm
      await this.waitForNextBatch(this.nextBatchAt);
      this.countdownSeconds = 0;
    }

    if (this.shouldCancel) {
      this.state = "idle";
      this.statusMessage = "Acquisition cancelled.";
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
    this.state = "idle";
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

async function maybeAutoStartAcquisition() {
  await acquisitionSession.initOrHydrateSession();
  const isConn = isConnectionsPage();

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["currentSession"], (res) => {
      const cs = res && res.currentSession;
      if (cs) {
        console.log({
          running: !!(typeof window !== "undefined" && window.__warmgraphAcquisitionRunning),
          state: cs.state,
          nextBatchAt: cs.nextBatchAt
        });
      }
    });
  }

  if (isConn) {
    const extractedCount = acquisitionSession.connections ? acquisitionSession.connections.size : 0;
    const targetCount = acquisitionSession.actualProfiles || acquisitionSession.expectedTotal || 0;
    if (targetCount > 0 && extractedCount >= targetCount) {
      acquisitionSession.state = "completed";
      acquisitionSession.checkpointSessionSync();
    } else if (!window.__warmgraphAcquisitionRunning) {
      acquisitionSession.start();
    }
  } else {
    // We are on a NON-Connections page (e.g. Feed, Home, Jobs, etc.)
    if (
      acquisitionSession.state === "acquiring" ||
      acquisitionSession.state === "waiting" ||
      acquisitionSession.state === "building" ||
      acquisitionSession.state === "waiting_for_content" ||
      acquisitionSession.state === "settling" ||
      acquisitionSession.state === "interrupted"
    ) {
      acquisitionSession.state = "paused";
      acquisitionSession.statusMessage = "Return to Connections to continue syncing.";
      if (acquisitionSession.nextBatchAt && acquisitionSession.nextBatchAt > Date.now()) {
        acquisitionSession.pausedRemainingMs = acquisitionSession.nextBatchAt - Date.now();
      }
      acquisitionSession.checkpointSessionSync();
    }
  }
}

setTimeout(maybeAutoStartAcquisition, 100);

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