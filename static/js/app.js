const fileSelect = document.getElementById("collection-file");
const itemsBody = document.getElementById("collection-items");
const statusText = document.getElementById("status-text");
const defaultLabel = document.getElementById("default-label");
const downloadRootLabel = document.getElementById("download-root");
const newFileButton = document.getElementById("new-file");
const setDefaultButton = document.getElementById("set-default-file");
const deleteFileButton = document.getElementById("delete-file");
const openConfigButton = document.getElementById("open-config");
const addItemButton = document.getElementById("add-item");
const selectAllButton = document.getElementById("select-all");
const selectNoneButton = document.getElementById("select-none");
const downloadSelectedButton = document.getElementById("download-selected");
const jobsList = document.getElementById("jobs-list");
const modalBackdrop = document.getElementById("modal-backdrop");
const newFileModal = document.getElementById("new-file-modal");
const itemModal = document.getElementById("item-modal");
const configModal = document.getElementById("config-modal");
const logModal = document.getElementById("log-modal");
const logModalTitle = document.getElementById("log-modal-title");
const logContent = document.getElementById("log-content");
const newFileForm = document.getElementById("new-file-form");
const itemForm = document.getElementById("item-form");
const configForm = document.getElementById("config-form");
const itemModalTitle = document.getElementById("item-modal-title");
const itemIdField = document.getElementById("item-id");
const itemNameField = document.getElementById("item-name");
const itemUrlField = document.getElementById("item-url");
const itemFolderField = document.getElementById("item-folder");
const itemCookieField = document.getElementById("item-cookie-file");
const configDownloadRoot = document.getElementById("config-download-root");
const configFilenameTemplate = document.getElementById("config-filename-template");
const configVideoCodec = document.getElementById("config-video-codec");
const configRestrictFilenames = document.getElementById("config-restrict-filenames");
const configMaxDownloads = document.getElementById("config-max-downloads");
const configDefaultCollection = document.getElementById("config-default-collection");
const configCookieFiles = document.getElementById("config-cookie-files");

let configData = null;
let editingItemId = null;
let currentLogJobId = null;
const jobStreams = new Map();
const liveJobs = new Map();

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || response.statusText);
  }
  return response.json();
}

async function sendJson(path, method, body) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || response.statusText);
  }
  return response.json();
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("status-error", isError);
}

function openModal(modal) {
  modalBackdrop.classList.remove("hidden");
  modal.classList.remove("hidden");
}

function closeModal(modal) {
  modalBackdrop.classList.add("hidden");
  modal.classList.add("hidden");
}

function openLogModal(jobId, title) {
  currentLogJobId = jobId;
  logModalTitle.textContent = title || `Job ${jobId} Log`;
  logContent.textContent = "Loading log...";
  openModal(logModal);
  
  // Fetch log content
  fetch(`/api/jobs/${encodeURIComponent(jobId)}/logs`)
    .then(response => response.text())
    .then(text => {
      logContent.textContent = text || "No log content available.";
    })
    .catch(err => {
      logContent.textContent = `Error loading log: ${err.message}`;
      setStatus(`Unable to load log: ${err.message}`, true);
    });
}

function resetItemForm() {
  editingItemId = null;
  itemModalTitle.textContent = "Add collection entry";
  itemIdField.value = "";
  itemIdField.disabled = false;
  itemNameField.value = "";
  itemUrlField.value = "";
  itemFolderField.value = "";
  itemCookieField.innerHTML = "";
  renderCookieOptions();
}

function renderCookieOptions() {
  itemCookieField.innerHTML = "";
  const cookieFiles = configData?.cookie_files || {};
  const entries = Object.entries(cookieFiles);
  if (entries.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "(no cookie files configured)";
    itemCookieField.appendChild(option);
    return;
  }
  entries.forEach(([key]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = key;
    itemCookieField.appendChild(option);
  });
}

function renderConfigSummary() {
  if (!configData) {
    downloadRootLabel.textContent = "";
    defaultLabel.textContent = "";
    return;
  }

  downloadRootLabel.textContent = `Download root: ${configData.download_root}`;
  defaultLabel.textContent = configData.default_collection_file
    ? `Default: ${configData.default_collection_file}`
    : "No default set";
}

async function loadConfig() {
  try {
    configData = await fetchJson("/api/config");
    renderConfigSummary();
    await loadCollectionFiles();
  } catch (err) {
    configData = null;
    renderConfigSummary();
    setStatus(`Unable to load config: ${err.message}`, true);
  }
}

