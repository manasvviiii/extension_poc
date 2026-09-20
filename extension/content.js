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

  for (
    const anchor of root.querySelectorAll(
      'a[href*="/in/"]'
    )
  ) {

    const profileUrl =
      normalizeProfileUrl(anchor.href);

    if (!profileUrl) continue;


    const semanticName =
      getSemanticText(anchor, [
        "[data-test-person-name]",
        'span[aria-hidden="true"]'
      ]);


    const anchorLines =
      getCardLines(anchor);

    const anchorText =
      cleanText(anchor.innerText);

    const degreeMatch =
      anchorText.match(
        /\b(1st|2nd|3rd\+)(?!\w)/
      );


    const rootLines =
      getCardLines(root);


    const beforeDegree =
      degreeMatch
        ? anchorText.slice(
            0,
            degreeMatch.index
          )
        : semanticName
          ? semanticName
          : anchorLines.length > 1
            ? anchorLines[0]
            : rootLines[0] ||
              anchorLines[0] ||
              anchorText;


    const name =
      cleanText(
        beforeDegree
      )
        .replace(
          /[•·|,:-]+$/,
          ""
        )
        .trim();


    if (name) {
      return {
        anchor,
        profile_url: profileUrl,
        name
      };
    }
  }

  return null;
}


function getCardRoot(anchor) {

  let current = anchor;

  for (
    let i = 0;
    i < 10 && current;
    i++
  ) {

    const text =
      cleanText(
        current.innerText
      );


    if (
      text.length >= 20 &&
      text.length <= 4000 &&
      (
        /connected on/i.test(text) ||
        /\b(?:1st|2nd|3rd\+)(?!\w)/.test(text)
      )
    ) {
      return current;
    }


    current =
      current.parentElement;
  }

  return (
    anchor.parentElement ||
    anchor
  );
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

  const text =
    cleanText(card.innerText);


  if (
    !/connected on/i.test(text)
  ) {
    return null;
  }


  const lines =
    getCardLines(card);


  const connectedLine =
    lines.find((line) =>
      /connected on/i.test(line)
    );


  const connectionDate =
    connectedLine
      ? cleanText(
          connectedLine.replace(
            /.*connected on\s*/i,
            ""
          )
        )
      : null;


  const headlineCandidates =
    lines.filter((line) =>
      line !== profileAnchor.name &&
      !/connected on/i.test(line) &&
      !/^(message|follow|connect)$/i.test(line)
    );


  const headline =
    headlineCandidates.length > 0
      ? headlineCandidates[0]
      : null;


  return {

    name:
      profileAnchor.name,

    profile_url:
      profileAnchor.profile_url,

    degree:
      "1st",

    connection_date:
      connectionDate,

    headline,

    relationship_type:
      "KNOWS",

    evidence_type:
      "connection_card",

    source:
      "linkedin_dom",

    page_url:
      window.location.href,

    visible_text:
      text
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
// POPUP MESSAGE HANDLER
// =========================================================

chrome.runtime.onMessage.addListener(
  (
    message,
    sender,
    sendResponse
  ) => {

    if (
      message.action !==
      "extractLinkedIn"
    ) {
      return;
    }


    try {

      const result =
        scanAndMaybeSync();


      sendResponse({

        success:
          true,

        page_type:
          getPageType(),

        page_url:
          window.location.href,

        first_degree_count:
          connectionStore.size,

        relationship_evidence_count:
          relationshipEvidenceStore.size,

        batch_added:
          result.first_degree_added,

        relationship_evidence_added:
          result.relationship_evidence_added,

        connections:
          Array.from(
            connectionStore.values()
          ),

        relationship_evidence:
          Array.from(
            relationshipEvidenceStore.values()
          )

      });

    } catch (error) {

      sendResponse({
        success:
          false,

        error:
          error.message
      });

    }


    return true;
  }
);


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


observer.observe(
  document.documentElement,
  {
    childList: true,
    subtree: true
  }
);


// Initial scan so the content store
// is ready when the popup is opened.

setTimeout(
  scanAndMaybeSync,
  1500
);