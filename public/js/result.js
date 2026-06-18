document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const frame = document.querySelector("#reportFrame");
  const status = document.querySelector("#reportStatus");
  const download = document.querySelector("#downloadReport");
  const printButton = document.querySelector("#printReport");
  const feedbackForm = document.querySelector("#feedbackForm");
  const followupWindow = document.querySelector("#followupWindow");
  const followupForm = document.querySelector("#followupForm");
  const followupMessage = document.querySelector("#followupMessage");
  const followupStatus = document.querySelector("#followupStatus");

  if (!id) {
    status.textContent = "Missing report id.";
    return;
  }

  try {
    const response = await DOC.api(`/api/report/${encodeURIComponent(id)}`);
    frame.srcdoc = response.html;
    download.href = `/api/report/${encodeURIComponent(id)}/download`;
    printButton.addEventListener("click", () => frame.contentWindow?.print());
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
  }

  feedbackForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(feedbackForm);
    const button = feedbackForm.querySelector("button");
    const note = document.querySelector("#feedbackStatus");
    button.disabled = true;
    note.textContent = "Saving feedback for review...";
    try {
      const response = await DOC.api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          reportId: id,
          correction: form.get("correction"),
          notes: form.get("notes")
        })
      });
      note.textContent = response.result.added
        ? "Saved into user-learning review data."
        : response.result.message || response.result.reason || "Feedback recorded.";
      feedbackForm.reset();
    } catch (error) {
      note.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  function appendFollowup(role, text, reportUrl = "") {
    if (!followupWindow) return;
    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;
    bubble.textContent = text;
    followupWindow.appendChild(bubble);
    if (reportUrl) {
      const link = document.createElement("a");
      link.className = "button button-pill secondary";
      link.href = reportUrl;
      link.textContent = "Open new report";
      followupWindow.appendChild(link);
    }
    followupWindow.scrollTop = followupWindow.scrollHeight;
  }

  followupForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = followupMessage.value.trim();
    if (!message) return;
    appendFollowup("user", message);
    followupMessage.value = "";
    followupStatus.textContent = "DOC is answering...";
    try {
      const response = await DOC.api("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: localStorage.getItem(DOC.sessionKey),
          reportId: id,
          message
        })
      });
      localStorage.setItem(DOC.sessionKey, response.sessionId);
      appendFollowup("assistant", response.reply, response.reportUrl);
      followupStatus.textContent = "";
    } catch (error) {
      appendFollowup("assistant", error.message);
      followupStatus.textContent = "";
    }
  });
});
