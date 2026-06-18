function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function list(items = []) {
  if (!items.length) return "<p>Not enough information recorded.</p>";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderMedicineTable(rows = []) {
  if (!rows.length) return "<p>No medicine row is suggested from the available information. Speak with a clinician or pharmacist, especially if symptoms are severe or unclear.</p>";
  return `
    <table>
      <thead>
        <tr>
          <th>No.</th>
          <th>Purpose</th>
          <th>Medicine name</th>
          <th>Content / active ingredient</th>
          <th>Common examples</th>
          <th>How many days / review</th>
          <th>Safety check</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
          <tr>
            <td>${escapeHtml(row.serial)}</td>
            <td>${escapeHtml(row.purpose)}</td>
            <td>${escapeHtml(row.medicineName)}</td>
            <td>${escapeHtml(row.activeContent)}</td>
            <td>${escapeHtml((row.commonBrands || []).join(", "))}</td>
            <td>${escapeHtml(row.reviewWindow)}</td>
            <td>${escapeHtml(row.safety)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderOnlineResearch(report) {
  if (!report.onlineResearch || !report.onlineResearch.attempted) return "";
  const notes = report.onlineResearch.notes || [report.onlineResearch.message || "Online research was checked."];
  return `
    <h2>Online Research Update</h2>
    <p>Local knowledge was weak for this intake, so DOC checked trusted MedlinePlus/NLM health-topic search and processed any accepted result into local tokens and vectors.</p>
    ${list(notes)}
  `;
}

function renderReportHtml(report, { printable = false } = {}) {
  const urgencyClass = report.urgency.level === "Emergency" ? "danger" : report.urgency.level === "Soon" ? "warn" : "ok";
  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>DOC Medical Guidance Report</title>
    <style>
      :root { color-scheme: light; --ink:#12212b; --muted:#667985; --line:#d8e2e6; --panel:#ffffff; --teal:#1d8c83; --danger:#b73737; --warn:#a45e12; --ok:#207245; }
      * { box-sizing: border-box; }
      body { margin:0; font-family: Inter, Arial, sans-serif; color:var(--ink); background:#f5f8f8; line-height:1.55; }
      main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
      .sheet { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:28px; box-shadow:0 16px 50px rgba(18,33,43,.08); }
      h1,h2,h3 { margin:0 0 12px; line-height:1.15; }
      h1 { font-size: clamp(28px, 5vw, 44px); }
      h2 { margin-top:28px; font-size:22px; border-top:1px solid var(--line); padding-top:22px; }
      p { margin:0 0 12px; }
      .meta { color:var(--muted); display:flex; flex-wrap:wrap; gap:12px; margin:10px 0 20px; }
      .badge { display:inline-flex; align-items:center; border-radius:999px; border:1px solid currentColor; padding:5px 10px; font-weight:700; }
      .danger { color:var(--danger); } .warn { color:var(--warn); } .ok { color:var(--ok); }
      table { width:100%; border-collapse:collapse; margin-top:10px; }
      th,td { border:1px solid var(--line); text-align:left; vertical-align:top; padding:10px; }
      th { background:#eef6f5; }
      ul { margin-top:8px; padding-left:22px; }
      .notice { border-left:4px solid var(--teal); background:#eef8f7; padding:12px 14px; border-radius:6px; }
      .actions { display:${printable ? "none" : "flex"}; gap:10px; margin-bottom:16px; }
      button, a.button { border:0; border-radius:6px; background:var(--teal); color:white; padding:10px 14px; font-weight:800; cursor:pointer; text-decoration:none; }
      @media print { body{background:white;} main{padding:0;} .sheet{box-shadow:none;border:0;border-radius:0;} .actions{display:none;} }
    </style>
  </head>
  <body>
    <main>
      <div class="actions">
        <button onclick="window.print()">Print / Save PDF</button>
        <a class="button" href="/">Home</a>
      </div>
      <article class="sheet">
        <h1>DOC Medical Guidance Report</h1>
        <div class="meta">
          <span>Report ID: ${escapeHtml(report.id)}</span>
          <span>Created: ${escapeHtml(new Date(report.createdAt).toLocaleString())}</span>
          <span>Patient: ${escapeHtml(report.patient.name || "Not provided")}</span>
          <span>Age: ${escapeHtml(report.patient.age || "Not provided")}</span>
        </div>
        <p class="notice"><strong>Safety note:</strong> This report is educational triage support, not a medical diagnosis or prescription. Emergency symptoms require urgent local medical care.</p>

        <h2>Urgency</h2>
        <p><span class="badge ${urgencyClass}">${escapeHtml(report.urgency.level)}</span></p>
        ${list(report.urgency.reasons)}

        <h2>What DOC Understood</h2>
        ${list(report.summary)}

        <h2>Possible Causes To Discuss With A Clinician</h2>
        ${report.possibleConditions
          .map(
            (condition) => `
          <h3>${escapeHtml(condition.name)} <small>(${escapeHtml(condition.confidence)} confidence)</small></h3>
          <p>${escapeHtml(condition.explanation)}</p>
          ${list(condition.evidence)}
        `
          )
          .join("") || "<p>The information is too broad for a meaningful shortlist.</p>"}

        <h2>What Not To Do For Now</h2>
        ${list(report.carePlan.avoid)}

        <h2>Food, Fluids, And Recovery Support</h2>
        ${list(report.carePlan.foodHydration)}

        <h2>Medicine Discussion Table</h2>
        <p>Use this as a clinician/pharmacist discussion guide, not as a prescription. Exact dose depends on age, weight, pregnancy, allergies, organ disease, and current medicines.</p>
        ${renderMedicineTable(report.medicineGuidance)}

        <h2>Medical Terms Explained</h2>
        ${list(report.termExplanations)}

        <h2>Knowledge Used</h2>
        ${list(report.knowledgeUsed.map((item) => `${item.title}${item.url ? ` - ${item.url}` : ""}`))}
        ${renderOnlineResearch(report)}
      </article>
    </main>
  </body>
</html>
  `;
}

module.exports = {
  escapeHtml,
  renderReportHtml
};
