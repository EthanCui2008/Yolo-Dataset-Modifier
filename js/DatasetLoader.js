import { LRUCache } from './LRUCache.js';
import { LabelParser } from './LabelParser.js';

/**
 * Dataset Loader
 * Manages loading and caching of YOLO dataset images and labels
 * Handles lazy loading for large datasets
 */
export class DatasetLoader {
    constructor(fileManager) {
        this.fileManager = fileManager;

        // Dataset index - lightweight metadata for all images
        this.index = [];

        // Image cache (LRU)
        this.imageCache = new LRUCache(10);

        // Label cache (keep more since they're small)
        this.labelCache = new Map();

        // Drop mode data (for drag-and-drop fallback)
        this.dropModeImages = null;
        this.dropModeLabels = null;

        // Loading state
        this.isLoading = false;
    }

    /**
     * Load a dataset from the file manager
     * @returns {Promise<number>} Number of images loaded
     */
    async loadDataset() {
        this.isLoading = true;
        this.clear();

        try {
            const images = await this.fileManager.scanImages();
            const labels = await this.fileManager.scanLabels();

            // Build index pairing images with labels
            for (const image of images) {
                const baseName = this.fileManager.getBaseName(image.name);
                const labelHandle = labels.get(baseName);

                this.index.push({
                    name: image.name,
                    baseName: baseName,
                    imageHandle: image.handle,
                    labelHandle: labelHandle || null,
                    hasLabel: !!labelHandle,
                    modified: false,
                    boxCount: null  // Will be loaded on demand
                });
            }

            return this.index.length;
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Load a dataset from dropped files (fallback mode)
     * @param {Object} dropData - {images: Array, labels: Map}
     * @returns {Promise<number>} Number of images loaded
     */
    async loadFromDrop(dropData) {
        this.isLoading = true;
        this.clear();

        try {
            this.dropModeImages = new Map();
            this.dropModeLabels = dropData.labels;

            for (const image of dropData.images) {
                const baseName = this.fileManager.getBaseName(image.name);
                const labelFile = dropData.labels.get(baseName);

                this.dropModeImages.set(image.name, image.file);

                this.index.push({
                    name: image.name,
                    baseName: baseName,
                    imageHandle: null,
                    labelHandle: null,
                    imageFile: image.file,
                    labelFile: labelFile || null,
                    hasLabel: !!labelFile,
                    modified: false,
                    boxCount: null
                });
            }

            return this.index.length;
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Get the total number of images in the dataset
     * @returns {number}
     */
    get count() {
        return this.index.length;
    }

    /**
     * Get image entry at index
     * @param {number} index
     * @returns {Object|null}
     */
    getEntry(index) {
        return this.index[index] || null;
    }

    /**
     * Get all entries (for list rendering)
     * @returns {Array}
     */
    getAllEntries() {
        return this.index;
    }

    /**
     * Load an image by index
     * @param {number} index
     * @returns {Promise<ImageBitmap|null>}
     */
    async loadImage(index) {
        if (index < 0 || index >= this.index.length) {
            return null;
        }

        // Check cache first
        const cached = this.imageCache.get(index);
        if (cached) {
            return cached;
        }

        const entry = this.index[index];

        try {
            let bitmap;

            if (entry.imageHandle) {
                // File System Access API mode
                bitmap = await this.fileManager.readImage(entry.imageHandle);
            } else if (entry.imageFile) {
                // Drag-and-drop mode
                bitmap = await this.fileManager.readImageFromFile(entry.imageFile);
            } else {
                return null;
            }

            // Cache the bitmap
            this.imageCache.set(index, bitmap);

            return bitmap;
        } catch (e) {
            console.error(`Error loading image ${entry.name}:`, e);
            return null;
        }
    }

    /**
     * Load labels for an image by index
     * @param {number} index
     * @returns {Promise<Array>} Array of box objects
     */
    async loadLabels(index) {
        if (index < 0 || index >= this.index.length) {
            return [];
        }

        // Check cache first
        if (this.labelCache.has(index)) {
            return LabelParser.cloneBoxes(this.labelCache.get(index));
        }

        const entry = this.index[index];

        if (!entry.hasLabel) {
            // No label file - return empty array
            this.labelCache.set(index, []);
            entry.boxCount = 0;
            return [];
        }

        try {
            let content;

            if (entry.labelHandle) {
                // File System Access API mode
                content = await this.fileManager.readLabel(entry.labelHandle);
            } else if (entry.labelFile) {
                // Drag-and-drop mode
                content = await this.fileManager.readLabelFromFile(entry.labelFile);
            } else {
                return [];
            }

            const boxes = LabelParser.parse(content);

            // Cache the boxes
            this.labelCache.set(index, boxes);
            entry.boxCount = boxes.length;

            return LabelParser.cloneBoxes(boxes);
        } catch (e) {
            console.error(`Error loading labels for ${entry.name}:`, e);
            return [];
        }
    }

    /**
     * Save labels for an image
     * @param {number} index
     * @param {Array} boxes
     * @returns {Promise<boolean>}
     */
    async saveLabels(index, boxes) {
        if (index < 0 || index >= this.index.length) {
            return false;
        }

        const entry = this.index[index];
        const content = LabelParser.serialize(boxes);

        // If no label file exists, create one
        if (!entry.labelHandle && !entry.labelFile) {
            if (this.fileManager.isReadOnly) {
                // Download as fallback
                this.fileManager.downloadFile(entry.baseName + '.txt', content);
                return true;
            }

            const newHandle = await this.fileManager.createLabelFile(entry.name);
            if (newHandle) {
                entry.labelHandle = newHandle;
                entry.hasLabel = true;
            } else {
                // Fallback to download
                this.fileManager.downloadFile(entry.baseName + '.txt', content);
                return true;
            }
        }

        // Save using File System Access API
        if (entry.labelHandle) {
            const success = await this.fileManager.saveLabel(entry.labelHandle, content);
            if (success) {
                // Update cache
                this.labelCache.set(index, LabelParser.cloneBoxes(boxes));
                entry.boxCount = boxes.filter(b => !b.deleted).length;
                entry.modified = false;
            }
            return success;
        }

        // Fallback: download
        this.fileManager.downloadFile(entry.baseName + '.txt', content);
        return true;
    }

    /**
     * Mark an entry as modified
     * @param {number} index
     */
    markModified(index) {
        if (index >= 0 && index < this.index.length) {
            this.index[index].modified = true;
        }
    }

    /**
     * Mark an entry as saved (not modified)
     * @param {number} index
     */
    markSaved(index) {
        if (index >= 0 && index < this.index.length) {
            this.index[index].modified = false;
        }
    }

    /**
     * Check if an entry is modified
     * @param {number} index
     * @returns {boolean}
     */
    isModified(index) {
        if (index >= 0 && index < this.index.length) {
            return this.index[index].modified;
        }
        return false;
    }

    /**
     * Get count of modified entries
     * @returns {number}
     */
    getModifiedCount() {
        return this.index.filter(e => e.modified).length;
    }

    /**
     * Get all modified entries
     * @returns {Array<{index: number, entry: Object}>}
     */
    getModifiedEntries() {
        const modified = [];
        this.index.forEach((entry, index) => {
            if (entry.modified) {
                modified.push({ index, entry });
            }
        });
        return modified;
    }

    /**
     * Preload adjacent images for smoother navigation
     * @param {number} currentIndex
     * @param {number} range - Number of images to preload on each side
     */
    async preloadAdjacent(currentIndex, range = 2) {
        const promises = [];

        for (let i = -range; i <= range; i++) {
            if (i === 0) continue; // Skip current

            const targetIndex = currentIndex + i;
            if (targetIndex >= 0 && targetIndex < this.index.length) {
                // Don't await - let them load in parallel
                promises.push(
                    this.loadImage(targetIndex).catch(() => null)
                );
            }
        }

        // Wait for all to complete (but don't block)
        Promise.all(promises).catch(() => { });
    }

    /**
     * Search images by name
     * @param {string} query
     * @returns {Array<{index: number, entry: Object}>}
     */
    search(query) {
        if (!query || query.trim() === '') {
            return this.index.map((entry, index) => ({ index, entry }));
        }

        const lowerQuery = query.toLowerCase();
        const results = [];

        this.index.forEach((entry, index) => {
            if (entry.name.toLowerCase().includes(lowerQuery)) {
                results.push({ index, entry });
            }
        });

        return results;
    }

    /**
     * Update the label cache for an index (used after editing)
     * @param {number} index
     * @param {Array} boxes
     */
    updateLabelCache(index, boxes) {
        if (index >= 0 && index < this.index.length) {
            this.labelCache.set(index, LabelParser.cloneBoxes(boxes));
            this.index[index].boxCount = boxes.filter(b => !b.deleted).length;
        }
    }

    /**
     * Clear all cached data
     */
    clear() {
        this.index = [];
        this.imageCache.clear();
        this.labelCache.clear();
        this.dropModeImages = null;
        this.dropModeLabels = null;
    }

    /**
     * Get statistics about the dataset
     * @returns {Object}
     */
    getStats() {
        const total = this.index.length;
        const withLabels = this.index.filter(e => e.hasLabel).length;
        const modified = this.index.filter(e => e.modified).length;

        return {
            total,
            withLabels,
            withoutLabels: total - withLabels,
            modified
        };
    }
}