async function loadCollectionFiles() {
  try {
    const data = await fetchJson("/api/collection-files");
    if (!data.files || data.files.length === 0) {
      fileSelect.innerHTML = '<option value="">(no collection files found)</option>';
      setStatus("No collection files found. Create a new file to get started.", true);
      return;
    }

    fileSelect.innerHTML = "";
    let defaultFound = false;
    data.files.forEach((file) => {
      const option = document.createElement("option");
      option.value = file.filename;
      option.textContent = file.filename;
      if (file.is_default) {
        option.selected = true;
        defaultFound = true;
      }
      fileSelect.appendChild(option);
    });

    if (!defaultFound && data.files.length > 0) {
      fileSelect.value = data.files[0].filename;
    }

    if (configData?.default_collection_file) {
      renderConfigSummary();
    }
  } catch (err) {
    fileSelect.innerHTML = '<option value="">(unable to load files)</option>';
    setStatus(`Unable to load collection files: ${err.message}`, true);
  }
}

async function loadCollectionItems(fileName) {
  if (!fileName) {
    itemsBody.innerHTML = '<tr><td colspan="7" class="empty-row">Select a collection file to view entries.</td></tr>';
    return;
  }

  try {
    const data = await fetchJson(`/api/collection-items?file=${encodeURIComponent(fileName)}`);
    renderItems(data.items || []);
  } catch (err) {
    itemsBody.innerHTML = '<tr><td colspan="7" class="empty-row">Unable to load collection items.</td></tr>';
    setStatus(`Unable to load items: ${err.message}`, true);
  }
}

async function loadJobs() {
  try {
    const data = await fetchJson("/api/jobs");
    if (!data.jobs || data.jobs.length === 0) {
      jobsList.innerHTML = '<div class="empty-row">No jobs started yet. Select entries and begin a download.</div>';
      return;
    }

    data.jobs.forEach((job) => {
      liveJobs.set(job.id, { ...liveJobs.get(job.id), ...job });
      attachJobStream(job.id, job);
    });
    renderJobs(Array.from(liveJobs.values()));
  } catch (err) {
    jobsList.innerHTML = '<div class="empty-row">Unable to load jobs.</div>';
  }
}

function renderJobs(jobs) {
  if (!jobs || jobs.length === 0) {
    jobsList.innerHTML = '<div class="empty-row">No jobs started yet. Select entries and begin a download.</div>';
    return;
  }

  jobsList.innerHTML = "";
  jobs
    .slice()
    .sort((a, b) => (a.started_at || "") < (b.started_at || "") ? 1 : -1)
    .forEach((job) => {
      const card = document.createElement("div");
      card.className = "job-card";
      card.dataset.jobId = job.id;

      const status = job.status || "queued";
      const progress = job.progress || { percent: 0, item_id: job.current_item || "" };
      const message = progress.item_id
        ? `Working on ${progress.item_id}`
        : status === "completed"
        ? "Completed"
        : status === "failed"
        ? `Failed: ${job.result || "unknown"}`
        : status === "cancelled"
        ? "Cancelled"
        : "Waiting...";

      card.innerHTML = `
        <div class="job-card-header">
          <div>
            <div class="job-title">Job ${job.id}</div>
            <div class="job-meta">${status.toUpperCase()} · ${job.collection_item_ids.length} item(s)</div>
          </div>
          <div class="job-actions">
            ${status === "running" || status === "queued" ? `<button class="button danger cancel-job" data-job-id="${job.id}">Cancel</button>` : ""}
            <button class="button secondary view-log" data-job-id="${job.id}">View log</button>
          </div>
        </div>
        <div class="job-progress-label">${message}</div>
        <div class="job-progress-bar-wrapper">
          <div class="job-progress-bar" style="width: ${Math.min(progress.percent || 0, 100)}%"></div>
        </div>
        <div class="job-progress-meta">${progress.percent?.toFixed(1) || 0}% · ${progress.speed || "-"} · ETA ${progress.eta || "-"}</div>
      `;
      jobsList.appendChild(card);
    });
}

function updateJobState(jobId, update) {
  const existing = liveJobs.get(jobId) || { id: jobId };
  liveJobs.set(jobId, { ...existing, ...update });
  renderJobs(Array.from(liveJobs.values()));
}

