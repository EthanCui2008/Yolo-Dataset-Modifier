import { FileManager } from './FileManager.js';
import { DatasetLoader } from './DatasetLoader.js';
import { StateManager } from './StateManager.js';
import { LabelParser } from './LabelParser.js';

const ui = {
    // Toolbar buttons
    btnLoad: document.getElementById('btn-load'),
    btnSave: document.getElementById('btn-save'),
    btnSaveAll: document.getElementById('btn-save-all'),
    btnUndo: document.getElementById('btn-undo'),
    btnRedo: document.getElementById('btn-redo'),
    btnDelete: document.getElementById('btn-delete'),
    btnSelectAll: document.getElementById('btn-select-all'),
    btnZoomFit: document.getElementById('btn-zoom-fit'),
    btnZoomIn: document.getElementById('btn-zoom-in'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    btnHelp: document.getElementById('btn-help'),

    // Sidebar
    sidebar: document.getElementById('sidebar'),
    resizeHandle: document.getElementById('resize-handle'),
    imageCount: document.getElementById('image-count'),
    searchImages: document.getElementById('search-images'),
    imageList: document.getElementById('image-list'),

    // Canvas
    canvasContainer: document.getElementById('canvas-container'),
    canvas: document.getElementById('main-canvas'),
    dropZone: document.getElementById('drop-zone'),

    // Status bar
    statusImage: document.getElementById('status-image'),
    statusBoxes: document.getElementById('status-boxes'),
    statusSelected: document.getElementById('status-selected'),
    statusModified: document.getElementById('status-modified'),
    statusZoom: document.getElementById('status-zoom'),
    statusPosition: document.getElementById('status-position'),

    // Modals
    shortcutsModal: document.getElementById('shortcuts-modal'),
    closeShortcuts: document.getElementById('close-shortcuts'),
    gotoModal: document.getElementById('goto-modal'),
    closeGoto: document.getElementById('close-goto'),
    gotoCancel: document.getElementById('goto-cancel'),
    gotoConfirm: document.getElementById('goto-confirm'),
    gotoInput: document.getElementById('goto-input'),
    gotoMax: document.getElementById('goto-max'),

    // Notifications
    notifications: document.getElementById('notifications')
};

const fileManager = new FileManager();
const datasetLoader = new DatasetLoader(fileManager);
const stateManager = new StateManager();

let currentIndex = -1;
let currentBitmap = null;
let currentImageWidth = 0;
let currentImageHeight = 0;

let zoom = 1; // 1 = fit-to-screen zoom
let selectionRect = null; // {x1,y1,x2,y2} in canvas pixels
let selectionPointerId = null;

const ctx = ui.canvas.getContext('2d', { alpha: false, desynchronized: true });

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function showNotification(message, type = 'info', timeoutMs = 2400) {
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.textContent = message;
    ui.notifications.appendChild(el);

    const remove = () => {
        if (!el.isConnected) return;
        el.classList.add('removing');
        setTimeout(() => el.remove(), 200);
    };

    setTimeout(remove, timeoutMs);
    el.addEventListener('click', remove);
}

function setLoading(isLoading) {
    ui.canvasContainer.classList.toggle('loading', isLoading);
}

function clearCurrentImage() {
    currentBitmap = null;
    currentImageWidth = 0;
    currentImageHeight = 0;
}

function hasDatasetLoaded() {
    return datasetLoader.count > 0;
}

function hasImageSelected() {
    return currentIndex >= 0 && currentIndex < datasetLoader.count;
}

function updateToolbarState() {
    const datasetLoaded = hasDatasetLoaded();
    const imageSelected = hasImageSelected();

    ui.btnSave.disabled = !imageSelected || !stateManager.isCurrentModified();
    ui.btnSaveAll.disabled = !datasetLoaded || stateManager.getModifiedCount() === 0;

    ui.btnUndo.disabled = !imageSelected || !stateManager.canUndo();
    ui.btnRedo.disabled = !imageSelected || !stateManager.canRedo();

    ui.btnDelete.disabled = !imageSelected || stateManager.getSelectedCount() === 0;
    ui.btnSelectAll.disabled = !imageSelected || stateManager.getBoxCount() === 0;

    ui.btnZoomFit.disabled = !imageSelected;
    ui.btnZoomIn.disabled = !imageSelected;
    ui.btnZoomOut.disabled = !imageSelected;
}

function updateStatusBar() {
    if (!hasImageSelected()) {
        ui.statusImage.textContent = 'No image loaded';
        ui.statusBoxes.textContent = '0 boxes';
        ui.statusSelected.textContent = '0 selected';
        ui.statusModified.classList.add('hidden');
        ui.statusZoom.textContent = 'Zoom: 100%';
        ui.statusPosition.textContent = '-';
        return;
    }

    const entry = datasetLoader.getEntry(currentIndex);
    ui.statusImage.textContent = `${currentIndex + 1}/${datasetLoader.count} - ${entry?.name ?? ''}`;
    ui.statusBoxes.textContent = `${stateManager.getBoxCount()} boxes`;
    ui.statusSelected.textContent = `${stateManager.getSelectedCount()} selected`;
    ui.statusModified.classList.toggle('hidden', !stateManager.isCurrentModified());
    ui.statusZoom.textContent = `Zoom: ${Math.round(zoom * 100)}%`;
}

function getCanvasCssSize() {
    const rect = ui.canvas.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
}

function resizeCanvasToContainer() {
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = getCanvasCssSize();
    const nextW = Math.max(1, Math.floor(w * dpr));
    const nextH = Math.max(1, Math.floor(h * dpr));
    if (ui.canvas.width !== nextW || ui.canvas.height !== nextH) {
        ui.canvas.width = nextW;
        ui.canvas.height = nextH;
    }
}

function getFitScale(canvasPxW, canvasPxH) {
    if (!currentBitmap || currentImageWidth <= 0 || currentImageHeight <= 0) return 1;
    return Math.min(canvasPxW / currentImageWidth, canvasPxH / currentImageHeight);
}

function getViewTransform() {
    const canvasW = ui.canvas.width;
    const canvasH = ui.canvas.height;
    const fit = getFitScale(canvasW, canvasH);
    const scale = fit * zoom;

    const drawW = currentImageWidth * scale;
    const drawH = currentImageHeight * scale;
    const offsetX = (canvasW - drawW) / 2;
    const offsetY = (canvasH - drawH) / 2;

    return { scale, offsetX, offsetY };
}

function canvasClientToCanvasPx(clientX, clientY) {
    const rect = ui.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
        x: (clientX - rect.left) * dpr,
        y: (clientY - rect.top) * dpr
    };
}

