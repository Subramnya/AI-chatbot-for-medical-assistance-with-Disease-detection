document.addEventListener("DOMContentLoaded", async () => {
  DOC.requireAdmin();
  const form = document.querySelector("#trainingForm");
  const status = document.querySelector("#trainingStatus");
  const summary = document.querySelector("#trainingSummary");

  async function loadSummary() {
    const manual = await DOC.api("/api/training/summary?source=manual", {
      headers: DOC.adminHeaders()
    });
    const user = await DOC.api("/api/training/summary?source=user", {
      headers: DOC.adminHeaders()
    });
    summary.innerHTML = `
      <div class="summary-box"><h3>Manual + seed data</h3><p>${manual.summary.count} documents, ${manual.summary.tokenCount} tokens.</p></div>
      <div class="summary-box"><h3>User learning</h3><p>${user.summary.count} pending/review documents, ${user.summary.tokenCount} tokens.</p></div>
      <div class="summary-box"><h3>Safety filter</h3><p>Dangerous false claims and duplicate uploads are rejected before vector storage.</p></div>
      <div class="summary-box"><h3>Local storage</h3><p>Training data lives in the project data folder on this machine.</p></div>
    `;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const files = await DOC.filesToPayload(form.trainingFiles.files, "training");
    status.textContent = "Processing, tokenizing, comparing, and vectorizing...";
    try {
      const response = await DOC.api("/api/training/upload", {
        method: "POST",
        headers: DOC.adminHeaders(),
        body: JSON.stringify({
          title: data.get("title"),
          category: data.get("category"),
          files
        })
      });
      const lines = response.result.results.map((item) => `${item.file}: ${item.status} - ${item.message || item.reason || ""}`);
      status.textContent = lines.join("\n");
      form.reset();
      await loadSummary();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  await loadSummary();
});
