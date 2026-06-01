document.addEventListener("DOMContentLoaded", async () => {
  DOC.requireAdmin();
  const tabs = document.querySelectorAll("[data-source]");
  const summary = document.querySelector("#dataSummary");
  const list = document.querySelector("#trainingList");

  async function load(source) {
    const e = DOC.escapeHtml;
    tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.source === source));
    summary.textContent = "Loading trained data...";
    list.innerHTML = "";
    try {
      const [summaryResponse, itemsResponse] = await Promise.all([
        DOC.api(`/api/training/summary?source=${source}`, { headers: DOC.adminHeaders() }),
        DOC.api(`/api/training/items?source=${source}`, { headers: DOC.adminHeaders() })
      ]);

      summary.innerHTML = `
        <div class="summary-box"><h3>${source === "user" ? "User-interaction" : "Manual/self"} data</h3><p>${summaryResponse.summary.count} documents stored.</p></div>
        <div class="summary-box"><h3>Token count</h3><p>${summaryResponse.summary.tokenCount} searchable tokens.</p></div>
        <div class="summary-box"><h3>Categories</h3><p>${summaryResponse.summary.categories.map((item) => `${e(item.category)} (${item.count})`).join(", ") || "No categories yet."}</p></div>
      `;

      if (!itemsResponse.items.length) {
        list.innerHTML = `<div class="empty">No trained data in this bucket yet.</div>`;
        return;
      }

      list.innerHTML = itemsResponse.items
        .map(
          (item) => `
        <article class="training-item">
          <button type="button">
            <h3><span>${e(item.title)}</span><small>${item.tokenCount} tokens</small></h3>
            <p>${e(item.category)} - ${e(item.status || "active")} - ${new Date(item.createdAt).toLocaleString()}</p>
          </button>
          <div class="training-detail">
            <p><strong>Source:</strong> ${e(item.source)}${item.url ? ` - ${e(item.url)}` : ""}</p>
            <p><strong>Top tokens:</strong> ${item.tokens.map(e).join(", ")}</p>
            <pre>${e(item.text)}</pre>
          </div>
        </article>
      `
        )
        .join("");

      list.querySelectorAll(".training-item button").forEach((button) => {
        button.addEventListener("click", () => button.closest(".training-item").classList.toggle("open"));
      });
    } catch (error) {
      summary.textContent = error.message;
    }
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => load(tab.dataset.source)));
  await load("manual");
});
