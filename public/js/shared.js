(function () {
  const DOC = {
    adminTokenKey: "doc_admin_token",
    sessionKey: "doc_chat_session"
  };

  DOC.api = async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    const response = await fetch(path, {
      ...options,
      headers
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Request failed: ${response.status}`);
      Object.assign(error, data);
      throw error;
    }
    return data;
  };

  DOC.fileToPayload = function fileToPayload(file, kind = "supporting") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.onload = () =>
        resolve({
          name: file.name,
          type: file.type,
          size: file.size,
          kind,
          content: reader.result
        });
      reader.readAsDataURL(file);
    });
  };

  DOC.filesToPayload = async function filesToPayload(fileList, kind) {
    return Promise.all([...fileList].map((file) => DOC.fileToPayload(file, kind)));
  };

  DOC.escapeHtml = function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  DOC.getAdminToken = function getAdminToken() {
    return localStorage.getItem(DOC.adminTokenKey) || "";
  };

  DOC.requireAdmin = function requireAdmin() {
    if (!DOC.getAdminToken()) window.location.href = "/admin-login.html";
  };

  DOC.adminHeaders = function adminHeaders() {
    return { Authorization: `Bearer ${DOC.getAdminToken()}` };
  };

  DOC.updateAdminVisibility = function updateAdminVisibility() {
    const isAdmin = Boolean(DOC.getAdminToken());
    document.querySelectorAll("[data-admin-only]").forEach((item) => {
      item.hidden = !isAdmin;
      item.setAttribute("aria-hidden", String(!isAdmin));
    });
  };

  function initMenu() {
    const panel = document.querySelector("[data-menu-panel]");
    const open = document.querySelector("[data-menu-open]");
    const close = document.querySelector("[data-menu-close]");
    if (!panel || !open) return;
    open.addEventListener("click", () => panel.classList.add("open"));
    close?.addEventListener("click", () => panel.classList.remove("open"));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") panel.classList.remove("open");
    });
  }

  async function updateConnectivity() {
    const online = navigator.onLine;
    document.body.classList.toggle("offline", !online);
    if (!online) return;
    try {
      await fetch("/api/health", { cache: "no-store" });
      document.body.classList.remove("offline");
    } catch {
      document.body.classList.add("offline");
    }
  }

  DOC.speak = function speak(text, hooks = {}) {
    if (!("speechSynthesis" in window)) return Promise.resolve();
    window.speechSynthesis.cancel();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.96;
      utterance.pitch = 1;
      utterance.onstart = () => hooks.onstart?.();
      utterance.onend = () => {
        hooks.onend?.();
        resolve();
      };
      utterance.onerror = () => {
        hooks.onend?.();
        resolve();
      };
      window.speechSynthesis.speak(utterance);
    });
  };

  DOC.initChrome = function initChrome() {
    initMenu();
    DOC.updateAdminVisibility();
    updateConnectivity();
    window.addEventListener("online", updateConnectivity);
    window.addEventListener("offline", updateConnectivity);
  };

  window.DOC = DOC;
  document.addEventListener("DOMContentLoaded", DOC.initChrome);
})();