function attachJobStream(jobId, job) {
  if (jobStreams.has(jobId) || job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return;
  }

  const source = new EventSource(`/api/stream/${encodeURIComponent(jobId)}`);

  source.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "progress") {
      updateJobState(jobId, { progress: payload, status: "running" });
    } else if (payload.type === "item_started") {
      updateJobState(jobId, { status: "running", current_item: payload.item_id });
    } else if (payload.type === "job_failed") {
      updateJobState(jobId, { status: "failed", result: payload.error });
      source.close();
    } else if (payload.type === "job_finished") {
      updateJobState(jobId, { status: payload.status, completed_at: payload.completed_at });
      source.close();
    }
  };

  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      source.close();
      jobStreams.delete(jobId);
    }
  };

  jobStreams.set(jobId, source);
}

async function startDownload() {
  const selectedItems = Array.from(document.querySelectorAll(".item-checkbox:checked")).map(
    (checkbox) => checkbox.dataset.itemId
  );
  if (selectedItems.length === 0) {
    setStatus("Select one or more entries to download.", true);
    return;
  }

  const fileName = getCurrentFile();
  if (!fileName) {
    setStatus("No collection file selected.", true);
    return;
  }

  try {
    const job = await sendJson("/api/jobs", "POST", {
      file: fileName,
      collection_item_ids: selectedItems,
    });
    updateJobState(job.id, job);
    attachJobStream(job.id, job);
    setStatus(`Started download job ${job.id}.`);
    await loadJobs();
  } catch (err) {
    setStatus(`Unable to start download: ${err.message}`, true);
  }
}

async function cancelJob(jobId) {
  try {
    await sendJson(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, "POST");
    updateJobState(jobId, { status: "cancelled" });
    setStatus(`Cancelled job ${jobId}.`);
  } catch (err) {
    setStatus(`Unable to cancel job: ${err.message}`, true);
  }
}

function openLog(jobId) {
  openLogModal(jobId, `Job ${jobId} Log`);
}

async function handleJobActions(event) {
  const button = event.target.closest("button");
  if (!button) return;

  const jobId = button.dataset.jobId;
  if (button.classList.contains("cancel-job")) {
    cancelJob(jobId);
  }
  if (button.classList.contains("view-log")) {
    openLog(jobId);
  }
}

function renderItems(items) {
  itemsBody.innerHTML = "";
  if (!items || items.length === 0) {
    itemsBody.innerHTML = '<tr><td colspan="7" class="empty-row">No collection entries found.</td></tr>';
    return;
  }

  const downloadRoot = configData?.download_root || "";

  items.forEach((item) => {
    const row = document.createElement("tr");
    const fullPath = downloadRoot && item.folder ? `${downloadRoot.replace(/\\$/, "")}${downloadRoot.endsWith("/") || item.folder.startsWith("/") ? "" : "/"}${item.folder}` : item.folder;
    const urlDisplay = (item.url || "").length > 25 
      ? (item.url || "").substring(0, 25) + "..." 
      : (item.url || "");
    row.innerHTML = `
      <td><input type="checkbox" class="item-checkbox" data-item-id="${item.id}" /></td>
      <td>${item.id || ""}</td>
      <td>${item.name || ""}</td>
      <td title="${fullPath}"><span class="folder-value">${item.folder || ""}</span></td>
      <td>${item.cookie_file || "(default)"}</td>
      <td class="url-cell"><a href="${item.url || "#"}" target="_blank" rel="noreferrer" title="${item.url || ""}">${urlDisplay}</a></td>
      <td class="actions-cell">
        <button class="action-button edit-item" data-item-id="${item.id}">Edit</button>
        <button class="action-button danger delete-item" data-item-id="${item.id}">Delete</button>
      </td>
    `;
    itemsBody.appendChild(row);
  });
}

function getCurrentFile() {
  return fileSelect.value;
}

async function setDefaultCollectionFile() {
  const fileName = getCurrentFile();
  if (!fileName) {
    setStatus("No collection file selected.", true);
    return;
  }
  if (!configData) {
    setStatus("Config not loaded yet. Please wait.", true);
    return;
  }

  try {
    await sendJson(`/api/collection-files/${encodeURIComponent(fileName)}/default`, "PUT");
    configData.default_collection_file = fileName;
    renderConfigSummary();
    setStatus(`Set ${fileName} as default.`);
  } catch (err) {
    setStatus(`Unable to set default: ${err.message}`, true);
  }
}

