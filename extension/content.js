console.log("[Warm Graph] LinkedIn extractor loaded");

function cleanUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

function extractLinkedInConnections() {
  const results = [];
  const seen = new Set();

  // Find profile links currently rendered on the LinkedIn page
  const profileLinks = document.querySelectorAll(
    'a[href*="/in/"]'
  );

  profileLinks.forEach((link) => {
    const profileUrl = cleanUrl(link.href);

    if (!profileUrl || seen.has(profileUrl)) {
      return;
    }

    const name = link.innerText.trim();

    if (!name) {
      return;
    }

    // Move upward to find the connection card
    let card = link;

    for (let i = 0; i < 8; i++) {
      if (!card.parentElement) break;

      card = card.parentElement;

      const text = card.innerText?.trim() || "";

      // LinkedIn connection cards contain "Connected on"
      if (text.includes("Connected on")) {
        break;
      }
    }

    const visibleText = card.innerText?.trim() || "";

    // Only keep actual connection cards
    if (!visibleText.includes("Connected on")) {
      return;
    }

    results.push({
      name: name,
      profile_url: profileUrl,
      visible_text: visibleText,
      source: "linkedin_dom"
    });

    seen.add(profileUrl);
  });

  return results;
}

function getPageInfo() {
  const path = window.location.pathname;

  return {
    url: window.location.href,
    title: document.title,

    page_type: path.includes(
      "/mynetwork/invite-connect/connections"
    )
      ? "connections"
      : "linkedin_page",

    extracted_at: new Date().toISOString()
  };
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {

    if (message.action !== "extractLinkedIn") {
      return;
    }

    try {
      const connections = extractLinkedInConnections();

      console.log(
        "[Warm Graph] Found:",
        connections.length
      );

      console.log(
        "[Warm Graph] Data:",
        connections
      );

      sendResponse({
        success: true,
        page: getPageInfo(),
        count: connections.length,
        connections: connections
      });

    } catch (error) {

      console.error(
        "[Warm Graph] Extraction error:",
        error
      );

      sendResponse({
        success: false,
        error: error.message,
        count: 0,
        connections: []
      });
    }

    return true;
  }
);