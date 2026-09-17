console.log("[Warm Graph] LinkedIn extractor loaded");


// --------------------------------------------------
// STORAGE
// --------------------------------------------------

const connectionStore = new Map();


// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function cleanUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    return `${parsed.origin}${parsed.pathname}`
      .replace(/\/$/, "");
  } catch {
    return url;
  }
}


// --------------------------------------------------
// EXTRACT CONNECTION CARD
// --------------------------------------------------

function extractCard(link) {
  const profileUrl = cleanUrl(link.href);

  if (!profileUrl) {
    return null;
  }

  const rawName = link.innerText?.trim();

  if (!rawName) {
    return null;
  }

  let card = link;

  // Walk up the DOM to find the connection card
  for (let i = 0; i < 8; i++) {

    if (!card.parentElement) {
      break;
    }

    card = card.parentElement;

    const text =
      card.innerText?.trim() || "";

    if (text.includes("Connected on")) {
      break;
    }
  }

  const visibleText =
    card.innerText?.trim() || "";

  // Only accept actual connection cards
  if (!visibleText.includes("Connected on")) {
    return null;
  }

  const lines = visibleText
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  const connectionIndex =
    lines.findIndex(
      line => line.startsWith("Connected on")
    );

  const name = lines[0];

  const connectionDate =
    connectionIndex >= 0
      ? lines[connectionIndex]
          .replace("Connected on ", "")
      : null;

  const headline =
    connectionIndex > 1
      ? lines
          .slice(1, connectionIndex)
          .join(" | ")
      : null;

  return {
    name: name,
    profile_url: profileUrl,
    headline: headline,
    connection_date: connectionDate,
    visible_text: visibleText,
    source: "linkedin_dom"
  };
}


// --------------------------------------------------
// PROCESS PROFILE LINKS
// --------------------------------------------------

function processLinks(root) {

  let added = 0;

  // If the added node itself is a profile link
  if (
    root.nodeType === Node.ELEMENT_NODE &&
    root.matches?.('a[href*="/in/"]')
  ) {

    const connection =
      extractCard(root);

    if (connection) {

      if (
        !connectionStore.has(
          connection.profile_url
        )
      ) {

        connectionStore.set(
          connection.profile_url,
          connection
        );

        added++;
      }
    }
  }


  // Look for profile links inside the new node
  if (
    root.querySelectorAll
  ) {

    const links =
      root.querySelectorAll(
        'a[href*="/in/"]'
      );

    links.forEach(link => {

      const connection =
        extractCard(link);

      if (!connection) {
        return;
      }

      if (
        !connectionStore.has(
          connection.profile_url
        )
      ) {

        connectionStore.set(
          connection.profile_url,
          connection
        );

        added++;
      }
    });
  }

  return added;
}


// --------------------------------------------------
// INITIAL SCAN
// --------------------------------------------------

function scanCurrentDOM() {

  let added = 0;

  const links =
    document.querySelectorAll(
      'a[href*="/in/"]'
    );

  links.forEach(link => {

    const connection =
      extractCard(link);

    if (!connection) {
      return;
    }

    if (
      !connectionStore.has(
        connection.profile_url
      )
    ) {

      connectionStore.set(
        connection.profile_url,
        connection
      );

      added++;
    }
  });

  if (added > 0) {

    console.log(
      `[Warm Graph] Initial scan added ${added}`
    );

    console.log(
      `[Warm Graph] Total captured: ${connectionStore.size}`
    );
  }

  return added;
}


// --------------------------------------------------
// WATCH FOR NEW DOM CONTENT
// --------------------------------------------------

const observer =
  new MutationObserver(
    mutations => {

      let added = 0;

      mutations.forEach(
        mutation => {

          if (
            mutation.type !== "childList"
          ) {
            return;
          }

          mutation.addedNodes.forEach(
            node => {

              if (
                node.nodeType !==
                Node.ELEMENT_NODE
              ) {
                return;
              }

              added +=
                processLinks(node);
            }
          );
        }
      );

      if (added > 0) {

        console.log(
          `[Warm Graph] Added ${added} new connections`
        );

        console.log(
          `[Warm Graph] Total captured: ${connectionStore.size}`
        );
      }
    }
  );


// Start observing after body exists
if (document.body) {

  observer.observe(
    document.body,
    {
      childList: true,
      subtree: true
    }
  );
}


// Initial page scan
scanCurrentDOM();


// --------------------------------------------------
// POPUP COMMUNICATION
// --------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message,
    sender,
    sendResponse
  ) => {

    // ----------------------------------------------
    // GET CURRENT CAPTURED DATA
    // ----------------------------------------------

    if (
      message.action ===
      "extractLinkedIn"
    ) {

      // Scan once more in case something
      // was rendered without an observer event
      const newlyAdded =
        scanCurrentDOM();

      const connections =
        Array.from(
          connectionStore.values()
        );

      sendResponse({

        success: true,

        page: {
          url:
            window.location.href,

          title:
            document.title,

          page_type:
            window.location.pathname.includes(
              "/mynetwork/invite-connect/connections"
            )
              ? "connections"
              : "linkedin_page",

          extracted_at:
            new Date().toISOString()
        },

        batch_added:
          newlyAdded,

        count:
          connections.length,

        connections:
          connections
      });

      return true;
    }


    // ----------------------------------------------
    // CLEAR DATA
    // ----------------------------------------------

    if (
      message.action ===
      "clearLinkedInData"
    ) {

      connectionStore.clear();

      sendResponse({

        success: true,

        count: 0

      });

      return true;
    }
  }
);