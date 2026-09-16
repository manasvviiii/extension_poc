const statusEl = document.getElementById("status");
const readBtn = document.getElementById("read");
const importBtn = document.getElementById("import");

function getExtracted() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      ["extractedNetwork"],
      result => {
        resolve(result.extractedNetwork || null);
      }
    );
  });
}

readBtn.addEventListener("click", async () => {

  const network = await getExtracted();

  if (!network) {
    statusEl.textContent =
      "No extracted network yet.\n" +
      "Open the demo connections page first.";

    return;
  }

  statusEl.textContent =
    `Found ${network.connections.length} connections:\n\n` +
    network.connections
      .map(x =>
        `• ${x.name} — ${x.position} @ ${x.company}`
      )
      .join("\n");
});


importBtn.addEventListener("click", async () => {

  statusEl.textContent = "Sending...";

  try {

    const network = await getExtracted();

    if (!network) {
      throw new Error(
        "No extracted network. Open the demo page first."
      );
    }

    const response = await fetch(
      "http://127.0.0.1:8000/network/import",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify(network)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.detail || JSON.stringify(data)
      );
    }

    statusEl.textContent =
      `Imported ${data.imported} extracted connections.\n` +
      `Owner: ${data.owner_id}`;

  } catch (error) {

    statusEl.textContent =
      `Import error: ${error.message}`;

  }
});