const connectionStore = new Map();
const relationshipEvidenceStore = new Map();


// =========================================================
// OWNER IDENTITY
// =========================================================

const BACKEND_BASE_URL = "http://127.0.0.1:8000";

let cachedOwnerId = null;

function createStableOwnerId() {
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `warmgraph_${id}`;
}

function getOwnerId() {
  if (cachedOwnerId) {
    return Promise.resolve(cachedOwnerId);
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(["ownerId"], (result) => {
      if (result.ownerId) {
        cachedOwnerId = result.ownerId;
        resolve(cachedOwnerId);
        return;
      }

      cachedOwnerId = createStableOwnerId();

      chrome.storage.local.set({
        ownerId: cachedOwnerId
      });

      resolve(cachedOwnerId);
    });
  });
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

    return `${url.origin}${url.pathname}`.replace(
      /\/$/,
      ""
    );

  } catch {
    return null;
  }
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


function getCardLines(card) {
  return (card.innerText || "")
    .split("\n")
    .map(cleanText)
    .filter(Boolean);
}


function getSemanticText(root, patterns) {
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

  return {
    name: profileAnchor.name,
    profile_url: profileAnchor.profile_url,
    degree: "1st",
    connection_date: connectionDate,
    headline,
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


  return {

    name:
      profileAnchor.name,

    profile_url:
      profileAnchor.profile_url,

    observed_degree:
      observedDegree,

    headline,

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

function mergeRecord(
  previous,
  current
) {

  const merged = {
    ...previous
  };


  for (
    const [key, value]
    of Object.entries(current)
  ) {

    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      merged[key] = value;
    }
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


// =========================================================
// AUTOMATED CONNECTION ACQUISITION SESSION
// =========================================================

class ConnectionAcquisitionSession {
  constructor() {
    this.sessionId = `warmgraph_session_${Date.now()}`;
    this.connections = new Map();
    this.relationshipEvidence = new Map();
    this.reset(false);
  }

  reset(clearStores = false) {
    this.state = "idle";
    if (clearStores) {
      this.sessionId = `warmgraph_session_${Date.now()}`;
      this.connections = new Map();
      this.relationshipEvidence = new Map();
    }
    if (!this.connections) {
      this.connections = new Map();
    }
    if (!this.relationshipEvidence) {
      this.relationshipEvidence = new Map();
    }
    this.pageCount = 0;
    this.expectedTotal = 0;
    this.isPartial = false;
    this.statusMessage = "";
    this.syncStatus = "idle";
    this.syncMessage = "";
    this.lastBatchNewConnections = 0;
    this.lastBatchNewEvidence = 0;
    this.activeLoopPromise = null;
    this.shouldCancel = false;
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

  scanCurrentPage() {
    const sizeBefore = this.connections.size;
    let newConnections = 0;
    let newEvidence = 0;
    let extractedRecordsCount = 0;

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
        extractedRecordsCount++;
        const key = this.getDeduplicationKey(firstDegree);
        const existing = this.connections.get(key);
        this.connections.set(key, mergeRecord(existing || {}, firstDegree));
        if (!existing) newConnections++;
        continue;
      }

      const evidence = extractRelationshipEvidence(card, profileAnchor);
      if (evidence) {
        const key = `${this.getDeduplicationKey(evidence)}|${evidence.observed_degree}`;
        const existing = this.relationshipEvidence.get(key);
        this.relationshipEvidence.set(key, mergeRecord(existing || {}, evidence));
        if (!existing) newEvidence++;
      }
    }

    const sizeAfter = this.connections.size;
    const resetDetected = sizeAfter < sizeBefore;

    this.lastBatchNewConnections = newConnections;
    this.lastBatchNewEvidence = newEvidence;

    if (!this.lastTelemetry) {
      this.lastTelemetry = {};
    }

    const inspectedCount = processedCardRoots.size;
    this.lastTelemetry.session_id = this.sessionId;
    this.lastTelemetry.extraction_entered = true;
    this.lastTelemetry.collection_size_before = sizeBefore;
    this.lastTelemetry.dom_profile_links = domCards.length;
    this.lastTelemetry.dom_card_count = domCards.length;
    this.lastTelemetry.containers_inspected = inspectedCount;
    this.lastTelemetry.extracted_records = extractedRecordsCount;
    this.lastTelemetry.records_extracted_this_scan = extractedRecordsCount;
    this.lastTelemetry.failed_extraction = Math.max(0, inspectedCount - extractedRecordsCount);
    this.lastTelemetry.previously_known = sizeBefore;
    this.lastTelemetry.new_unique = newConnections;
    this.lastTelemetry.new_unique_this_scan = newConnections;
    this.lastTelemetry.collection_size_after = sizeAfter;
    this.lastTelemetry.collected_total = sizeAfter;
    this.lastTelemetry.collection_reset_detected = resetDetected ? "YES" : "NO";
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

    // 1. Traversal up from loader sentinel
    if (loaderEl) {
      let current = loaderEl.parentElement;
      while (current && current !== document.body && current !== document.documentElement) {
        const res = checkScrollable(current);
        if (res) return res;
        current = current.parentElement;
      }
    }

    // 2. Traversal up from first connection card anchor
    const firstCardAnchor = document.querySelector ? document.querySelector('a[href*="/in/"]') : null;
    if (firstCardAnchor) {
      let current = firstCardAnchor.parentElement;
      while (current && current !== document.body && current !== document.documentElement) {
        const res = checkScrollable(current);
        if (res) return res;
        current = current.parentElement;
      }
    }

    // 3. Check explicit container selectors
    const explicitContainers = document.querySelectorAll
      ? document.querySelectorAll('.scaffold-finite-scroll, .scaffold-layout__main, .mn-connections-list, main, section')
      : [];
    for (const el of explicitContainers) {
      const res = checkScrollable(el);
      if (res) return res;
    }

    return null;
  }

  triggerContainerLoad(attemptNumber = 1) {
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
        const targetScrollTop = Math.min(maxScrollTop, scrollTopBefore + 600);
        container.scrollTop = targetScrollTop;
        telemetry.scroll_top_after = container.scrollTop || 0;
        telemetry.trigger_method = "container_scrollTop_nudge";

        // If at or near bottom, perform scroll transition and bring last rendered item or loader sentinel into view
        const isNearBottom = maxScrollTop - scrollTopBefore < 100 || container.scrollTop >= maxScrollTop - 10;

        if (isNearBottom) {
          // Target sentinel: loader element OR last rendered card root / bottom item in connection list
          const profileAnchors = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]') : [];
          const lastProfileAnchor = profileAnchors.length > 0 ? profileAnchors[profileAnchors.length - 1] : null;
          const lastCard = lastProfileAnchor ? getCardRoot(lastProfileAnchor) : null;
          const sentinel = loader || lastCard || (container.querySelector ? container.querySelector('.scaffold-finite-scroll__content > *:last-child, ul > *:last-child, li:last-child') : null);

          if (sentinel && typeof sentinel.scrollIntoView === "function") {
            try {
              sentinel.scrollIntoView({ block: "end", behavior: "auto" });
              telemetry.trigger_method = loader ? "loader_scrollIntoView" : "last_card_scrollIntoView";
            } catch (e) {}
          }

          // Micro scroll delta (step up by 80px then to maxScrollTop) to force layout / IntersectionObserver recalculation
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
      } catch (e) {}

      telemetry.bottom_telemetry = inspectBottomTelemetry(container, loader, preCardCount, preCardCount, scrollHeight, scrollHeight, null);

      return { success: true, telemetry, container };
    }

    // Fallback: window / document scrolling element
    telemetry.scroll_container_description = "window (document.documentElement)";
    const scroller = (document.scrollingElement || document.documentElement || document.body);
    const initialScrollY = typeof window !== "undefined" ? (window.scrollY || window.pageYOffset || (scroller ? scroller.scrollTop : 0)) : 0;
    const docScrollHeight = scroller ? scroller.scrollHeight : (document.documentElement ? document.documentElement.scrollHeight : 0);
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : (scroller ? scroller.clientHeight : 0);

    telemetry.scroll_top_before = initialScrollY;
    telemetry.scroll_height = docScrollHeight;
    telemetry.client_height = viewportHeight;

    try {
      if (typeof window !== "undefined") {
        window.scrollBy(0, 600);
      }
      if (scroller) {
        scroller.scrollTop = (scroller.scrollTop || 0) + 600;
      }
      const newScrollY = typeof window !== "undefined" ? (window.scrollY || window.pageYOffset || (scroller ? scroller.scrollTop : 0)) : 0;
      telemetry.scroll_top_after = newScrollY;
      telemetry.trigger_method = "window_scrollBy";

      const fallbackAnchors = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]') : [];
      const lastProfileAnchor = fallbackAnchors.length > 0 ? fallbackAnchors[fallbackAnchors.length - 1] : null;
      const lastCard = lastProfileAnchor ? getCardRoot(lastProfileAnchor) : null;
      const sentinel = loader || lastCard;
      if (sentinel && typeof sentinel.scrollIntoView === "function") {
        try { sentinel.scrollIntoView({ block: "end", behavior: "auto" }); } catch (e) {}
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("scroll", { bubbles: true }));
        window.dispatchEvent(new Event("resize", { bubbles: true }));
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

    const checkTempLoading = () => {
      if (!document || !document.querySelector) return null;
      const selectors = [
        '[aria-busy="true"]',
        '[class*="spinner"]',
        '[class*="loader"]',
        '[class*="loading"]',
        '[class*="skeleton"]',
        '[class*="finite-scroll"]',
        '[data-loading]'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const tag = el.tagName ? el.tagName.toLowerCase() : "";
          const cls = el.className ? `.${el.className.toString().trim().split(/\s+/).join('.')}` : "";
          return `${tag}${cls}`.slice(0, 60);
        }
      }
      return null;
    };

    const initialTemp = checkTempLoading();
    if (initialTemp) tempLoadingDetected = initialTemp;

    let subObserver = null;
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
          const curLoading = checkTempLoading();
          if (curLoading) tempLoadingDetected = curLoading;
        });
        subObserver.observe(targetContainer, { childList: true, subtree: true, attributes: true });
      }
    } catch (e) {}

    let mutationObserved = false;
    let newCards = 0;

    while (Date.now() - startTime < timeoutMs) {
      const currentCards = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;
      const curLoading = checkTempLoading();
      if (curLoading) tempLoadingDetected = curLoading;

      if (currentCards > previousCardCount) {
        mutationObserved = true;
        newCards = currentCards - previousCardCount;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 80));
    }

    if (subObserver) {
      try { subObserver.disconnect(); } catch (e) {}
    }

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

  async autoSyncToBackend() {
    // STRICT GUARD: Sync ONLY when state is completed and dataset is NOT partial
    if (this.state !== "completed" || this.isPartial) {
      this.syncStatus = "blocked";
      this.syncMessage = "Backend sync blocked: Partial or incomplete datasets are never synced automatically.";
      return;
    }

    this.syncStatus = "syncing";
    this.syncMessage = "Automatically syncing verified complete dataset to backend...";

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
          this.syncStatus = "synced";
          this.syncMessage = "Backend sync completed successfully.";
        } else {
          const errData = await res.json().catch(() => ({}));
          this.syncStatus = "failed";
          this.syncMessage = errData.detail || "Backend import failed.";
        }
      }
    } catch (err) {
      this.syncStatus = "failed";
      this.syncMessage = err.message;
    }
  }

  async runAcquisitionLoop() {
    this.pageCount = 0;
    this.shouldCancel = false;
    this.state = "acquiring";

    let noNewRecordsAttempts = 0;
    const MAX_NO_NEW_ATTEMPTS = 8;
    let containerRedetected = false;

    while (!this.shouldCancel) {
      this.pageCount++;
      const previousCollected = this.connections.size;
      const initialDomCardCount = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;

      // Scan current page DOM cards
      this.scanCurrentPage();

      // Parse expected total count from DOM
      const domTotal = extractTotalConnectionsFromDom();
      if (domTotal && domTotal > 0) {
        this.expectedTotal = domTotal;
      }

      const currentCount = this.connections.size;
      const expectedText = this.expectedTotal ? ` of ${this.expectedTotal}` : '';
      this.statusMessage = `Acquiring connections (${currentCount}${expectedText})...`;

      if (currentCount > previousCollected) {
        noNewRecordsAttempts = 0;
        containerRedetected = false;
      } else {
        noNewRecordsAttempts++;
      }

      // If explicit expectedTotal is set and we've reached or exceeded it
      if (this.expectedTotal > 0 && currentCount >= this.expectedTotal) {
        this.state = "completed";
        this.completionStatus = "complete";
        this.isPartial = false;
        this.statusMessage = `Acquisition completed: ${currentCount} connections collected across ${this.pageCount} pages/batches.`;
        await this.autoSyncToBackend();
        break;
      }

      // Check for container re-detection if no-progress attempts occur
      if (noNewRecordsAttempts === 4 && !containerRedetected) {
        containerRedetected = true;
      }

      // Trigger container load / pagination
      const loadRes = this.triggerContainerLoad(this.pageCount);
      const preScrollHeight = loadRes.telemetry ? loadRes.telemetry.scroll_height : 0;

      // Wait for DOM changes / card appends (Wait up to 2000ms for network & DOM rendering)
      const waitRes = await this.waitForDomCardsToIncrease(initialDomCardCount, 2000, loadRes.container);

      if (waitRes && (waitRes.mutationObserved || waitRes.newCards > 0)) {
        noNewRecordsAttempts = 0;
        containerRedetected = false;
      }

      if (this.lastTelemetry) {
        this.lastTelemetry.mutation_observed = waitRes.mutationObserved;
        this.lastTelemetry.new_cards = waitRes.newCards;
        if (this.lastTelemetry.bottom_telemetry) {
          const finalCards = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;
          const targetCont = loadRes.container || (document.querySelector ? document.querySelector('main#workspace') : null);
          const postScrollHeight = targetCont ? targetCont.scrollHeight : preScrollHeight;
          const loader = document.querySelector ? document.querySelector('.scaffold-finite-scroll__loader, #infiniteLoader, [class*="loader"]') : null;

          this.lastTelemetry.bottom_telemetry = inspectBottomTelemetry(
            targetCont,
            loader,
            initialDomCardCount,
            finalCards,
            preScrollHeight,
            postScrollHeight,
            waitRes
          );
        }
      }

      if (!loadRes.success || noNewRecordsAttempts >= MAX_NO_NEW_ATTEMPTS) {
        // Bounded settling phase: If expectedTotal is not reached, check if DOM rendering or network load is still settling
        const currentCountCheck = this.connections.size;
        if (this.expectedTotal > 0 && currentCountCheck < this.expectedTotal && !this.shouldCancel) {
          const maxSettlingPasses = 5;
          let progressResumed = false;

          for (let pass = 1; pass <= maxSettlingPasses && !this.shouldCancel; pass++) {
            const container = loadRes.container || (document.querySelector ? document.querySelector('main#workspace') : null);
            const initialLinks = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;
            const initialHeight = container ? container.scrollHeight : 0;
            const initialCollected = this.connections.size;

            if (this.lastTelemetry) {
              this.lastTelemetry.settling_phase_active = `YES (pass ${pass}/${maxSettlingPasses})`;
              this.lastTelemetry.settling_progress_detected = "Monitoring rendering pass...";
            }

            this.statusMessage = `Waiting for page rendering to settle (Pass ${pass}/${maxSettlingPasses} - ${initialCollected}/${this.expectedTotal})...`;

            // Actively trigger container scroll loading during settling pass to fire micro-nudge & last card scrollIntoView
            this.triggerContainerLoad(this.pageCount);

            await new Promise(resolve => setTimeout(resolve, 1200));

            this.scanCurrentPage();
            const newCount = this.connections.size;
            const currentLinks = document.querySelectorAll ? document.querySelectorAll('a[href*="/in/"]').length : 0;
            const currentHeight = container ? container.scrollHeight : initialHeight;

            if (newCount > initialCollected || currentLinks > initialLinks || currentHeight > initialHeight + 10) {
              progressResumed = true;
              noNewRecordsAttempts = 0;
              if (this.lastTelemetry) {
                this.lastTelemetry.settling_phase_active = "NO (Progress Resumed)";
                this.lastTelemetry.settling_progress_detected = `YES (+${newCount - initialCollected} records, +${currentLinks - initialLinks} links)`;
              }
              break;
            }
          }

          if (progressResumed) {
            // Settling phase caught new DOM items or rendering progress! Continue acquisition loop!
            continue;
          }
        }

        const finalCount = this.connections.size;
        const hasLoader = !!document.querySelector('.scaffold-finite-scroll__loader, #infiniteLoader, [class*="loader"]');
        const failedExtractionCount = (this.lastTelemetry && this.lastTelemetry.failed_extraction) || 0;

        // ACCEPTED-RENDERED-DATASET condition:
        // finalCount === expectedTotal - 1 AND end of rendered list reached AND no loader AND 0 failed extractions
        const isRenderedComplete = (
          this.expectedTotal > 0 &&
          finalCount === (this.expectedTotal - 1) &&
          !hasLoader &&
          failedExtractionCount === 0
        );

        if (this.expectedTotal > 0 && finalCount >= this.expectedTotal) {
          this.state = "completed";
          this.completionStatus = "complete";
          this.isPartial = false;
          this.statusMessage = `All available connections collected (${finalCount} connections).`;
          await this.autoSyncToBackend();
        } else if (isRenderedComplete) {
          this.state = "completed";
          this.completionStatus = "complete_rendered_dataset";
          this.isPartial = false;
          this.statusMessage = `All available connections extracted (${finalCount} connections).`;
          await this.autoSyncToBackend();
        } else {
          this.state = "incomplete";
          this.completionStatus = "incomplete";
          this.isPartial = true;
          this.statusMessage = `Partial acquisition (Incomplete): ${finalCount} / ${this.expectedTotal} connections collected.`;
          this.syncStatus = "blocked";
          this.syncMessage = "Backend sync blocked: Incomplete dataset.";
        }
        break;
      }
    }

    if (this.shouldCancel) {
      this.state = "idle";
      this.statusMessage = "Acquisition cancelled.";
    }
  }

  start() {
    if (this.state === "acquiring") {
      return this.getStatus();
    }
    this.reset(false);
    this.activeLoopPromise = this.runAcquisitionLoop();
    return this.getStatus();
  }

  cancel() {
    this.shouldCancel = true;
    this.state = "idle";
    return { success: true };
  }

  getStatus() {
    const collected = this.connections.size;
    const expected = this.expectedTotal || Math.max(collected, 1);
    const remaining = Math.max(0, expected - collected);

    return {
      state: this.state,
      completion_status: this.completionStatus || (this.state === "completed" ? (collected >= expected ? "complete" : "complete_rendered_dataset") : "incomplete"),
      page_count: this.pageCount,
      expected_total: expected,
      collected_count: collected,
      remaining_count: remaining,
      first_degree_count: collected,
      relationship_evidence_count: this.relationshipEvidence.size,
      last_batch_new_connections: this.lastBatchNewConnections,
      last_batch_new_evidence: this.lastBatchNewEvidence,
      is_partial: this.isPartial,
      status_message: this.statusMessage,
      sync_status: this.syncStatus,
      sync_message: this.syncMessage,
      telemetry: this.lastTelemetry || null,
      container_diagnostics: inspectLiveScrollContainers(),
      connections: Array.from(this.connections.values()),
      relationship_evidence: Array.from(this.relationshipEvidence.values()),
      reliable_dom_total: expected
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

function extractTotalConnectionsFromDom() {
  try {
    // 1. Search targeted headers and metadata summary elements
    const elements = document.querySelectorAll
      ? document.querySelectorAll('h1, h2, h3, header, main, [class*="connections"], [class*="count"], [data-test-connections-count]')
      : [];

    for (const el of elements) {
      const text = (el.innerText || el.textContent || "").trim();
      const match = text.match(/Connections?\s*\(\s*([\d,.]+)\s*\)/i) ||
                    text.match(/\b([\d,.]+)\s+connections?\b/i);
      if (match) {
        const num = parseInt(match[1].replace(/,/g, ""), 10);
        if (!isNaN(num) && num > 0) {
          return num;
        }
      }
    }

    // 2. Full document body text fallback
    const text = document.body ? (document.body.innerText || document.body.textContent || "") : "";
    const match = text.match(/Connections?\s*\(\s*([\d,.]+)\s*\)/i) ||
                  text.match(/\b([\d,.]+)\s+connections?\b/i);
    if (match) {
      const num = parseInt(match[1].replace(/,/g, ""), 10);
      if (!isNaN(num) && num > 0) {
        return num;
      }
    }
  } catch (e) {
    // ignore DOM parsing errors
  }
  return null;
}

function maybeAutoStartAcquisition() {
  const pageType = getPageType();
  const url = window.location.href || "";
  if (
    pageType === "linkedin_network" ||
    url.includes("/mynetwork/invite-connect/connections/") ||
    url.includes("connections.html")
  ) {
    if (acquisitionSession.state === "idle") {
      acquisitionSession.start();
    }
  }
}

setTimeout(maybeAutoStartAcquisition, 100);

window.addEventListener("beforeunload", () => {
  acquisitionSession.cancel();
});


// =========================================================
// POPUP MESSAGE HANDLER
// =========================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    switch (message.action) {
      case "startAutomatedAcquisition":
      case "startCollection": {
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
      case "pauseCollection": {
        // Pausing is mapped to getting current status
        sendResponse({
          success: true,
          status: acquisitionSession.getStatus()
        });
        break;
      }
      case "resumeCollection": {
        const status = acquisitionSession.getStatus();
        sendResponse({
          success: true,
          status,
          batch: status
        });
        break;
      }
      case "finishCollection":
      case "finishAcquisition": {
        const res = acquisitionSession.finish();
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
        sendResponse({
          success: true,
          status: acquisitionSession.getStatus()
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
            sync_message: acquisitionSession.syncMessage
          });
        }).catch(err => {
          sendResponse({
            success: false,
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