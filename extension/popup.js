let latestData = null;

const BACKEND_BASE_URL =
  "http://127.0.0.1:8000";

const output =
  document.getElementById("output");


/* =========================================================
   OWNER IDENTITY
========================================================= */

function getStoredOwnerId() {
  return new Promise((resolve) => {

    chrome.storage.local.get(
      ["ownerId", "externalProfileUrl"],
      (result) => {

        resolve({
          ownerId:
            result.ownerId || null,

          externalProfileUrl:
            result.externalProfileUrl || null
        });

      }
    );

  });
}


/* =========================================================
   SHOW DETECTED IDENTITY
========================================================= */

(async () => {

  const identityEl =
    document.getElementById("identity");

  const identity =
    await getStoredOwnerId();


  if (identity.ownerId) {

    identityEl.className =
      "detected";

    identityEl.textContent =
      `Owner: ${identity.ownerId}\n` +
      `LinkedIn profile: ${
        identity.externalProfileUrl ||
        "Detected ✓"
      }\n` +
      "Identity status: Ready";

  } else {

    identityEl.className =
      "pending";

    identityEl.textContent =
      "Identity is pending — reload the extension " +
      "to create a local owner ID.";

  }

})();


/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHtml(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}


/* =========================================================
   EXTRACTION PREVIEW
========================================================= */

function renderExtractionPreview(response) {

  const connections =
    response.connections || [];

  const evidence =
    response.relationship_evidence || [];


  let html = `

    <div class="summary">

      <div class="summary-card">

        <span class="summary-number">
          ${response.first_degree_count}
        </span>

        <span class="summary-label">
          1st-degree
        </span>

      </div>


      <div class="summary-card">

        <span class="summary-number">
          ${response.relationship_evidence_count}
        </span>

        <span class="summary-label">
          Evidence
        </span>

      </div>

    </div>

  `;


  /* =======================================================
     FIRST-DEGREE CONNECTIONS
  ======================================================= */

  if (connections.length > 0) {

    html += `

      <div class="section-title">
        Your Connections
      </div>

    `;


    connections.forEach((person) => {

      html += `

        <div class="record">

          <div class="record-name">
            ${escapeHtml(
              person.name ||
              "Unknown person"
            )}
          </div>


          <div class="record-headline">
            ${escapeHtml(
              person.headline ||
              "No headline available"
            )}
          </div>


          <div class="record-meta">

            <span class="badge">
              ${escapeHtml(
                person.degree ||
                "1st"
              )}
            </span>


            ${
              person.connection_date
                ? `
                  <span class="badge">
                    Connected ${
                      escapeHtml(
                        person.connection_date
                      )
                    }
                  </span>
                `
                : ""
            }

          </div>


          ${
            person.profile_url
              ? `
                <a
                  class="record-link"
                  href="${escapeHtml(
                    person.profile_url
                  )}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${escapeHtml(
                    person.profile_url
                  )}
                </a>
              `
              : ""
          }

        </div>

      `;

    });

  }


  /* =======================================================
     RELATIONSHIP EVIDENCE
  ======================================================= */

  if (evidence.length > 0) {

    html += `

      <div
        class="section-title"
        style="margin-top:14px;"
      >
        Relationship Evidence
      </div>

    `;


    evidence.forEach((item) => {

      const mutualNames =
        Array.isArray(
          item.mutual_connection_names
        )
          ? item.mutual_connection_names
          : [];


      html += `

        <div class="record">

          <div class="record-name">
            ${escapeHtml(
              item.name ||
              "Unknown person"
            )}
          </div>


          <div class="record-headline">
            ${escapeHtml(
              item.headline ||
              "No headline available"
            )}
          </div>


          <div class="record-meta">

            <span class="badge">
              ${escapeHtml(
                item.observed_degree ||
                "2nd"
              )}
            </span>

            <span class="badge">
              ${escapeHtml(
                item.evidence_type ||
                "relationship"
              )}
            </span>

          </div>


          ${
            item.mutual_connections_text
              ? `
                <div class="mutual">

                  <strong>
                    Mutual:
                  </strong>

                  ${escapeHtml(
                    item.mutual_connections_text
                  )}

                </div>
              `
              : ""
          }


          ${
            mutualNames.length > 0
              ? `
                <div class="mutual">

                  <strong>
                    Connections:
                  </strong>

                  ${escapeHtml(
                    mutualNames.join(", ")
                  )}

                </div>
              `
              : ""
          }


          ${
            item.location
              ? `
                <div class="mutual">

                  <strong>
                    Location:
                  </strong>

                  ${escapeHtml(
                    item.location
                  )}

                </div>
              `
              : ""
          }


          ${
            item.followers
              ? `
                <div class="mutual">

                  <strong>
                    Followers:
                  </strong>

                  ${escapeHtml(
                    item.followers
                  )}

                </div>
              `
              : ""
          }


          ${
            item.profile_url
              ? `
                <a
                  class="record-link"
                  href="${escapeHtml(
                    item.profile_url
                  )}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${escapeHtml(
                    item.profile_url
                  )}
                </a>
              `
              : ""
          }

        </div>

      `;

    });

  }


  if (
    connections.length === 0 &&
    evidence.length === 0
  ) {

    html += `

      <div class="status-box empty">
        No relationship data found on this page.
      </div>

    `;

  }


  output.innerHTML =
    html;

}