function canvasPxToImagePx(canvasX, canvasY) {
    const { scale, offsetX, offsetY } = getViewTransform();
    return {
        x: (canvasX - offsetX) / scale,
        y: (canvasY - offsetY) / scale
    };
}

function imagePxToCanvasPx(imgX, imgY) {
    const { scale, offsetX, offsetY } = getViewTransform();
    return {
        x: offsetX + imgX * scale,
        y: offsetY + imgY * scale
    };
}

function getBoxCanvasRect(box) {
    const pixel = LabelParser.toPixelCoords(box, currentImageWidth, currentImageHeight);
    const p1 = imagePxToCanvasPx(pixel.x, pixel.y);
    const p2 = imagePxToCanvasPx(pixel.x + pixel.w, pixel.y + pixel.h);
    return {
        x: p1.x,
        y: p1.y,
        w: p2.x - p1.x,
        h: p2.y - p1.y
    };
}

function draw() {
    resizeCanvasToContainer();

    const canvasW = ui.canvas.width;
    const canvasH = ui.canvas.height;

    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, canvasW, canvasH);

    if (!currentBitmap) return;

    const { scale, offsetX, offsetY } = getViewTransform();

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
        currentBitmap,
        0,
        0,
        currentImageWidth,
        currentImageHeight,
        offsetX,
        offsetY,
        currentImageWidth * scale,
        currentImageHeight * scale
    );

    const boxes = stateManager.getCurrentBoxes();
    const dpr = window.devicePixelRatio || 1;
    const lineW = clamp(2 * dpr, 2, 4 * dpr);

    for (const box of boxes) {
        if (box.deleted) continue;
        const r = getBoxCanvasRect(box);

        ctx.lineWidth = lineW;
        ctx.strokeStyle = box.selected ? '#4caf50' : '#64c8ff';
        ctx.strokeRect(r.x, r.y, r.w, r.h);

        ctx.font = `${Math.max(10 * dpr, 10)}px sans-serif`;
        const label = String(box.classId);
        const pad = 3 * dpr;
        const textW = ctx.measureText(label).width;
        const bgH = 14 * dpr;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(r.x, r.y - bgH, textW + pad * 2, bgH);
        ctx.fillStyle = '#e8e8e8';
        ctx.fillText(label, r.x + pad, r.y - 4 * dpr);
    }

    if (selectionRect) {
        const x1 = Math.min(selectionRect.x1, selectionRect.x2);
        const y1 = Math.min(selectionRect.y1, selectionRect.y2);
        const x2 = Math.max(selectionRect.x1, selectionRect.x2);
        const y2 = Math.max(selectionRect.y1, selectionRect.y2);
        ctx.strokeStyle = 'rgba(100,200,255,0.9)';
        ctx.lineWidth = lineW;
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(100,200,255,0.12)';
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    }
}

