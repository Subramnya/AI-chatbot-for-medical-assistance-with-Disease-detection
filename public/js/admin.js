document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#adminLogin");
  const status = document.querySelector("#loginStatus");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    status.textContent = "Checking admin access...";
    try {
      const response = await DOC.api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          username: data.get("username"),
          password: data.get("password")
        })
      });
      localStorage.setItem(DOC.adminTokenKey, response.token);
      window.location.href = "/training.html";
    } catch (error) {
      status.textContent = error.message;
    }
  });
});