/* =========================================================
   EXTRACT LINKEDIN DATA
========================================================= */

document
  .getElementById("extract")
  .addEventListener(
    "click",
    async () => {

      try {

        const [tab] =
          await chrome.tabs.query({
            active: true,
            currentWindow: true
          });


        if (!tab || !tab.id) {

          output.textContent =
            "No active tab found.";

          return;

        }


        if (
          !tab.url ||
          (
            !tab.url.includes("linkedin.com") &&
            !tab.url.startsWith(
              "http://127.0.0.1:5500"
            )
          )
        ) {

          output.textContent =
            "Please open a LinkedIn page first.";

          return;

        }


        output.textContent =
          "Reading visible LinkedIn DOM...";


        chrome.tabs.sendMessage(
          tab.id,
          {
            action:
              "extractLinkedIn"
          },
          (response) => {

            if (
              chrome.runtime.lastError
            ) {

              output.textContent =
                "Could not read LinkedIn page.\n\n" +
                chrome.runtime.lastError.message;

              return;

            }


            if (!response) {

              output.textContent =
                "No response received from LinkedIn page.";

              return;

            }


            if (!response.success) {

              output.textContent =
                "Extraction failed.\n\n" +
                response.error;

              return;

            }


            latestData =
              response;


            renderExtractionPreview(
              response
            );

          }
        );


      } catch (error) {

        output.textContent =
          "Unexpected error.\n\n" +
          error.message;

      }

    }
  );


/* =========================================================
   BACKEND HELPERS
========================================================= */

async function getOwnerForBackend() {

  const identity =
    await getStoredOwnerId();


  if (!identity.ownerId) {

    throw new Error(
      "Owner identity is not ready yet."
    );

  }


  return identity.ownerId;

}


async function backendRequest(
  path,
  options = {}
) {

  const response =
    await fetch(
      `${BACKEND_BASE_URL}${path}`,
      options
    );


  const result =
    await response.json();


  if (!response.ok) {

    throw new Error(
      result.detail ||
      "Backend request failed."
    );

  }


  return result;

}


/* =========================================================
   REFRESH DATA
========================================================= */

document
  .getElementById("refresh")
  .addEventListener(
    "click",
    async () => {

      try {

        const ownerId =
          await getOwnerForBackend();


        const result =
          await backendRequest(
            "/refresh",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  owner_id:
                    ownerId,

                  force:
                    false
                })
            }
          );


        output.innerHTML = `

          <div class="status-box">

            <strong>
              Refresh job queued
            </strong>

            <br><br>

            Job:
            ${escapeHtml(
              result.job_id
            )}

          </div>

        `;

      } catch (error) {

        output.textContent =
          `Refresh failed.\n\n` +
          error.message;

      }

    }
  );


/* =========================================================
   TARGET SEARCH
========================================================= */