// --- app logic wired up below ---

function setDropZoneVisible(visible) {
    ui.dropZone.classList.toggle('hidden', !visible);
}

function syncModifiedFlag(index) {
    if (stateManager.isModified(index)) {
        datasetLoader.markModified(index);
    } else {
        datasetLoader.markSaved(index);
    }
}

function makeImageItem(entry, index) {
    const item = document.createElement('div');
    item.className = 'image-item';
    item.dataset.index = String(index);

    const status = document.createElement('div');
    status.className = 'image-item-status clean';
    status.textContent = '•';

    const name = document.createElement('div');
    name.className = 'image-item-name';
    name.textContent = entry.name;

    const count = document.createElement('div');
    count.className = 'image-item-count';
    count.textContent = entry.boxCount == null ? '-' : String(entry.boxCount);

    item.appendChild(status);
    item.appendChild(name);
    item.appendChild(count);

    item.addEventListener('click', () => {
        const idx = Number(item.dataset.index);
        if (!Number.isFinite(idx)) return;
        selectImage(idx).catch((e) => {
            console.error(e);
            showNotification('Failed to load image', 'error');
        });
    });

    return item;
}

function updateImageItemElement(el, index) {
    const entry = datasetLoader.getEntry(index);
    if (!entry) return;

    const statusEl = el.querySelector('.image-item-status');
    const countEl = el.querySelector('.image-item-count');

    if (statusEl) {
        statusEl.classList.remove('clean', 'modified', 'missing');
        if (!entry.hasLabel) {
            statusEl.classList.add('missing');
            statusEl.textContent = '!';
            statusEl.title = 'Missing label file';
        } else if (entry.modified || stateManager.isModified(index)) {
            statusEl.classList.add('modified');
            statusEl.textContent = '●';
            statusEl.title = 'Modified';
        } else {
            statusEl.classList.add('clean');
            statusEl.textContent = '•';
            statusEl.title = 'Saved';
        }
    }

    if (countEl) {
        countEl.textContent = entry.boxCount == null ? '-' : String(entry.boxCount);
    }
}

function renderImageList(indices) {
    ui.imageList.textContent = '';

    for (const index of indices) {
        const entry = datasetLoader.getEntry(index);
        if (!entry) continue;
        const item = makeImageItem(entry, index);
        if (index === currentIndex) item.classList.add('active');
        ui.imageList.appendChild(item);
        updateImageItemElement(item, index);
    }
}

function refreshVisibleListItems() {
    const children = ui.imageList.querySelectorAll('.image-item');
    for (const el of children) {
        const idx = Number(el.dataset.index);
        if (!Number.isFinite(idx)) continue;
        el.classList.toggle('active', idx === currentIndex);
        updateImageItemElement(el, idx);
    }
}

function updateImageCountLabel(filteredCount = null) {
    const total = datasetLoader.count;
    if (filteredCount == null || filteredCount === total) {
        ui.imageCount.textContent = `${total} images`;
    } else {
        ui.imageCount.textContent = `${filteredCount} / ${total} images`;
    }
    ui.gotoMax.textContent = String(total);
    ui.gotoInput.max = String(Math.max(1, total));
}

function getAllIndices() {
    const indices = [];
    for (let i = 0; i < datasetLoader.count; i++) indices.push(i);
    return indices;
}

function applySearchFilter() {
    const q = ui.searchImages.value ?? '';
    const results = datasetLoader.search(q);
    const indices = results.map(r => r.index);
    renderImageList(indices);
    updateImageCountLabel(indices.length);
}

