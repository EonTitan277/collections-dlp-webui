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
const configDownloadRoot = document.getElementById("config-download-root");
const configFilenameTemplate = document.getElementById("config-filename-template");
const configVideoCodec = document.getElementById("config-video-codec");
const configRestrictFilenames = document.getElementById("config-restrict-filenames");
const configMaxDownloads = document.getElementById("config-max-downloads");
const configDefaultCollection = document.getElementById("config-default-collection");
const configCookieFiles = document.getElementById("config-cookie-files");
const headerSelectAll = document.getElementById("header-select-all");

// Cookie-related elements
const collectionCookieSection = document.getElementById("collection-cookie-section");
const currentCookieFile = document.getElementById("current-cookie-file");
const uploadCookieBtn = document.getElementById("upload-cookie-btn");
const selectCookieBtn = document.getElementById("select-cookie-btn");
const clearCookieBtn = document.getElementById("clear-cookie-btn");
const cookieFileUpload = document.getElementById("cookie-file-upload");
const cookieFileSelect = document.getElementById("cookie-file-select");
const applyCookieBtn = document.getElementById("apply-cookie-btn");
const deleteCookieBtn = document.getElementById("delete-cookie-btn");
const cookieSelectModal = document.getElementById("cookie-select-modal");

let configData = null;
let currentCollectionCookie = null;
let editingItemId = null;
let currentLogJobId = null;
const jobStreams = new Map();
const liveJobs = new Map();
let statusTimeout = null;

// Sort state
let currentSortBy = "custom";
let currentSortDirection = "asc";
let currentItems = [];

// Drag-and-drop state
let draggedItemId = null;
let draggedRow = null;
let activeDropTarget = null;
let dropPosition = "before";

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



// Sort items function
function sortItems(items) {
  if (!items || items.length === 0) return items;
  
  if (currentSortBy === "custom") {
    return [...items];
  }
  
  const sorted = [...items].sort((a, b) => {
    const valA = a[currentSortBy] || "";
    const valB = b[currentSortBy] || "";
    return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: "base" });
  });
  
  if (currentSortDirection === "desc") {
    sorted.reverse();
  }
  
  return sorted;
}

// Update sort controls UI
function updateSortControls() {
  const sortBySelect = document.getElementById("sort-by");
  const sortDirectionBtn = document.getElementById("sort-direction");
  const sortIcon = sortDirectionBtn?.querySelector(".sort-icon");
  
  if (sortBySelect) {
    sortBySelect.value = currentSortBy;
  }
  
  if (sortDirectionBtn && sortIcon) {
    sortIcon.textContent = currentSortDirection === "asc" ? "▼" : "▲";
    sortIcon.classList.toggle("asc", currentSortDirection === "asc");
  }
}

// Save sort preferences to backend
async function saveSortPreferences(fileName) {
  try {
    await sendJson(`/api/collection-files/${encodeURIComponent(fileName)}/sort`, "PUT", {
      sort_by: currentSortBy,
      sort_direction: currentSortDirection
    });
  } catch (err) {
    console.error("Failed to save sort preferences:", err);
  }
}

// Handle sort by change
function handleSortByChange(event) {
  currentSortBy = event.target.value;
  updateSortControls();
  renderItems(currentItems);

  const fileName = getCurrentFile();
  if (fileName) {
    void saveSortPreferences(fileName);
  }
}

// Handle sort direction toggle
function handleSortDirectionToggle() {
  currentSortDirection = currentSortDirection === "asc" ? "desc" : "asc";
  updateSortControls();
  renderItems(currentItems);

  const fileName = getCurrentFile();
  if (fileName) {
    void saveSortPreferences(fileName);
  }
}



const urlDisplayFormatters = [formatTikTokUrlDisplay];

function getUrlDisplayText(rawUrl) {
  if (!rawUrl) return "";
  for (const formatter of urlDisplayFormatters) {
    const formatted = formatter(rawUrl);
    if (formatted) {
      return formatted;
    }
  }
  return rawUrl.length > 25 ? rawUrl.substring(0, 25) + "..." : rawUrl;
}