document
  .getElementById("searchTarget")
  .addEventListener(
    "click",
    async () => {

      try {

        const ownerId =
          await getOwnerForBackend();


        const companyInput =
          document.getElementById(
            "company"
          );

        const dealSideInput =
          document.getElementById(
            "dealSide"
          );

        const targetRoleInput =
          document.getElementById(
            "targetRole"
          );


        const company =
          companyInput
            ? companyInput.value.trim()
            : "";


        const dealSide =
          dealSideInput
            ? dealSideInput.value
            : "sell_side";


        const targetRole =
          targetRoleInput
            ? targetRoleInput.value.trim()
            : "";


        /* -----------------------------------------
           VALIDATE COMPANY
        ----------------------------------------- */

        if (!company) {

          output.innerHTML = `

            <div class="status-box">

              <strong>
                Enter a target company
              </strong>

              <br><br>

              Example:
              Company B

            </div>

          `;


          if (companyInput) {
            companyInput.focus();
          }


          return;

        }


        /* -----------------------------------------
           BUILD REQUEST BODY DIRECTLY
        ----------------------------------------- */

        const requestBody = {

          owner_id:
            ownerId,

          company:
            company,

          deal_side:
            dealSide,

          target_role:
            targetRole

        };


        console.log(
          "Warm Graph target search:",
          requestBody
        );


        output.innerHTML = `

          <div class="status-box">

            Searching for target person...

            <br><br>

            Company:
            ${escapeHtml(company)}

            <br>

            Role:
            ${
              escapeHtml(
                targetRole ||
                "Any role"
              )
            }

          </div>

        `;


        /* -----------------------------------------
           SEND REQUEST
        ----------------------------------------- */

        const result =
          await backendRequest(
            "/target/search",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify(
                  requestBody
                )
            }
          );


        console.log(
          "Warm Graph target search result:",
          result
        );


        /* -----------------------------------------
           RENDER RESULT
        ----------------------------------------- */

        renderTargetSearch(
          result
        );


      } catch (error) {

        output.innerHTML = `

          <div class="status-box">

            <strong>
              Target search failed
            </strong>

            <br><br>

            ${escapeHtml(
              error.message
            )}

          </div>

        `;

      }

    }
  );


/* =========================================================
   TARGET SEARCH RESULT
========================================================= */

function renderTargetSearch(result) {

  /*
   * Current backend response shape:
   *
   * {
   *   owner_id: "...",
   *   company: "...",
   *   deal_side: "sell_side",
   *   candidates: [...]
   * }
   *
   * Also support results/matches for future compatibility.
   */

  let candidates = [];


  if (
    Array.isArray(
      result.candidates
    )
  ) {

    candidates =
      result.candidates;

  } else if (
    Array.isArray(
      result.results
    )
  ) {

    candidates =
      result.results;

  } else if (
    Array.isArray(
      result.matches
    )
  ) {

    candidates =
      result.matches;

  } else if (
    result.name ||
    result.person_name ||
    result.profile_url
  ) {

    candidates = [
      result
    ];

  }


  /* -----------------------------------------
     NO CANDIDATES
  ----------------------------------------- */

  if (
    candidates.length === 0
  ) {

    output.innerHTML = `

      <div class="status-box empty">

        <strong>
          No target person found
        </strong>

        <br><br>

        Company:
        ${escapeHtml(
          result.company ||
          "Unknown"
        )}

        <br>

        Deal side:
        ${escapeHtml(
          result.deal_side ||
          "Unknown"
        )}

        ${
          result.message
            ? `
              <br><br>
              ${escapeHtml(
                result.message
              )}
            `
            : ""
        }

      </div>

    `;

    return;

  }


  let html = `

    <div class="section-title">
      Target Person
    </div>

  `;


  candidates.forEach((person) => {

    const name =
      person.name ||
      person.person_name ||
      "Unknown person";


    const headline =
      person.headline ||
      person.title ||
      person.matched_role ||
      null;


    html += `

      <div class="record">

        <div class="record-name">
          ${escapeHtml(name)}
        </div>


        ${
          headline
            ? `
              <div class="record-headline">
                ${escapeHtml(
                  headline
                )}
              </div>
            `
            : ""
        }


        <div class="record-meta">

          ${
            person.degree
              ? `
                <span class="badge">
                  ${escapeHtml(
                    person.degree
                  )}
                </span>
              `
              : ""
          }


          ${
            person.matched_role
              ? `
                <span class="badge">
                  Role match
                </span>
              `
              : ""
          }


          ${
            person.confidence !==
            undefined
              ? `
                <span class="badge">
                  Confidence:
                  ${escapeHtml(
                    person.confidence
                  )}
                </span>
              `
              : ""
          }


          ${
            person.warmth !==
            undefined
              ? `
                <span class="badge">
                  Warmth:
                  ${escapeHtml(
                    person.warmth
                  )}
                </span>
              `
              : ""
          }

        </div>


        ${
          person.reason
            ? `
              <div class="mutual">

                <strong>
                  Why matched:
                </strong>

                ${escapeHtml(
                  person.reason
                )}

              </div>
            `
            : ""
        }


        ${
          person.path_count !==
          undefined
            ? `
              <div class="mutual">

                <strong>
                  Paths found:
                </strong>

                ${escapeHtml(
                  person.path_count
                )}

              </div>
            `
            : ""
        }


        ${
          person.profile_url
            ? `
              <a
                class="record-link"
                href="${escapeHtml(
                  person.profile_url
                )}"
                target="_blank"
                rel="noopener noreferrer"
              >
                ${escapeHtml(
                  person.profile_url
                )}
              </a>
            `
            : ""
        }

      </div>

    `;

  });


  output.innerHTML =
    html;

}