async function resetAppState() {
    clearCurrentImage();
    currentIndex = -1;
    zoom = 1;
    selectionRect = null;
    selectionPointerId = null;
    stateManager.clearAll();
    ui.searchImages.value = '';
    ui.imageList.textContent = '';
    ui.imageCount.textContent = '0 images';
    setDropZoneVisible(true);
    updateToolbarState();
    updateStatusBar();
    draw();
}

async function loadFromFolderPicker() {
    setLoading(true);
    try {
        const root = await fileManager.openFolder();
        if (!root) return;

        await resetAppState();

        const count = await datasetLoader.loadDataset();
        if (count <= 0) {
            showNotification('No images found in selected folder', 'warning');
            setDropZoneVisible(true);
            updateToolbarState();
            updateStatusBar();
            return;
        }

        setDropZoneVisible(false);
        renderImageList(getAllIndices());
        updateImageCountLabel();
        showNotification(`Loaded ${count} images`, 'success');
        updateToolbarState();
        updateStatusBar();
        draw();
    } finally {
        setLoading(false);
    }
}

async function loadFromDrop(items) {
    setLoading(true);
    try {
        await resetAppState();

        const dropData = await fileManager.handleDrop(items);
        const count = await datasetLoader.loadFromDrop(dropData);
        if (count <= 0) {
            showNotification('No images found in dropped folder', 'warning');
            setDropZoneVisible(true);
            return;
        }

        setDropZoneVisible(false);
        renderImageList(getAllIndices());
        updateImageCountLabel();
        showNotification(`Loaded ${count} images (read-only)`, 'info');
        updateToolbarState();
        updateStatusBar();
        draw();
    } finally {
        setLoading(false);
    }
}

async function selectImage(index) {
    if (index < 0 || index >= datasetLoader.count) return;

    setLoading(true);
    try {
        currentIndex = index;
        selectionRect = null;

        const [bitmap, labels] = await Promise.all([
            datasetLoader.loadImage(index),
            datasetLoader.loadLabels(index)
        ]);

        if (!bitmap) {
            showNotification('Image failed to load', 'error');
            return;
        }

        currentBitmap = bitmap;
        currentImageWidth = bitmap.width;
        currentImageHeight = bitmap.height;

        stateManager.initImageState(index, labels);
        syncModifiedFlag(index);

        datasetLoader.updateLabelCache(index, stateManager.getCurrentBoxes());

        zoom = 1;

        refreshVisibleListItems();
        updateToolbarState();
        updateStatusBar();
        draw();

        datasetLoader.preloadAdjacent(index).catch(() => { });
    } finally {
        setLoading(false);
    }
}

function getBoxUnderPoint(imageX, imageY) {
    const boxes = stateManager.getCurrentBoxes();
    for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (b.deleted) continue;
        const pixel = LabelParser.toPixelCoords(b, currentImageWidth, currentImageHeight);
        if (
            imageX >= pixel.x &&
            imageX <= pixel.x + pixel.w &&
            imageY >= pixel.y &&
            imageY <= pixel.y + pixel.h
        ) {
            return b;
        }
    }
    return null;
}

function finalizeSelectionRect(addToSelection = true) {
    if (!selectionRect) return;
    const x1 = Math.min(selectionRect.x1, selectionRect.x2);
    const y1 = Math.min(selectionRect.y1, selectionRect.y2);
    const x2 = Math.max(selectionRect.x1, selectionRect.x2);
    const y2 = Math.max(selectionRect.y1, selectionRect.y2);

    if (Math.abs(x2 - x1) < 3 || Math.abs(y2 - y1) < 3) return;

    const imgA = canvasPxToImagePx(x1, y1);
    const imgB = canvasPxToImagePx(x2, y2);

    const rectImg = {
        x: Math.min(imgA.x, imgB.x),
        y: Math.min(imgA.y, imgB.y),
        w: Math.abs(imgB.x - imgA.x),
        h: Math.abs(imgB.y - imgA.y)
    };

    if (!addToSelection) stateManager.clearSelection();

    const boxes = stateManager.getCurrentBoxes();
    for (const b of boxes) {
        if (b.deleted) continue;
        const pixel = LabelParser.toPixelCoords(b, currentImageWidth, currentImageHeight);
        const intersects = LabelParser.rectsIntersect(
            { x: rectImg.x, y: rectImg.y, w: rectImg.w, h: rectImg.h },
            { x: pixel.x, y: pixel.y, w: pixel.w, h: pixel.h }
        );
        if (intersects) b.selected = true;
    }
}