async function deleteCollectionFile() {
  const fileName = getCurrentFile();
  if (!fileName) {
    setStatus("No collection file selected.", true);
    return;
  }
  
  // Check if file is in use by any running jobs
  const jobs = Array.from(liveJobs.values());
  const inUseJobs = jobs.filter(job => job.file === fileName && job.status === "running");
  
  if (inUseJobs.length > 0) {
    setStatus(`Cannot delete file "${fileName}" - it is in use by ${inUseJobs.length} running job(s).`, true);
    return;
  }
  
  if (!confirm(`Delete collection file '${fileName}'? This cannot be undone.`)) {
    return;
  }

  try {
    await sendJson(`/api/collection-files/${encodeURIComponent(fileName)}`, "DELETE");
    await loadCollectionFiles();
    setStatus(`Deleted ${fileName}.`);
  } catch (err) {
    setStatus(`Unable to delete file: ${err.message}`, true);
  }
}

async function openNewFileModal() {
  document.getElementById("new-file-name").value = "";
  openModal(newFileModal);
}

async function openConfigEditor() {
  if (!configData) {
    await loadConfig();
  }

  configDownloadRoot.value = configData.download_root || "";
  configFilenameTemplate.value = configData.filename_template || "%(title).200B.%(ext)s";
  configVideoCodec.value = configData.video_codec || "h264";
  configRestrictFilenames.checked = !!configData.restrict_filenames;
  configMaxDownloads.value = configData.max_concurrent_downloads || 2;
  configDefaultCollection.value = configData.default_collection_file || "";
  configCookieFiles.value = Object.entries(configData.cookie_files || {})
    .map(([key, path]) => `${key}=${path}`)
    .join("\n");
  openModal(configModal);
}

async function openItemModal(item = null) {
  resetItemForm();
  if (item) {
    editingItemId = item.id;
    itemModalTitle.textContent = "Edit collection entry";
    itemIdField.value = item.id;
    itemIdField.disabled = true;
    itemNameField.value = item.name || "";
    itemUrlField.value = item.url || "";
    itemFolderField.value = item.folder || "";
    if (item.cookie_file) {
      itemCookieField.value = item.cookie_file;
    }
  }
  openModal(itemModal);
}

async function submitNewFileForm(event) {
  event.preventDefault();
  const fileName = document.getElementById("new-file-name").value.trim();
  if (!fileName) {
    setStatus("File name is required.", true);
    return;
  }

  try {
    await sendJson("/api/collection-files", "POST", { filename: fileName });
    closeModal(newFileModal);
    await loadCollectionFiles();
    setStatus(`Created collection file ${fileName}.`);
  } catch (err) {
    setStatus(`Unable to create file: ${err.message}`, true);
  }
}

async function submitItemForm(event) {
  event.preventDefault();
  const fileName = getCurrentFile();
  if (!fileName) {
    setStatus("No collection file selected.", true);
    return;
  }

  // Validate required fields
  const name = itemNameField.value.trim();
  if (!name) {
    setStatus("Item name is required.", true);
    return;
  }

  const url = itemUrlField.value.trim();
  if (!url) {
    setStatus("Item URL is required.", true);
    return;
  }
  
  // Validate URL format
  try {
    new URL(url);
  } catch {
    setStatus("Please enter a valid URL.", true);
    return;
  }

  const folder = itemFolderField.value.trim();
  if (!folder) {
    setStatus("Folder path is required.", true);
    return;
  }

  const payload = {
    id: itemIdField.value.trim() || undefined,
    name: name,
    url: url,
    folder: folder,
    cookie_file: itemCookieField.value,
  };

  try {
    if (editingItemId) {
      await sendJson(`/api/collection-items/${encodeURIComponent(editingItemId)}?file=${encodeURIComponent(fileName)}`, "PUT", payload);
      setStatus(`Updated entry ${editingItemId}.`);
    } else {
      await sendJson(`/api/collection-items?file=${encodeURIComponent(fileName)}`, "POST", payload);
      setStatus(`Created entry ${payload.id || "new"}.`);
    }

    closeModal(itemModal);
    await loadCollectionItems(fileName);
  } catch (err) {
    setStatus(`Unable to save item: ${err.message}`, true);
  }
}