/* =========================================================
   FIND WARM PATH
========================================================= */

document
  .getElementById("findPath")
  .addEventListener(
    "click",
    async () => {

      try {

        const ownerId =
          await getOwnerForBackend();


        const targetId =
          document
            .getElementById(
              "pathTarget"
            )
            .value
            .trim();


        if (!targetId) {

          output.innerHTML = `

            <div class="status-box">

              <strong>
                Enter a target profile URL
              </strong>

              <br><br>

              Example:
              https://www.linkedin.com/in/target-person

            </div>

          `;

          return;

        }


        const result =
          await backendRequest(
            "/graph/path",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({

                  owner_id:
                    ownerId,

                  source_id:
                    ownerId,

                  target_id:
                    targetId,

                  cutoff:
                    4

                })
            }
          );


        renderPathResult(
          result
        );


      } catch (error) {

        output.innerHTML = `

          <div class="status-box">

            <strong>
              Path search failed
            </strong>

            <br><br>

            ${escapeHtml(
              error.message
            )}

          </div>

        `;

      }

    }
  );
  /* =========================================================
   EXPLAIN WARM PATH
========================================================= */

document
  .getElementById("explainPath")
  .addEventListener(
    "click",
    async () => {

      try {

        const ownerId =
          await getOwnerForBackend();

        const targetId =
          document
            .getElementById("pathTarget")
            .value
            .trim();

        if (!targetId) {

          output.innerHTML = `

            <div class="status-box">

              <strong>
                Enter a target profile URL
              </strong>

              <br><br>

              Example:
              https://www.linkedin.com/in/target-person

            </div>

          `;

          return;
        }

        output.innerHTML = `

          <div class="status-box">
            Generating warm-path explanation...
          </div>

        `;

        const result =
          await backendRequest(
            "/graph/explain-path",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({

                  owner_id:
                    ownerId,

                  source_id:
                    ownerId,

                  target_id:
                    targetId,

                  cutoff:
                    4

                })
            }
          );

        console.log(
          "Warm Graph path explanation:",
          result
        );

        renderPathExplanation(result);

      } catch (error) {

        output.innerHTML = `

          <div class="status-box">

            <strong>
              Path explanation failed
            </strong>

            <br><br>

            ${escapeHtml(
              error.message
            )}

          </div>

        `;

      }

    }
  );


/* =========================================================
   PATH EXPLANATION RESULT
========================================================= */