function doDeleteSelected(goNext = false) {
    if (!hasImageSelected()) return;
    const deleted = stateManager.deleteSelected();
    if (deleted <= 0) return;

    syncModifiedFlag(currentIndex);
    datasetLoader.updateLabelCache(currentIndex, stateManager.getCurrentBoxes());

    showNotification(`Deleted ${deleted} box${deleted === 1 ? '' : 'es'}`, 'success');
    refreshVisibleListItems();
    updateToolbarState();
    updateStatusBar();
    draw();

    if (goNext) {
        const next = Math.min(datasetLoader.count - 1, currentIndex + 1);
        if (next !== currentIndex) {
            selectImage(next).catch(() => { });
        }
    }
}

function doUndo() {
    if (!hasImageSelected()) return;
    if (!stateManager.undo()) return;
    syncModifiedFlag(currentIndex);
    datasetLoader.updateLabelCache(currentIndex, stateManager.getCurrentBoxes());
    refreshVisibleListItems();
    updateToolbarState();
    updateStatusBar();
    draw();
}

function doRedo() {
    if (!hasImageSelected()) return;
    if (!stateManager.redo()) return;
    syncModifiedFlag(currentIndex);
    datasetLoader.updateLabelCache(currentIndex, stateManager.getCurrentBoxes());
    refreshVisibleListItems();
    updateToolbarState();
    updateStatusBar();
    draw();
}

async function doSaveCurrent() {
    if (!hasImageSelected()) return;
    if (!stateManager.isCurrentModified()) return;

    setLoading(true);
    try {
        const boxesForSave = stateManager.getBoxesForSave();
        const ok = await datasetLoader.saveLabels(currentIndex, boxesForSave);
        if (!ok) {
            showNotification('Save failed', 'error');
            return;
        }

        stateManager.markSaved();
        datasetLoader.markSaved(currentIndex);
        datasetLoader.updateLabelCache(currentIndex, stateManager.getCurrentBoxes());

        showNotification('Saved', 'success');
        refreshVisibleListItems();
        updateToolbarState();
        updateStatusBar();
        draw();
    } finally {
        setLoading(false);
    }
}

async function doSaveAll() {
    const modified = [...stateManager.getModifiedIndices()];
    if (modified.length === 0) return;

    setLoading(true);
    try {
        if (fileManager.isReadOnly) {
            const modifiedLabels = new Map();
            for (const idx of modified) {
                stateManager.setCurrentIndex(idx);
                const entry = datasetLoader.getEntry(idx);
                if (!entry) continue;
                const boxesForSave = stateManager.getBoxesForSave();
                modifiedLabels.set(entry.baseName + '.txt', LabelParser.serialize(boxesForSave));
            }
            await fileManager.downloadAllAsZip(modifiedLabels);

            for (const idx of modified) {
                stateManager.markSavedAt(idx);
                datasetLoader.markSaved(idx);
                stateManager.setCurrentIndex(idx);
                datasetLoader.updateLabelCache(idx, stateManager.getCurrentBoxes());
            }
            stateManager.setCurrentIndex(currentIndex);
            showNotification('Downloaded modified labels (zip)', 'success');
        } else {
            for (const idx of modified) {
                stateManager.setCurrentIndex(idx);
                const boxesForSave = stateManager.getBoxesForSave();
                const ok = await datasetLoader.saveLabels(idx, boxesForSave);
                if (!ok) {
                    showNotification('Save all: some files failed', 'warning');
                    break;
                }
                stateManager.markSavedAt(idx);
                datasetLoader.markSaved(idx);
                stateManager.setCurrentIndex(idx);
                datasetLoader.updateLabelCache(idx, stateManager.getCurrentBoxes());
            }
            stateManager.setCurrentIndex(currentIndex);
            showNotification('Saved all modified', 'success');
        }

        refreshVisibleListItems();
        updateToolbarState();
        updateStatusBar();
        draw();
    } finally {
        setLoading(false);
    }
}

function zoomIn() {
    if (!hasImageSelected()) return;
    zoom = clamp(zoom * 1.25, 0.05, 20);
    updateStatusBar();
    draw();
}

