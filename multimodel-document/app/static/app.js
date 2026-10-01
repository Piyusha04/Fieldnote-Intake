const state = { documents: [], selectedId: null, pendingDeleteId: null, filter: "all", query: "", newestFirst: true, toastTimer: null };
const listElement = document.getElementById("document-list");
const reviewPanel = document.getElementById("review-panel");
const fileInput = document.getElementById("file-input");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const percent = (value) => `${Math.round(Number(value || 0) * 100)}%`;

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.detail || `Request failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function relativeDate(dateValue) {
  const date = new Date(dateValue);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function visibleDocuments() {
  const query = state.query.trim().toLowerCase();
  return state.documents.filter((item) => {
    const matchesFilter = state.filter === "all" || item.status === state.filter;
    const searchable = `${item.filename} ${item.document_type} ${item.fields.map((field) => field.value).join(" ")}`.toLowerCase();
    return matchesFilter && (!query || searchable.includes(query));
  }).sort((left, right) => state.newestFirst
    ? new Date(right.created_at) - new Date(left.created_at)
    : new Date(left.created_at) - new Date(right.created_at));
}

function renderMetrics() {
  const attention = state.documents.filter((item) => item.status === "needs_review").length;
  const confidence = state.documents.length ? Math.round(state.documents.reduce((sum, item) => sum + item.confidence, 0) / state.documents.length * 100) : 0;
  const pages = state.documents.reduce((sum, item) => sum + item.page_count, 0);
  document.getElementById("queue-count").textContent = state.documents.length;
  document.getElementById("review-count").textContent = attention;
  document.getElementById("metric-total").textContent = state.documents.length;
  document.getElementById("metric-review").textContent = attention;
  document.getElementById("metric-confidence").innerHTML = `${confidence}<small>%</small>`;
  document.getElementById("metric-pages").textContent = pages.toLocaleString();
  document.getElementById("today-count").textContent = state.documents.filter((item) => new Date(item.created_at).toDateString() === new Date().toDateString()).length;
  document.getElementById("queue-updated").innerHTML = `<i></i> Updated just now`;
}

function renderList() {
  const items = visibleDocuments();
  document.getElementById("document-total").textContent = `(${items.length})`;
  document.getElementById("queue-summary").textContent = `Showing ${items.length} of ${state.documents.length} documents`;
  document.getElementById("empty-state").classList.toggle("hidden", items.length > 0);
  const isEmpty = state.documents.length === 0 && state.filter === "all" && !state.query;
  document.querySelector("#empty-state strong").textContent = isEmpty ? "Your queue is empty" : "No matching documents";
  document.querySelector("#empty-state span:nth-of-type(2)").textContent = isEmpty ? "Upload a PDF to start extracting fields and tables." : "Try another search or filter.";
  listElement.innerHTML = items.map((item) => {
    const confidence = Math.round(item.confidence * 100);
    const approved = item.status === "approved";
    return `<tr data-id="${escapeHtml(item.id)}" class="${state.selectedId === item.id ? "selected" : ""}">
      <td><div class="file-cell"><span class="pdf-icon">PDF</span><span class="file-text"><span class="file-name" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</span><span class="file-sub">${item.page_count} pages · PDF</span></span></div></td>
      <td class="type-label">${escapeHtml(item.document_type)}</td>
      <td class="confidence-cell"><div class="confidence-top"><span>${confidence}%</span><span class="confidence-track ${confidence < 82 ? "low" : ""}"><i style="width:${confidence}%"></i></span></div></td>
      <td><span class="status-pill ${approved ? "status-approved" : "status-review"}">${approved ? "Approved" : "Needs review"}</span></td>
      <td class="date-cell">${relativeDate(item.created_at)}</td><td><details class="row-actions"><summary class="row-menu" aria-label="Document actions" title="Document actions">···</summary><button class="delete-document" data-delete-document="${escapeHtml(item.id)}">Delete document</button></details></td></tr>`;
  }).join("");
}

function renderEmptyReview() {
  reviewPanel.innerHTML = `<div class="review-empty"><div class="empty-illustration"><span class="paper-back"></span><span class="paper-front"><i></i><i></i><i></i><b></b></span><span class="magnifier"></span></div><h3>Your review desk</h3><p>Select a document to inspect extracted fields, verify their sources, and approve the record.</p><div class="review-tip"><span>✳</span><span>Low-confidence fields are flagged so your team can focus where it matters.</span></div></div>`;
}

function renderDocument(item) {
  if (!item) return renderEmptyReview();
  const needsReview = item.status === "needs_review";
  const fieldsHtml = item.fields.map((field, index) => {
    const low = field.confidence < 0.82;
    return `<div class="field-row ${low ? "low" : ""}">
      <label class="field-label" for="field-${index}">${escapeHtml(field.label)}${low ? " <b aria-label='Low confidence'>!</b>" : ""}</label>
      <span class="field-confidence ${low ? "low" : ""}">${percent(field.confidence)}</span>
      <input class="field-value" id="field-${index}" data-field-key="${escapeHtml(field.key)}" value="${escapeHtml(field.value)}" autocomplete="off" aria-label="${escapeHtml(field.label)}">
      <button class="source-link" data-source-index="${index}" title="View page ${field.source.page}">p. ${field.source.page} ↗</button></div>`;
  }).join("");
  const tablesHtml = item.tables.length ? item.tables.map((table) => `<div class="table-section"><button class="table-toggle" type="button"><span>Table · page ${escapeHtml(table.page)}</span><span>${table.rows.length} rows⌄</span></button><div class="table-body"><table class="table-preview"><thead><tr>${table.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`).join("") : "";
  reviewPanel.innerHTML = `<div class="review-content"><div class="review-top"><div class="review-title-group"><div class="review-kicker">DOCUMENT REVIEW</div><div class="review-title" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</div><div class="review-meta">${escapeHtml(item.document_type)} · ${item.page_count} pages · Added ${relativeDate(item.created_at)}</div></div><button class="close-review" id="close-review" aria-label="Close document review">×</button></div>
    ${needsReview ? `<div class="confidence-banner"><span class="confidence-ring">${percent(item.confidence)}</span><span><strong>Review required</strong><span>${item.fields.filter((field) => field.confidence < 0.82).length} fields need a closer look</span></span></div>` : `<div class="approved-banner">✓ This document has been reviewed and approved.</div>`}
    <div class="field-heading"><span>EXTRACTED FIELDS</span><span>PAGE SOURCES</span></div><div class="field-list">${fieldsHtml}</div>
    ${tablesHtml ? `<div class="field-heading"><span>EXTRACTED TABLES</span><span>${item.tables.length} found</span></div>${tablesHtml}` : ""}
    <div class="source-view hidden" id="source-view"><div class="source-view-head"><span id="source-page-label">SOURCE · PAGE 1</span><button id="hide-source" aria-label="Close source">×</button></div><div class="source-quote" id="source-quote"></div></div>
    <div class="review-actions"><button class="save-button" id="save-review">Save changes</button>${needsReview ? `<button class="approve-button" id="approve-document">Approve document ✓</button>` : `<button class="approve-button" id="return-review">Reopen review</button>`}</div></div>`;
}

function render() {
  renderMetrics();
  renderList();
  renderDocument(state.documents.find((item) => item.id === state.selectedId));
}

async function loadDocuments(selectId = state.selectedId) {
  state.documents = await request("/api/documents");
  state.selectedId = state.documents.some((item) => item.id === selectId) ? selectId : null;
  render();
}

function setFilter(filter) {
  state.filter = filter;
  document.getElementById("filter-select").value = filter;
  document.querySelectorAll(".nav-item[data-view],.nav-item[data-filter]").forEach((button) => {
    const buttonFilter = button.dataset.view === "review" ? "needs_review" : button.dataset.filter || "all";
    button.classList.toggle("active", buttonFilter === filter);
  });
  renderList();
}

async function openSettings() {
  const dialog = document.getElementById("settings-dialog");
  dialog.showModal();
  const details = document.getElementById("settings-details");
  details.textContent = "Loading configuration…";
  try {
    const health = await request("/api/health");
    const rows = [
      ["API", health.status === "ok" ? "Connected" : "Unavailable"],
      ["Database", health.database],
      ["Document storage", health.storage],
      ["OCR", health.ocr_configured ? "Tesseract available" : "Not configured"],
      ["Multimodal model", health.model_configured ? "API key configured" : "Not configured"],
      ["Review threshold", `${Math.round(health.review_threshold * 100)}%`],
      ["Maximum upload", `${Math.round(health.max_upload_bytes / 1024 / 1024)} MB`],
    ];
    details.innerHTML = rows.map(([label, value]) => `<div class="dialog-detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  } catch (error) { details.textContent = `Could not load runtime configuration: ${error.message}`; }
}