function renderPathExplanation(result) {

  const explanation =
    result.explanation ||
    result.message ||
    result.detail ||
    "";

  const paths =
    Array.isArray(result.paths)
      ? result.paths
      : [];

  let html = `

    <div class="section-title">
      Warm Path Explanation
    </div>

  `;


  if (paths.length > 0) {

    paths.forEach(
      (path, index) => {

        html += `

          <div class="record">

            <div class="record-name">
              Path ${index + 1}
            </div>

            ${
              path.warmth !== undefined
                ? `
                  <div class="record-meta">

                    <span class="badge">
                      Warmth:
                      ${escapeHtml(
                        path.warmth
                      )}
                    </span>

                    ${
                      path.hops !== undefined
                        ? `
                          <span class="badge">
                            ${escapeHtml(
                              path.hops
                            )}
                            hops
                          </span>
                        `
                        : ""
                    }

                  </div>
                `
                : ""
            }


            ${
              Array.isArray(path.path)
                ? `
                  <div class="mutual">

                    <strong>
                      Path:
                    </strong>

                    ${escapeHtml(
                      path.path.join(" → ")
                    )}

                  </div>
                `
                : ""
            }


            ${
              path.explanation
                ? `
                  <div class="mutual">

                    <strong>
                      Explanation:
                    </strong>

                    ${escapeHtml(
                      path.explanation
                    )}

                  </div>
                `
                : ""
            }

          </div>

        `;

      }
    );

  }


  if (explanation) {

    html += `

      <div class="record">

        <div class="record-name">
          Explanation
        </div>

        <div class="record-headline">
          ${escapeHtml(
            explanation
          )}
        </div>

      </div>

    `;

  }


  if (
    !explanation &&
    paths.length === 0
  ) {

    html += `

      <div class="status-box empty">
        No explanation was returned by
        the backend.
      </div>

    `;

  }


  output.innerHTML =
    html;

}


/* =========================================================
   PATH RESULT
========================================================= */

function renderPathResult(result) {

  const paths =
    result.paths || [];


  if (
    !Array.isArray(paths) ||
    paths.length === 0
  ) {

    /*
     * Keep the actual backend response visible
     * when no path is found, which helps debugging.
     */

    output.innerHTML = `

      <div class="status-box empty">

        <strong>
          No warm path found
        </strong>

        <br><br>

        Target:
        ${escapeHtml(
          result.target_id ||
          "Unknown"
        )}

      </div>

    `;

    return;

  }


  let html = `

    <div class="summary">

      <div class="summary-card">

        <span class="summary-number">
          ${paths.length}
        </span>

        <span class="summary-label">
          Path${paths.length === 1 ? "" : "s"}
        </span>

      </div>

    </div>


    <div class="section-title">
      Warm Paths
    </div>

  `;


  paths.forEach(
    (path, index) => {

      html += `

        <div class="record">

          <div class="record-name">
            Path ${index + 1}
          </div>


          ${
            path.hops !==
            undefined
              ? `
                <div class="record-meta">

                  <span class="badge">
                    ${escapeHtml(
                      path.hops
                    )}
                    hops
                  </span>

                </div>
              `
              : ""
          }


          ${
            path.warmth !==
            undefined
              ? `
                <div class="mutual">

                  <strong>
                    Warmth:
                  </strong>

                  ${escapeHtml(
                    path.warmth
                  )}

                </div>
              `
              : ""
          }


          ${
            path.explanation
              ? `
                <div class="mutual">

                  <strong>
                    Explanation:
                  </strong>

                  ${escapeHtml(
                    path.explanation
                  )}

                </div>
              `
              : ""
          }


          ${
            Array.isArray(
              path.path
            )
              ? `
                <div class="mutual">

                  <strong>
                    Path:
                  </strong>

                  ${escapeHtml(
                    path.path.join(
                      " → "
                    )
                  )}

                </div>
              `
              : ""
          }

        </div>

      `;

    }
  );


  output.innerHTML =
    html;

}


/* =========================================================
   SEARCH NETWORK
========================================================= */