function zoomOut() {
    if (!hasImageSelected()) return;
    zoom = clamp(zoom / 1.25, 0.05, 20);
    updateStatusBar();
    draw();
}

function zoomFit() {
    if (!hasImageSelected()) return;
    zoom = 1;
    updateStatusBar();
    draw();
}

function navigate(delta) {
    if (!hasDatasetLoaded()) return;
    const next = clamp((hasImageSelected() ? currentIndex : 0) + delta, 0, datasetLoader.count - 1);
    selectImage(next).catch(() => { });
}

function showGotoModal() {
    if (!hasDatasetLoaded()) return;
    ui.gotoMax.textContent = String(datasetLoader.count);
    ui.gotoInput.min = '1';
    ui.gotoInput.max = String(Math.max(1, datasetLoader.count));
    ui.gotoInput.value = String(hasImageSelected() ? currentIndex + 1 : 1);
    ui.gotoModal.showModal();
    ui.gotoInput.focus();
    ui.gotoInput.select?.();
}

function showShortcutsModal() {
    ui.shortcutsModal.showModal();
}

function closeDialogSafe(dialog) {
    if (!dialog) return;
    try { dialog.close(); } catch { /* ignore */ }
}

function isAnyDialogOpen() {
    return (ui.shortcutsModal?.open || ui.gotoModal?.open) === true;
}

// --- event wiring below ---

// Toolbar hooks
ui.btnLoad.addEventListener('click', () => loadFromFolderPicker().catch(console.error));
ui.btnSave.addEventListener('click', () => doSaveCurrent().catch(console.error));
ui.btnSaveAll.addEventListener('click', () => doSaveAll().catch(console.error));
ui.btnUndo.addEventListener('click', doUndo);
ui.btnRedo.addEventListener('click', doRedo);
ui.btnDelete.addEventListener('click', () => doDeleteSelected(false));
ui.btnSelectAll.addEventListener('click', () => {
    if (!hasImageSelected()) return;
    stateManager.selectAll();
    updateToolbarState();
    updateStatusBar();
    draw();
});
ui.btnZoomFit.addEventListener('click', zoomFit);
ui.btnZoomIn.addEventListener('click', zoomIn);
ui.btnZoomOut.addEventListener('click', zoomOut);
ui.btnHelp.addEventListener('click', showShortcutsModal);

ui.searchImages.addEventListener('input', applySearchFilter);

// Dialog hooks
ui.closeShortcuts.addEventListener('click', () => closeDialogSafe(ui.shortcutsModal));
ui.shortcutsModal.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialogSafe(ui.shortcutsModal);
});

ui.closeGoto.addEventListener('click', () => closeDialogSafe(ui.gotoModal));
ui.gotoCancel.addEventListener('click', () => closeDialogSafe(ui.gotoModal));
ui.gotoConfirm.addEventListener('click', () => {
    const n = Number(ui.gotoInput.value);
    if (!Number.isFinite(n)) return;
    const idx = clamp(n - 1, 0, datasetLoader.count - 1);
    closeDialogSafe(ui.gotoModal);
    selectImage(idx).catch(() => { });
});
ui.gotoModal.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialogSafe(ui.gotoModal);
});
ui.gotoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ui.gotoConfirm.click();
});

// Sidebar resize
(() => {
    const stored = Number(localStorage.getItem('sidebarWidth') || '');
    if (Number.isFinite(stored) && stored > 0) {
        ui.sidebar.style.width = `${clamp(stored, 200, 500)}px`;
    }

    let dragging = false;
    const onMove = (e) => {
        if (!dragging) return;
        const rect = ui.sidebar.getBoundingClientRect();
        const next = clamp(e.clientX - rect.left, 200, 500);
        ui.sidebar.style.width = `${next}px`;
        localStorage.setItem('sidebarWidth', String(next));
        draw();
    };
    const onUp = () => { dragging = false; };

    ui.resizeHandle.addEventListener('mousedown', () => { dragging = true; });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
})();

// Drop handling
(() => {
    const prevent = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    ui.canvasContainer.addEventListener('dragenter', prevent);
    ui.canvasContainer.addEventListener('dragover', (e) => {
        prevent(e);
        ui.dropZone.classList.add('drag-over');
    });
    ui.canvasContainer.addEventListener('dragleave', (e) => {
        prevent(e);
        ui.dropZone.classList.remove('drag-over');
    });
    ui.canvasContainer.addEventListener('drop', (e) => {
        prevent(e);
        ui.dropZone.classList.remove('drag-over');
        if (e.dataTransfer?.items) {
            loadFromDrop(e.dataTransfer.items).catch(console.error);
        }
    });
})();