function formatTikTokUrlDisplay(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!/\.?tiktok\.com$/i.test(parsed.hostname)) {
    return null;
  }

  const path = parsed.pathname || "";
  const firstSlashAfterUsername = (() => {
    if (!path.startsWith("/")) {
      return -1;
    }
    const secondSlashIndex = path.indexOf("/", 1);
    return secondSlashIndex;
  })();

  if (firstSlashAfterUsername <= 0 || firstSlashAfterUsername === path.length - 1) {
    return null;
  }

  const snippet = path.substring(firstSlashAfterUsername);
  const displayed = snippet.length > 25 ? snippet.substring(0, 25) : snippet;
  return `...${displayed}...`;
}


function setStatus(message, isError = false) {
  // Cancel any pending auto-dismiss timer
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }
  
  // Remove fading class to reset opacity to 1
  statusText.classList.remove("status-fading");
  
  // Display the message
  statusText.textContent = message;
  statusText.classList.toggle("status-error", isError);
  
  // Schedule auto-dismiss: 10s for errors, 5s for info
  const dismissDelay = isError ? 10000 : 5000;
  statusTimeout = setTimeout(() => {
    // Fade the entire element (background, border, and text)
    statusText.classList.add("status-fading");
    // Don't clear text - just leave it faded. This prevents layout shifts.
    // The element always maintains its fixed height.
  }, dismissDelay);
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
  renderCookieOptions();
}