document
  .getElementById("searchNetwork")
  .addEventListener(
    "click",
    async () => {

      try {

        const ownerId =
          await getOwnerForBackend();


        const query =
          encodeURIComponent(
            document
              .getElementById(
                "company"
              )
              .value
              .trim()
          );


        if (!query) {

          output.innerHTML = `

            <div class="status-box">

              Enter a company to search
              your network.

            </div>

          `;

          return;

        }


        const result =
          await backendRequest(
            `/graph/${encodeURIComponent(
              ownerId
            )}/search?q=${query}`
          );


        output.textContent =
          JSON.stringify(
            result,
            null,
            2
          );


      } catch (error) {

        output.textContent =
          `Network search failed.\n\n` +
          error.message;

      }

    }
  );


/* =========================================================
   VIEW GRAPH
========================================================= */

document
  .getElementById("viewGraph")
  .addEventListener(
    "click",
    async () => {

      try {

        const ownerId =
          await getOwnerForBackend();


        await chrome.tabs.create({

          url:
            `${BACKEND_BASE_URL}/graph/view?owner_id=` +
            `${encodeURIComponent(
              ownerId
            )}`

        });


      } catch (error) {

        output.textContent =
          `Graph view failed.\n\n` +
          error.message;

      }

    }
  );


/* =========================================================
   SEND TO BACKEND (User-initiated sharing with explicit confirmation)
========================================================= */

document
  .getElementById("send")
  .addEventListener(
    "click",
    async () => {

      if (!latestData) {

        output.textContent =
          "Extract LinkedIn data first.";

        return;

      }


      const identity =
        await getStoredOwnerId();


      if (!identity.ownerId) {

        output.textContent =
          "Couldn't detect your LinkedIn identity yet.\n\n" +
          "Visit any LinkedIn page with the extension active " +
          "and try again.";

        return;

      }

      const connectionCount = (latestData.connections || []).length;
      const evidenceCount = (latestData.relationship_evidence || []).length;

      // EXPLICIT CONFIRMATION STEP
      output.innerHTML = `

        <div class="status-box" style="border: 2px solid #2457a6; background: #f0f4fc;">

          <strong style="font-size: 14px; color: #11366b;">
            Confirm & Share Network Data
          </strong>

          <br><br>

          You are about to share the extracted network data with your Fenon tenant:

          <br><br>

          • <strong>${connectionCount}</strong> 1st-degree connections<br>
          • <strong>${evidenceCount}</strong> relationship evidence items

          <br><br>

          Owner ID: <code>${escapeHtml(identity.ownerId)}</code>

          <br><br>

          <button id="confirmShare" style="background: #2457a6; color: white; border-color: #1b4485; font-weight: 700; margin-bottom: 6px;">
            Confirm & Share Network Data
          </button>

          <button id="cancelShare" style="background: #ffffff; color: #444; border-color: #ccc;">
            Cancel
          </button>

        </div>

      `;

      document.getElementById("cancelShare").addEventListener("click", () => {
        renderExtractionPreview(latestData);
      });

      document.getElementById("confirmShare").addEventListener("click", async () => {
        try {

          const payload = {
            owner_id: identity.ownerId,
            source: "linkedin_dom",
            confirmed: true,
            connections: latestData.connections || [],
            relationship_evidence: latestData.relationship_evidence || [],
            page_type: latestData.page_type,
            page_url: latestData.page_url
          };

          output.innerHTML = `
            <div class="status-box">
              Sending confirmed network data to backend...
            </div>
          `;

          const response = await fetch(
            `${BACKEND_BASE_URL}/network/import`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            }
          );

          const result = await response.json();

          if (!response.ok) {
            throw new Error(
              result.detail ||
              "Backend request failed."
            );
          }

          output.innerHTML = `
            <div class="status-box">
              <strong style="color: #1e4620;">
                Backend import successful
              </strong>
              <br><br>
              1st-degree connections: ${escapeHtml(result.connection_count)}<br>
              Relationship evidence: ${escapeHtml(result.relationship_evidence_count)}<br>
              Graph nodes: ${escapeHtml(result.graph_nodes)}<br>
              Graph edges: ${escapeHtml(result.graph_edges)}
            </div>
          `;

        } catch (error) {
          output.innerHTML = `
            <div class="status-box">
              <strong style="color: #8b0000;">
                Backend error
              </strong>
              <br><br>
              ${escapeHtml(error.message)}
            </div>
          `;
        }
      });

    }
  );