// Canvas interaction
ui.canvas.addEventListener('pointerdown', (e) => {
    if (!hasImageSelected() || isAnyDialogOpen()) return;
    if (e.button !== 0) return;

    ui.canvas.setPointerCapture(e.pointerId);

    const pos = canvasClientToCanvasPx(e.clientX, e.clientY);
    const img = canvasPxToImagePx(pos.x, pos.y);

    if (e.shiftKey) {
        selectionPointerId = e.pointerId;
        selectionRect = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
        ui.canvasContainer.classList.add('selecting');
        draw();
        return;
    }

    const box = getBoxUnderPoint(img.x, img.y);
    if (!box) {
        stateManager.clearSelection();
    } else if (e.ctrlKey || e.metaKey) {
        stateManager.toggleBoxSelection(box.id);
    } else {
        stateManager.selectBox(box.id);
    }

    updateToolbarState();
    updateStatusBar();
    draw();
});

ui.canvas.addEventListener('pointermove', (e) => {
    if (!hasImageSelected()) return;

    const pos = canvasClientToCanvasPx(e.clientX, e.clientY);
    const img = canvasPxToImagePx(pos.x, pos.y);
    if (Number.isFinite(img.x) && Number.isFinite(img.y)) {
        const x = Math.round(clamp(img.x, 0, currentImageWidth));
        const y = Math.round(clamp(img.y, 0, currentImageHeight));
        ui.statusPosition.textContent = `X: ${x}  Y: ${y}`;
    } else {
        ui.statusPosition.textContent = '-';
    }

    if (selectionRect && e.pointerId === selectionPointerId) {
        selectionRect.x2 = pos.x;
        selectionRect.y2 = pos.y;
        draw();
    }
});

ui.canvas.addEventListener('pointerup', (e) => {
    if (selectionRect && e.pointerId === selectionPointerId) {
        finalizeSelectionRect(true);
        selectionRect = null;
        selectionPointerId = null;
        ui.canvasContainer.classList.remove('selecting');
        updateToolbarState();
        updateStatusBar();
        draw();
    }
});

ui.canvas.addEventListener('pointercancel', () => {
    selectionRect = null;
    selectionPointerId = null;
    ui.canvasContainer.classList.remove('selecting');
    draw();
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    if (isAnyDialogOpen()) {
        if (e.key === 'Escape') {
            closeDialogSafe(ui.shortcutsModal);
            closeDialogSafe(ui.gotoModal);
        }
        return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        loadFromFolderPicker().catch(console.error);
        return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        doSaveCurrent().catch(console.error);
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        doSaveAll().catch(console.error);
        return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        doUndo();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        doRedo();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        if (!hasImageSelected()) return;
        stateManager.selectAll();
        updateToolbarState();
        updateStatusBar();
        draw();
        return;
    }

    if (!hasDatasetLoaded()) return;

    if (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        navigate(-1);
        return;
    }
    if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        navigate(1);
        return;
    }
    if (e.key === 'Home') {
        e.preventDefault();
        selectImage(0).catch(() => { });
        return;
    }
    if (e.key === 'End') {
        e.preventDefault();
        selectImage(datasetLoader.count - 1).catch(() => { });
        return;
    }

    if (e.key === 'Delete' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        doDeleteSelected(false);
        return;
    }

    if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        doDeleteSelected(true);
        return;
    }

    if (e.key === 'Escape') {
        e.preventDefault();
        stateManager.clearSelection();
        updateToolbarState();
        updateStatusBar();
        draw();
        return;
    }

    if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        zoomFit();
        return;
    }
    if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
        return;
    }
    if (e.key === '-') {
        e.preventDefault();
        zoomOut();
        return;
    }

    if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        showGotoModal();
        return;
    }

    if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        showShortcutsModal();
    }
});

// Warn about unsaved changes
window.addEventListener('beforeunload', (e) => {
    if (stateManager.hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// Initial sizing and state
new ResizeObserver(() => {
    draw();
}).observe(ui.canvasContainer);

resetAppState().catch(() => { });
updateToolbarState();
updateStatusBar();
draw();
