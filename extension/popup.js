let latestData = null;

const output = document.getElementById("output");


// --------------------------------------------------
// EXTRACT DATA FROM LINKEDIN
// --------------------------------------------------

document
  .getElementById("extract")
  .addEventListener("click", async () => {

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab || !tab.id) {
      output.textContent = "No active tab found.";
      return;
    }

    // Make sure we're actually on LinkedIn
    if (!tab.url || !tab.url.includes("linkedin.com")) {
      output.textContent =
        "Please open a LinkedIn page first.";
      return;
    }

    output.textContent =
      "Extracting data from LinkedIn...";

    chrome.tabs.sendMessage(
      tab.id,
      {
        action: "extractLinkedIn"
      },
      (response) => {

        if (chrome.runtime.lastError) {
          output.textContent =
            "Could not connect to LinkedIn page.\n\n" +
            chrome.runtime.lastError.message +
            "\n\n" +
            "Try refreshing the LinkedIn page and reload the extension.";

          return;
        }

        if (!response) {
          output.textContent =
            "No response received from LinkedIn.";
          return;
        }

        if (!response.success) {
          output.textContent =
            "Extraction failed.\n\n" +
            (response.error || "Unknown error");

          return;
        }

        // Save extracted data for backend upload
        latestData = response;

        output.textContent =
          `Found ${response.count} records\n\n` +
          JSON.stringify(response, null, 2);
      }
    );
  });


// --------------------------------------------------
// SEND REAL LINKEDIN DATA TO BACKEND
// --------------------------------------------------

document
  .getElementById("send")
  .addEventListener("click", async () => {

    if (!latestData) {
      output.textContent =
        "Extract LinkedIn data first.";
      return;
    }

    if (
      !latestData.connections ||
      latestData.connections.length === 0
    ) {
      output.textContent =
        "No LinkedIn connection records to send.";
      return;
    }

    output.textContent =
      `Sending ${latestData.connections.length} records to backend...`;

    try {

      const response = await fetch(
        "http://127.0.0.1:8000/network/import",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            owner_id: "linkedin_user",
            source: "linkedin_dom",
            connections: latestData.connections
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();

        throw new Error(
          `Backend returned ${response.status}: ${errorText}`
        );
      }

      const result = await response.json();

      output.textContent =
        "Successfully sent to backend.\n\n" +
        JSON.stringify(result, null, 2);

    } catch (error) {

      console.error(
        "[Warm Graph] Backend error:",
        error
      );

      output.textContent =
        "Backend error:\n\n" +
        error.message;
    }
  });