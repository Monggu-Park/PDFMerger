const { PDFDocument } = window.PDFLib;

const supportedTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

const fileQueue = [];

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const previewList = document.getElementById("previewList");
const mergeButton = document.getElementById("mergeButton");
const clearButton = document.getElementById("clearButton");
const statusText = document.getElementById("statusText");
const previewTemplate = document.getElementById("previewTemplate");
let draggedItemId = null;
let dropTargetId = null;
let dropPosition = null;

const pdfjsLib = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (hasExternalFiles(event)) {
    dropzone.classList.add("is-dragover");
  }
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("is-dragover");
});

dropzone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragover");

  if (!hasExternalFiles(event)) {
    return;
  }

  const files = Array.from(event.dataTransfer?.files ?? []);
  await enqueueFiles(files);
});

dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files ?? []);
  await enqueueFiles(files);
  fileInput.value = "";
});

clearButton.addEventListener("click", () => {
  fileQueue.length = 0;
  renderQueue();
});

mergeButton.addEventListener("click", async () => {
  if (!fileQueue.length) {
    statusText.textContent = "Add files before merging.";
    return;
  }

  mergeButton.disabled = true;
  statusText.textContent = "Building PDF...";

  try {
    const mergedPdf = await PDFDocument.create();

    for (const item of fileQueue) {
      if (item.kind === "pdf") {
        const source = await PDFDocument.load(item.bytes.slice());
        const indices = source.getPageIndices();
        const copiedPages = await mergedPdf.copyPages(source, indices);
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        continue;
      }

      const image =
        item.kind === "png"
          ? await mergedPdf.embedPng(item.bytes)
          : await mergedPdf.embedJpg(item.bytes);
      const { width, height } = image.scale(1);
      const page = mergedPdf.addPage([width, height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width,
        height,
      });
    }

    const bytes = await mergedPdf.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `merged-${Date.now()}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);

    statusText.textContent = `${fileQueue.length} files · ${getTotalPages()} total pages exported.`;
  } catch (error) {
    console.error(error);
    statusText.textContent = "Merge failed. Please try again.";
  } finally {
    mergeButton.disabled = false;
  }
});

async function enqueueFiles(files) {
  const validFiles = files.filter((file) => {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    return supportedTypes.has(type) || [".pdf", ".png", ".jpg", ".jpeg"].some((ext) => name.endsWith(ext));
  });

  if (!validFiles.length) {
    statusText.textContent = "Only PDF, PNG, JPG, and JPEG files are supported.";
    return;
  }

  for (const file of validFiles) {
    const queueItem = await createQueueItem(file);
    fileQueue.push(queueItem);
  }

  renderQueue();
}

async function createQueueItem(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lowerName = file.name.toLowerCase();
  const kind = file.type === "application/pdf" || lowerName.endsWith(".pdf")
    ? "pdf"
    : file.type === "image/png" || lowerName.endsWith(".png")
      ? "png"
      : "jpg";

  const previewUrl =
    kind === "pdf" ? await createPdfPreview(bytes.slice()) : await createImagePreview(file);

  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    kind,
    pageCount: kind === "pdf" ? await getPdfPageCount(bytes.slice()) : 1,
    bytes,
    previewUrl,
  };
}

async function createImagePreview(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not create image preview."));
    reader.readAsDataURL(file);
  });
}

async function createPdfPreview(bytes) {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(220 / viewport.width, 280 / viewport.height);
  const scaledViewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;
  await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
  return canvas.toDataURL("image/png");
}

async function getPdfPageCount(bytes) {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  return pdf.numPages;
}

function renderQueue() {
  previewList.innerHTML = "";

  fileQueue.forEach((item, index) => {
    const fragment = previewTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".preview-card");
    const thumb = fragment.querySelector(".preview-card__thumb");
    const badge = fragment.querySelector(".preview-card__badge");
    const indexText = fragment.querySelector(".preview-card__index");
    const nameText = fragment.querySelector(".preview-card__name");
    const detailsText = fragment.querySelector(".preview-card__details");
    const removeButton = fragment.querySelector(".preview-card__remove");
    card.dataset.id = item.id;

    thumb.src = item.previewUrl;
    thumb.alt = `${item.name} preview`;
    badge.textContent = item.kind.toUpperCase();
    indexText.textContent = `#${String(index + 1).padStart(2, "0")}`;
    nameText.textContent = item.name;
    detailsText.textContent = `${formatFileSize(item.size)} · ${formatPageCount(item.pageCount)}`;

    removeButton.addEventListener("click", () => {
      const itemIndex = fileQueue.findIndex((entry) => entry.id === item.id);
      if (itemIndex >= 0) {
        fileQueue.splice(itemIndex, 1);
        renderQueue();
      }
    });

    card.addEventListener("dragstart", (event) => {
      draggedItemId = item.id;
      card.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
    });

    card.addEventListener("dragend", () => {
      draggedItemId = null;
      dropTargetId = null;
      dropPosition = null;
      clearDropTargets();
      card.classList.remove("is-dragging");
    });

    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!draggedItemId || draggedItemId === item.id) {
        return;
      }
      event.dataTransfer.dropEffect = "move";
      clearDropTargets();
      const bounds = card.getBoundingClientRect();
      const nextPosition = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
      dropTargetId = item.id;
      dropPosition = nextPosition;
      card.classList.add(nextPosition === "before" ? "is-drop-before" : "is-drop-after");
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("is-drop-before", "is-drop-after");
    });

    card.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!draggedItemId || draggedItemId === item.id) {
        return;
      }

      moveQueueItem(draggedItemId, item.id, dropPosition ?? "before");
    });

    card.style.animationDelay = `${index * 45}ms`;
    previewList.appendChild(fragment);
  });

  const count = fileQueue.length;
  statusText.textContent = count
    ? `${count} files · ${getTotalPages()} total pages`
    : "No files added yet.";

  mergeButton.disabled = count === 0;
  clearButton.disabled = count === 0;
}

function formatFileSize(size) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPageCount(pageCount) {
  return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
}

function getTotalPages() {
  return fileQueue.reduce((total, item) => total + item.pageCount, 0);
}

function moveQueueItem(sourceId, targetId, position) {
  const sourceIndex = fileQueue.findIndex((entry) => entry.id === sourceId);
  const targetIndex = fileQueue.findIndex((entry) => entry.id === targetId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    clearDropTargets();
    return;
  }

  const [movedItem] = fileQueue.splice(sourceIndex, 1);
  const adjustedTargetIndex =
    sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertionIndex =
    position === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  fileQueue.splice(insertionIndex, 0, movedItem);
  draggedItemId = null;
  dropTargetId = null;
  dropPosition = null;
  clearDropTargets();
  renderQueue();
}

function clearDropTargets() {
  previewList.querySelectorAll(".is-drop-before, .is-drop-after").forEach((card) => {
    card.classList.remove("is-drop-before", "is-drop-after");
  });
}

function hasExternalFiles(event) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes("Files");
}

renderQueue();
