document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#intakeForm");
  const status = document.querySelector("#formStatus");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    status.textContent = "Preparing your report...";

    try {
      const data = new FormData(form);
      const visualFiles = await DOC.filesToPayload(form.visualFiles.files, "visual");
      const reportFiles = await DOC.filesToPayload(form.reportFiles.files, "report");
      const intake = {
        source: "manual-intake",
        name: data.get("name"),
        age: data.get("age"),
        sex: data.get("sex"),
        symptoms: data.get("symptoms"),
        visuals: data.get("visuals"),
        allergies: data.get("allergies"),
        currentMedicines: data.get("currentMedicines"),
        reportsDescription: data.get("reportsDescription"),
        additional: data.get("additional"),
        files: [...visualFiles, ...reportFiles]
      };

      const response = await DOC.api("/api/report", {
        method: "POST",
        body: JSON.stringify({ intake })
      });
      window.location.href = response.reportUrl;
    } catch (error) {
      status.textContent = error.message;
      submit.disabled = false;
    }
  });
});
