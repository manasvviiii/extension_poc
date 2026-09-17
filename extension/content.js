console.log("[Warm Graph] LinkedIn extractor loaded");

function extractVisibleLinkedInData() {
  const results = [];

  // Look through links currently rendered on the page.
  const links = document.querySelectorAll("a[href]");

  links.forEach((link) => {
    const href = link.href;

    // Only consider LinkedIn profile URLs.
    if (!href.includes("linkedin.com/in/")) {
      return;
    }

    const name = link.innerText.trim();

    if (!name) {
      return;
    }

    // Avoid duplicate profiles.
    const alreadyExists = results.some(
      (item) => item.profile_url === href
    );

    if (alreadyExists) {
      return;
    }

    // Try to find nearby visible text for additional information.
    const parentText =
      link.parentElement?.innerText?.trim() || "";

    results.push({
      name: name,
      profile_url: href.split("?")[0],
      visible_context: parentText
    });
  });

  return results;
}

function getPageInfo() {
  return {
    url: window.location.href,
    title: document.title,
    extracted_at: new Date().toISOString()
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "extractLinkedIn") {
    const data = extractVisibleLinkedInData();

    console.log("[Warm Graph] Extracted:", data);

    sendResponse({
      success: true,
      page: getPageInfo(),
      count: data.length,
      connections: data
    });
  }

  return true;
});