function renderCookieOptions() {
  const cookieFiles = configData?.cookie_files || {};
  const entries = Object.entries(cookieFiles);
  if (entries.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "(no cookie files configured)";
    return;
  }
  entries.forEach(([key]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = key;
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
    
    // Clear the initial loading message with a success status
    setStatus(`Loaded ${data.files.length} collection file(s).`);
  } catch (err) {
    fileSelect.innerHTML = '<option value="">(unable to load files)</option>';
    setStatus(`Unable to load collection files: ${err.message}`, true);
  }
}

async function loadCollectionItems(fileName) {
  if (!fileName) {
    itemsBody.innerHTML = '<tr><td colspan="6" class="empty-row">Select a collection file to view entries.</td></tr>';
    collectionCookieSection.style.display = "none";
    return;
  }

  try {
    const data = await fetchJson(`/api/collection-items?file=${encodeURIComponent(fileName)}`);
    currentSortBy = data.sort_by || "custom";
    currentSortDirection = data.sort_direction || "asc";
    currentItems = data.items || [];
    updateSortControls();
    renderItems(currentItems);
    
    // Update collection cookie display
    currentCollectionCookie = data.cookie_file;
    updateCollectionCookieDisplay();
    collectionCookieSection.style.display = "block";
  } catch (err) {
    itemsBody.innerHTML = '<tr><td colspan="6" class="empty-row">Unable to load collection items.</td></tr>';
    collectionCookieSection.style.display = "none";
    setStatus(`Unable to load items: ${err.message}`, true);
  }
}

function updateCollectionCookieDisplay() {
  if (currentCollectionCookie) {
    currentCookieFile.textContent = currentCollectionCookie;
    clearCookieBtn.style.display = "inline-block";
    deleteCookieBtn.style.display = "inline-block";
  } else {
    currentCookieFile.textContent = "(none)";
    clearCookieBtn.style.display = "none";
    deleteCookieBtn.style.display = "none";
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
    itemsBody.innerHTML = '<tr><td colspan="6" class="empty-row">No collection entries found.</td></tr>';
    updateHeaderCheckboxState();
    return;
  }

  const downloadRoot = configData?.download_root || "";
  const sortedItems = sortItems(items);
  const isCustomSort = currentSortBy === "custom";

  sortedItems.forEach((item) => {
    const row = document.createElement("tr");
    const fullPath = downloadRoot && item.folder ? `${downloadRoot.replace(/\\$/, "")}${downloadRoot.endsWith("/") || item.folder.startsWith("/") ? "" : "/"}${item.folder}` : item.folder;
    const urlDisplay = getUrlDisplayText(item.url || "");

    if (isCustomSort) {
      row.classList.add("draggable-row");
      row.setAttribute("draggable", "true");
      row.dataset.itemId = item.id;
    }

    row.innerHTML = `
      <td><input type="checkbox" class="item-checkbox" data-item-id="${item.id}" /></td>
      <td>${item.id || ""}</td>
      <td>${item.name || ""}</td>
      <td title="${fullPath}"><span class="folder-value">${item.folder || ""}</span></td>
      <td class="url-cell"><a href="${item.url || "#"}" target="_blank" rel="noreferrer" title="${item.url || ""}">${urlDisplay}</a></td>
      <td class="actions-cell">
        <button class="action-button edit-item" data-item-id="${item.id}">Edit</button>
        <button class="action-button danger delete-item" data-item-id="${item.id}">Delete</button>
      </td>
    `;
    itemsBody.appendChild(row);
  });
  updateHeaderCheckboxState();
  
  // Add or remove drag-and-drop listeners based on sort mode
  if (isCustomSort) {
    addDragDropListeners();
  } else {
    removeDragDropListeners();
  }
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

  try {
    await sendJson("/api/config", "PUT", {
      download_root: downloadRoot,
      filename_template: configFilenameTemplate.value.trim(),
      video_codec: configVideoCodec.value.trim(),
      restrict_filenames: configRestrictFilenames.checked,
      max_concurrent_downloads: Number(configMaxDownloads.value) || 1,
      default_collection_file: configDefaultCollection.value.trim(),
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

function updateHeaderCheckboxState() {
  const checkboxes = Array.from(document.querySelectorAll(".item-checkbox"));
  if (checkboxes.length === 0) {
    headerSelectAll.checked = false;
    headerSelectAll.indeterminate = false;
    return;
  }
  
  const checkedCount = checkboxes.filter(cb => cb.checked).length;
  const totalCount = checkboxes.length;
  
  if (checkedCount === 0) {
    headerSelectAll.checked = false;
    headerSelectAll.indeterminate = false;
  } else if (checkedCount === totalCount) {
    headerSelectAll.checked = true;
    headerSelectAll.indeterminate = false;
  } else {
    headerSelectAll.checked = false;
    headerSelectAll.indeterminate = true;
  }
}

function toggleSelection(selectAll) {
  const checkboxes = Array.from(document.querySelectorAll(".item-checkbox"));
  checkboxes.forEach((checkbox) => {
    checkbox.checked = selectAll;
  });
  updateHeaderCheckboxState();
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
const sortBySelect = document.getElementById("sort-by");
const sortDirectionBtn = document.getElementById("sort-direction");
sortBySelect?.addEventListener("change", handleSortByChange);
sortDirectionBtn?.addEventListener("click", handleSortDirectionToggle);
newFileButton.addEventListener("click", openNewFileModal);
setDefaultButton.addEventListener("click", setDefaultCollectionFile);
deleteFileButton.addEventListener("click", deleteCollectionFile);
openConfigButton.addEventListener("click", openConfigEditor);
addItemButton.addEventListener("click", () => openItemModal());
selectAllButton.addEventListener("click", () => toggleSelection(true));
selectNoneButton.addEventListener("click", () => toggleSelection(false));
downloadSelectedButton.addEventListener("click", startDownload);
headerSelectAll.addEventListener("change", () => {
  toggleSelection(headerSelectAll.checked);
});
itemsBody.addEventListener("click", (event) => {
  // Handle row checkbox changes
  if (event.target.classList.contains("item-checkbox")) {
    updateHeaderCheckboxState();
  }
  // Handle other item actions (edit, delete)
  handleItemActions(event);
});
jobsList.addEventListener("click", handleJobActions);
modalBackdrop.addEventListener("click", () => {
  closeModal(newFileModal);
  closeModal(itemModal);
  closeModal(configModal);
  closeModal(logModal);
  closeModal(cookieSelectModal);
});
newFileForm.addEventListener("submit", submitNewFileForm);
itemForm.addEventListener("submit", submitItemForm);
configForm.addEventListener("submit", submitConfigForm);

// Cookie-related event listeners
uploadCookieBtn.addEventListener("click", () => {
  cookieFileUpload.click();
});
cookieFileUpload.addEventListener("change", handleCookieFileUpload);
selectCookieBtn.addEventListener("click", openCookieSelectModal);
clearCookieBtn.addEventListener("click", clearCollectionCookie);
deleteCookieBtn.addEventListener("click", handleDeleteCookie);
applyCookieBtn.addEventListener("click", applySelectedCookie);

Array.from(document.querySelectorAll("[data-close]")).forEach((button) => {
  button.addEventListener("click", closeOpenModal);
});

// Cookie-related functions
async function handleCookieFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const fileName = getCurrentFile();
  if (!fileName) {
    setStatus("No collection file selected.", true);
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  try {
    await fetch(`/api/collection-files/${encodeURIComponent(fileName)}/cookie/upload`, {
      method: "POST",
      body: formData
    });

    // Reload collection items to get updated cookie info
    await loadCollectionItems(fileName);
    setStatus(`Uploaded and set cookie file: ${file.name}`);
  } catch (err) {
    setStatus(`Unable to upload cookie file: ${err.message}`, true);
  } finally {
    // Reset file input
    cookieFileUpload.value = "";
  }
}

async function openCookieSelectModal() {
  const fileName = getCurrentFile();
  if (!fileName) {
    setStatus("No collection file selected.", true);
    return;
  }

  try {
    // Fetch available cookie files
    const data = await fetchJson("/api/cookie-files");
    const cookieFiles = data.cookie_files || [];

    // Populate select dropdown
    cookieFileSelect.innerHTML = "";
    
    // Add "None" option
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "(none)";
    cookieFileSelect.appendChild(noneOption);

    // Add available cookie files
    cookieFiles.forEach(cookieFile => {
      const option = document.createElement("option");
      option.value = cookieFile;
      option.textContent = cookieFile;
      if (cookieFile === currentCollectionCookie) {
        option.selected = true;
      }
      cookieFileSelect.appendChild(option);
    });

    openModal(cookieSelectModal);
  } catch (err) {
    setStatus(`Unable to load cookie files: ${err.message}`, true);
  }
}

async function applySelectedCookie() {
  const fileName = getCurrentFile();
  if (!fileName) {
    setStatus("No collection file selected.", true);
    return;
  }

  const selectedCookie = cookieFileSelect.value || null;

  try {
    await sendJson(`/api/collection-files/${encodeURIComponent(fileName)}/cookie`, "PUT", {
      cookie_file: selectedCookie
    });

    // Update local state and UI
    currentCollectionCookie = selectedCookie;
    updateCollectionCookieDisplay();
    closeModal(cookieSelectModal);
    setStatus(`Set cookie file: ${selectedCookie || "(none)"}`);
  } catch (err) {
    setStatus(`Unable to set cookie file: ${err.message}`, true);
  }
}

async function clearCollectionCookie() {
  const fileName = getCurrentFile();
  if (!fileName) {
    setStatus("No collection file selected.", true);
    return;
  }

  try {
    await sendJson(`/api/collection-files/${encodeURIComponent(fileName)}/cookie`, "PUT", {
      cookie_file: null
    });

    // Update local state and UI
    currentCollectionCookie = null;
    updateCollectionCookieDisplay();
    setStatus("Cleared collection cookie file.");
  } catch (err) {
    setStatus(`Unable to clear cookie file: ${err.message}`, true);
  }
}

async function handleDeleteCookie() {
  const fileName = getCurrentFile();
  if (!fileName) {
    setStatus("No collection file selected.", true);
    return;
  }

  if (!currentCollectionCookie) {
    setStatus("No cookie file to delete.", true);
    return;
  }

  if (!confirm(`Delete cookie file '${currentCollectionCookie}'? This action cannot be undone.`)) {
    return;
  }

  try {
    await fetch(`/api/cookie-files/${encodeURIComponent(currentCollectionCookie)}`, {
      method: "DELETE"
    });

    // Update local state and UI
    currentCollectionCookie = null;
    updateCollectionCookieDisplay();
    
    // Refresh cookie list in selection modal if open
    if (!cookieSelectModal.classList.contains("hidden")) {
      await openCookieSelectModal();
    }
    
    setStatus(`Deleted cookie file: ${currentCollectionCookie}`);
  } catch (err) {
    setStatus(`Unable to delete cookie file: ${err.message}`, true);
  }
}

// Drag-and-drop handlers
function addDragDropListeners() {
  const rows = Array.from(itemsBody.querySelectorAll("tr[draggable='true']"));
  rows.forEach(row => {
    row.addEventListener("dragstart", handleDragStart);
    row.addEventListener("dragover", handleDragOver);
    row.addEventListener("drop", handleDrop);
    row.addEventListener("dragend", handleDragEnd);
    row.addEventListener("dragleave", handleDragLeave);
  });
  itemsBody.addEventListener("dragover", handleBodyDragOver);
  itemsBody.addEventListener("drop", handleDrop);
}

function removeDragDropListeners() {
  const rows = Array.from(itemsBody.querySelectorAll("tr[draggable='true']"));
  rows.forEach(row => {
    row.removeEventListener("dragstart", handleDragStart);
    row.removeEventListener("dragover", handleDragOver);
    row.removeEventListener("drop", handleDrop);
    row.removeEventListener("dragend", handleDragEnd);
    row.removeEventListener("dragleave", handleDragLeave);
  });
  itemsBody.removeEventListener("dragover", handleBodyDragOver);
  itemsBody.removeEventListener("drop", handleDrop);
}

function handleDragStart(event) {
  draggedItemId = event.currentTarget.dataset.itemId;
  draggedRow = event.currentTarget;
  event.currentTarget.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/html", event.currentTarget.innerHTML);
}

function clearActiveDropTarget() {
  if (activeDropTarget) {
    activeDropTarget.classList.remove("drag-over-row");
    activeDropTarget.classList.remove("drag-over-row-bottom");
  }
  activeDropTarget = null;
  dropPosition = "before";
}

function handleBodyDragOver(event) {
  if (!draggedRow) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  const rows = Array.from(itemsBody.querySelectorAll("tr[data-item-id]"));
  if (rows.length === 0) {
    clearActiveDropTarget();
    return;
  }

  const targetRow = rows.find(row => {
    const rowRect = row.getBoundingClientRect();
    return event.clientY < rowRect.bottom && event.clientY >= rowRect.top;
  });

  if (!targetRow || targetRow === draggedRow) {
    clearActiveDropTarget();
    return;
  }

  const rowRect = targetRow.getBoundingClientRect();
  const position = event.clientY < rowRect.top + rowRect.height / 2 ? "before" : "after";

  if (activeDropTarget !== targetRow || dropPosition !== position) {
    clearActiveDropTarget();
    if (position === "before") {
      targetRow.classList.add("drag-over-row");
    } else {
      targetRow.classList.add("drag-over-row-bottom");
    }
    activeDropTarget = targetRow;
    dropPosition = position;
  }
}

function handleDragOver(event) {
  if (!draggedRow || draggedRow === event.currentTarget) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.stopPropagation();
  handleBodyDragOver(event);
}

function handleDragLeave(event) {
  if (event.currentTarget === event.target) {
    const nextTarget = event.relatedTarget;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      event.currentTarget.classList.remove("drag-over-row");
      event.currentTarget.classList.remove("drag-over-row-bottom");
      if (activeDropTarget === event.currentTarget) {
        clearActiveDropTarget();
      }
    }
  }
}

function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  
  const dropRow = activeDropTarget;
  if (!draggedRow || !dropRow || draggedRow === dropRow) {
    return;
  }

  const rows = Array.from(itemsBody.querySelectorAll("tr[data-item-id]"));
  const orderedIds = [];
  let inserted = false;
  
  rows.forEach((row) => {
    if (row === draggedRow) {
      return;
    }

    if (row === dropRow) {
      if (dropPosition === "before") {
        orderedIds.push(draggedItemId);
      }
      orderedIds.push(row.dataset.itemId);
      if (dropPosition === "after") {
        orderedIds.push(draggedItemId);
      }
      inserted = true;
      return;
    }

    orderedIds.push(row.dataset.itemId);
  });

  if (!inserted) {
    orderedIds.push(draggedItemId);
  }

  clearActiveDropTarget();
  
  // Persist the new order to the backend
  const fileName = getCurrentFile();
  if (fileName) {
    sendJson(`/api/collection-items/reorder?file=${encodeURIComponent(fileName)}`, "PUT", {
      ordered_ids: orderedIds
    }).then(() => {
      // Reload collection items to update the display
      loadCollectionItems(fileName);
      setStatus("Items reordered successfully.");
    }).catch(err => {
      setStatus(`Failed to reorder items: ${err.message}`, true);
    });
  }
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove("dragging");
  clearActiveDropTarget();
  draggedItemId = null;
  draggedRow = null;
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadConfig();
  await loadJobs();
  // Load collection items for the default/selected file
  const selectedFile = fileSelect.value;
  if (selectedFile) {
    await loadCollectionItems(selectedFile);
  }
});