async function submitConfigForm(event) {
  event.preventDefault();
  
  // Validate download root exists
  const downloadRoot = configDownloadRoot.value.trim();
  if (!downloadRoot) {
    setStatus("Download root is required.", true);
    return;
  }
  
  // Validate cookie files format
  const cookieLines = configCookieFiles.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const cookieFiles = {};
  for (const line of cookieLines) {
    const [key, ...rest] = line.split("=");
    if (!key || rest.length === 0) {
      setStatus("Cookie files must use key=value format (key=path).", true);
      return;
    }
    cookieFiles[key.trim()] = rest.join("=").trim();
  }
  
  // Validate at least one cookie file exists
  if (Object.keys(cookieFiles).length === 0) {
    setStatus("At least one cookie file must be configured.", true);
    return;
  }

  try {
    await sendJson("/api/config", "PUT", {
      download_root: downloadRoot,
      filename_template: configFilenameTemplate.value.trim(),
      video_codec: configVideoCodec.value.trim(),
      restrict_filenames: configRestrictFilenames.checked,
      max_concurrent_downloads: Number(configMaxDownloads.value) || 1,
      default_collection_file: configDefaultCollection.value.trim(),
      cookie_files: cookieFiles,
    });
    closeModal(configModal);
    await loadConfig();
    setStatus("Configuration updated successfully.");
  } catch (err) {
    setStatus(`Unable to update config: ${err.message}`, true);
  }
}

async function deleteCollectionItem(itemId) {
  const fileName = getCurrentFile();
  if (!fileName) {
    setStatus("No collection file selected.", true);
    return;
  }
  if (!confirm(`Delete item '${itemId}' from ${fileName}?`)) {
    return;
  }

  try {
    await sendJson(`/api/collection-items/${encodeURIComponent(itemId)}?file=${encodeURIComponent(fileName)}`, "DELETE");
    await loadCollectionItems(fileName);
    setStatus(`Deleted ${itemId}.`);
  } catch (err) {
    setStatus(`Unable to delete item: ${err.message}`, true);
  }
}

function findItemById(items, id) {
  return items.find((item) => item.id === id);
}

async function handleItemActions(event) {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.classList.contains("edit-item")) {
    const itemId = button.dataset.itemId;
    const fileName = getCurrentFile();
    if (!itemId || !fileName) return;
    try {
      const data = await fetchJson(`/api/collection-items?file=${encodeURIComponent(fileName)}`);
      const item = findItemById(data.items || [], itemId);
      if (!item) {
        setStatus(`Item ${itemId} not found.`, true);
        return;
      }
      openItemModal(item);
    } catch (err) {
      setStatus(`Unable to load item: ${err.message}`, true);
    }
  }

  if (button.classList.contains("delete-item")) {
    deleteCollectionItem(button.dataset.itemId);
  }
}

function toggleSelection(selectAll) {
  const checkboxes = Array.from(document.querySelectorAll(".item-checkbox"));
  checkboxes.forEach((checkbox) => {
    checkbox.checked = selectAll;
  });
}

function closeOpenModal(event) {
  const target = event.target;
  const closeKey = target.dataset?.close;
  if (closeKey) {
    const modal = document.getElementById(closeKey);
    if (modal) {
      closeModal(modal);
    }
  }
}

// Log modal close handler
logModal?.addEventListener("click", (event) => {
  const target = event.target;
  const closeKey = target.dataset?.close;
  if (closeKey === "log-modal") {
    closeModal(logModal);
  }
});

fileSelect.addEventListener("change", () => loadCollectionItems(fileSelect.value));
newFileButton.addEventListener("click", openNewFileModal);
setDefaultButton.addEventListener("click", setDefaultCollectionFile);
deleteFileButton.addEventListener("click", deleteCollectionFile);
openConfigButton.addEventListener("click", openConfigEditor);
addItemButton.addEventListener("click", () => openItemModal());
selectAllButton.addEventListener("click", () => toggleSelection(true));
selectNoneButton.addEventListener("click", () => toggleSelection(false));
downloadSelectedButton.addEventListener("click", startDownload);
itemsBody.addEventListener("click", handleItemActions);
jobsList.addEventListener("click", handleJobActions);
modalBackdrop.addEventListener("click", () => {
  closeModal(newFileModal);
  closeModal(itemModal);
  closeModal(configModal);
  closeModal(logModal);
});
newFileForm.addEventListener("submit", submitNewFileForm);
itemForm.addEventListener("submit", submitItemForm);
configForm.addEventListener("submit", submitConfigForm);

Array.from(document.querySelectorAll("[data-close]")).forEach((button) => {
  button.addEventListener("click", closeOpenModal);
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadConfig();
  await loadJobs();
  // Load collection items for the default/selected file
  const selectedFile = fileSelect.value;
  if (selectedFile) {
    await loadCollectionItems(selectedFile);
  }
});
