function extractConnections() {
  const cards = [...document.querySelectorAll(".connection")];

  return cards
    .map(card => ({
      name: card.querySelector(".name")?.textContent?.trim() || "",
      profile_url: card.dataset.profileUrl || "",
      company: card.querySelector(".company")?.textContent?.trim() || "",
      position: card.querySelector(".position")?.textContent?.trim() || ""
    }))
    .filter(connection =>
      connection.name && connection.profile_url
    );
}

const connections = extractConnections();

chrome.storage.local.set({
  extractedNetwork: {
    owner_id: "banker_A",
    source: "demo_connections_page",
    connections
  }
});

console.log("Warm Graph POC extracted:", connections);