async function saveReview(status = "needs_review") {
  const item = state.documents.find((entry) => entry.id === state.selectedId);
  if (!item) return;
  const fields = Object.fromEntries([...reviewPanel.querySelectorAll(".field-value")].map((input) => [input.dataset.fieldKey, input.value]));
  const updated = await request(`/api/documents/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields, status }) });
  state.documents = state.documents.map((entry) => entry.id === updated.id ? updated : entry);
  render();
  showToast(status === "approved" ? "Document approved and added to the record." : "Review changes saved.");
}

async function uploadFiles(files) {
  const pdfs = [...files].filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  if (!pdfs.length) return showToast("Choose one or more PDF files to continue.");
  for (const file of pdfs) {
    const button = document.getElementById("add-document");
    button.disabled = true;
    button.innerHTML = `<span class="plus-icon">…</span> Processing ${escapeHtml(file.name.length > 22 ? `${file.name.slice(0, 19)}…` : file.name)}`;
    try {
      const form = new FormData();
      form.append("file", file);
      const added = await request("/api/documents", { method: "POST", body: form });
      await loadDocuments(added.id);
      showToast(`${file.name} added to the intake queue.`);
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; button.innerHTML = `<span class="plus-icon">+</span> Add documents`; }
  }
  fileInput.value = "";
}

document.getElementById("add-document").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (event) => uploadFiles(event.target.files));
document.getElementById("search-input").addEventListener("input", (event) => { state.query = event.target.value; renderList(); });
document.getElementById("sort-button").addEventListener("click", (event) => {
  state.newestFirst = !state.newestFirst;
  event.currentTarget.innerHTML = `<span>↕</span> ${state.newestFirst ? "Newest first" : "Oldest first"}`;
  renderList();
});
document.getElementById("filter-select").addEventListener("change", (event) => setFilter(event.target.value));
document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  setFilter(button.dataset.filter);
}));
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  setFilter(button.dataset.view === "review" ? "needs_review" : "all");
}));
listElement.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-document]");
  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();
    const item = state.documents.find((entry) => entry.id === deleteButton.dataset.deleteDocument);
    if (!item) return;
    state.pendingDeleteId = item.id;
    document.getElementById("delete-document-name").textContent = `${item.filename} and its stored PDF will be permanently removed.`;
    document.getElementById("delete-dialog").showModal();
    return;
  }
  if (event.target.closest(".row-actions")) return;
  if (event.target.closest(".row-menu")) return;
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  state.selectedId = row.dataset.id;
  render();
});
reviewPanel.addEventListener("click", async (event) => {
  const sourceButton = event.target.closest("[data-source-index]");
  const active = state.documents.find((item) => item.id === state.selectedId);
  if (sourceButton && active) {
    const field = active.fields[Number(sourceButton.dataset.sourceIndex)];
    const quote = document.getElementById("source-quote");
    let excerpt = escapeHtml(field.source.excerpt);
    if (field.value) {
      const escapedValue = field.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      excerpt = excerpt.replace(new RegExp(`(${escapedValue})`, "i"), "<mark>$1</mark>");
    }
    document.getElementById("source-page-label").textContent = `SOURCE · PAGE ${field.source.page}`;
    quote.innerHTML = excerpt;
    document.getElementById("source-view").classList.remove("hidden");
  }
  if (event.target.closest("#hide-source")) document.getElementById("source-view").classList.add("hidden");
  if (event.target.closest("#close-review")) { state.selectedId = null; renderDocument(null); renderList(); }
  if (event.target.closest("#save-review")) await saveReview("needs_review").catch((error) => showToast(error.message));
  if (event.target.closest("#approve-document")) await saveReview("approved").catch((error) => showToast(error.message));
  if (event.target.closest("#return-review")) await saveReview("needs_review").catch((error) => showToast(error.message));
  if (event.target.closest(".table-toggle")) event.target.closest(".table-section").querySelector(".table-body").classList.toggle("hidden");
});

document.getElementById("empty-upload").addEventListener("click", () => fileInput.click());
document.getElementById("help-button").addEventListener("click", () => document.getElementById("help-dialog").showModal());
document.getElementById("settings-button").addEventListener("click", openSettings);
document.getElementById("cancel-delete").addEventListener("click", () => document.getElementById("delete-dialog").close());
document.getElementById("confirm-delete").addEventListener("click", async () => {
  const item = state.documents.find((entry) => entry.id === state.pendingDeleteId);
  if (!item) return document.getElementById("delete-dialog").close();
  const confirmButton = document.getElementById("confirm-delete");
  confirmButton.disabled = true;
  try {
    await request(`/api/documents/${item.id}`, { method: "DELETE" });
    state.documents = state.documents.filter((entry) => entry.id !== item.id);
    if (state.selectedId === item.id) state.selectedId = null;
    document.getElementById("delete-dialog").close();
    state.pendingDeleteId = null;
    render();
    showToast("Document and stored PDF deleted.");
  } catch (error) { showToast(error.message); }
  finally { confirmButton.disabled = false; }
});
document.getElementById("delete-dialog").addEventListener("close", () => { state.pendingDeleteId = null; });
document.querySelectorAll(".dialog-close").forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  button.closest("dialog").close();
}));

let dragDepth = 0;
const dropOverlay = document.getElementById("drop-overlay");
window.addEventListener("dragenter", (event) => { event.preventDefault(); dragDepth += 1; dropOverlay.classList.remove("hidden"); });
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("dragleave", (event) => { event.preventDefault(); dragDepth -= 1; if (dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.add("hidden"); } });
window.addEventListener("drop", (event) => { event.preventDefault(); dragDepth = 0; dropOverlay.classList.add("hidden"); uploadFiles(event.dataTransfer.files); });
document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); document.getElementById("search-input").focus(); } });
request("/api/health").then((health) => {
  const status = document.getElementById("system-status");
  status.innerHTML = `<i></i>${health.status === "ok" ? "API connected" : "Service unavailable"}`;
}).catch(() => { document.getElementById("system-status").textContent = "API unavailable"; });
loadDocuments().catch((error) => { showToast(`Could not load the intake queue: ${error.message}`); renderEmptyReview(); });
