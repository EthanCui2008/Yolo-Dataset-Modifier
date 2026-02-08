/**
 * File Manager
 * Handles File System Access API for folder loading and file saving
 * Falls back to drag-and-drop for browsers without File System Access API support
 */
export class FileManager {
    constructor() {
        this.rootHandle = null;
        this.imagesHandle = null;
        this.labelsHandle = null;
        this.supportsFileSystem = 'showDirectoryPicker' in window;
        this.isReadOnly = false;
    }

    /**
     * Check if File System Access API is supported
     * @returns {boolean}
     */
    get hasFileSystemAccess() {
        return this.supportsFileSystem;
    }

    /**
     * Open a folder using File System Access API
     * @returns {Promise<FileSystemDirectoryHandle|null>}
     */
    async openFolder() {
        if (!this.supportsFileSystem) {
            console.warn('File System Access API not supported');
            return null;
        }

        try {
            this.rootHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });
            this.isReadOnly = false;

            // Find images and labels folders
            await this.findSubfolders();

            return this.rootHandle;
        } catch (e) {
            if (e.name === 'AbortError') {
                // User cancelled
                return null;
            }
            // Try read-only mode
            try {
                this.rootHandle = await window.showDirectoryPicker({
                    mode: 'read'
                });
                this.isReadOnly = true;
                await this.findSubfolders();
                return this.rootHandle;
            } catch (e2) {
                if (e2.name !== 'AbortError') {
                    throw e2;
                }
                return null;
            }
        }
    }

    /**
     * Find images and labels subfolders
     */
    async findSubfolders() {
        if (!this.rootHandle) return;

        this.imagesHandle = null;
        this.labelsHandle = null;

        for await (const entry of this.rootHandle.values()) {
            if (entry.kind === 'directory') {
                const name = entry.name.toLowerCase();
                if (name === 'images' || name === 'train' || name === 'valid' || name === 'test') {
                    // Check if this directory contains images or has images/ subfolder
                    const hasImages = await this.checkForImages(entry);
                    if (hasImages) {
                        this.imagesHandle = entry;
                    }
                    // Also check for images/ and labels/ subfolders (common YOLO structure)
                    for await (const subEntry of entry.values()) {
                        if (subEntry.kind === 'directory') {
                            const subName = subEntry.name.toLowerCase();
                            if (subName === 'images') {
                                this.imagesHandle = subEntry;
                            } else if (subName === 'labels') {
                                this.labelsHandle = subEntry;
                            }
                        }
                    }
                } else if (name === 'labels') {
                    this.labelsHandle = entry;
                }
            }
        }

        // If we found images but not labels at the same level, look for labels folder
        if (this.imagesHandle && !this.labelsHandle) {
            // Look for labels folder at same level as images
            const parentHandle = await this.getParentOfHandle(this.imagesHandle);
            if (parentHandle) {
                for await (const entry of parentHandle.values()) {
                    if (entry.kind === 'directory' && entry.name.toLowerCase() === 'labels') {
                        this.labelsHandle = entry;
                        break;
                    }
                }
            }
        }
    }

    /**
     * Get parent handle (for nested folder structures)
     * Note: This is a simplified version - may not work for all cases
     */
    async getParentOfHandle(handle) {
        // The File System Access API doesn't provide direct parent access
        // For nested structures, we need to walk from the root
        return this.rootHandle;
    }

    /**
     * Check if a directory contains image files
     * @param {FileSystemDirectoryHandle} dirHandle
     * @returns {Promise<boolean>}
     */
    async checkForImages(dirHandle) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif'];
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
                const ext = this.getExtension(entry.name).toLowerCase();
                if (imageExtensions.includes(ext)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Scan the images folder and return file entries
     * @returns {Promise<Array<{name: string, handle: FileSystemFileHandle}>>}
     */
    async scanImages() {
        const images = [];

        if (!this.imagesHandle) {
            // If no images subfolder, scan root for images
            if (this.rootHandle) {
                await this.scanDirectoryForImages(this.rootHandle, images);
            }
        } else {
            await this.scanDirectoryForImages(this.imagesHandle, images);
        }

        // Sort by filename
        images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        return images;
    }

    /**
     * Recursively scan a directory for images
     * @param {FileSystemDirectoryHandle} dirHandle
     * @param {Array} results
     */
    async scanDirectoryForImages(dirHandle, results) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif'];

        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
                const ext = this.getExtension(entry.name).toLowerCase();
                if (imageExtensions.includes(ext)) {
                    results.push({
                        name: entry.name,
                        handle: entry
                    });
                }
            }
        }
    }

    /**
     * Scan the labels folder and return file entries as a map
     * @returns {Promise<Map<string, FileSystemFileHandle>>} Map of basename -> handle
     */
    async scanLabels() {
        const labels = new Map();

        if (!this.labelsHandle) {
            // If no labels subfolder, scan root for .txt files
            if (this.rootHandle) {
                await this.scanDirectoryForLabels(this.rootHandle, labels);
            }
        } else {
            await this.scanDirectoryForLabels(this.labelsHandle, labels);
        }

        return labels;
    }

    /**
     * Recursively scan a directory for label files
     * @param {FileSystemDirectoryHandle} dirHandle
     * @param {Map} results
     */
    async scanDirectoryForLabels(dirHandle, results) {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.txt')) {
                const baseName = this.getBaseName(entry.name);
                results.set(baseName, entry);
            }
        }
    }

    /**
     * Read a label file's content
     * @param {FileSystemFileHandle} handle
     * @returns {Promise<string>}
     */
    async readLabel(handle) {
        try {
            const file = await handle.getFile();
            return await file.text();
        } catch (e) {
            console.error('Error reading label file:', e);
            return '';
        }
    }

    /**
     * Read an image file as ImageBitmap
     * @param {FileSystemFileHandle} handle
     * @returns {Promise<ImageBitmap>}
     */
    async readImage(handle) {
        const file = await handle.getFile();
        return await createImageBitmap(file);
    }

    /**
     * Save label content to a file
     * @param {FileSystemFileHandle} handle
     * @param {string} content
     * @returns {Promise<boolean>}
     */
    async saveLabel(handle, content) {
        if (this.isReadOnly) {
            console.warn('Cannot save: file system is read-only');
            return false;
        }

        try {
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
            return true;
        } catch (e) {
            console.error('Error saving label file:', e);
            return false;
        }
    }

    /**
     * Create a new label file
     * @param {string} imageName - The image filename to base the label name on
     * @returns {Promise<FileSystemFileHandle|null>}
     */
    async createLabelFile(imageName) {
        if (this.isReadOnly) {
            console.warn('Cannot create file: file system is read-only');
            return null;
        }

        const labelName = this.getBaseName(imageName) + '.txt';
        const targetDir = this.labelsHandle || this.rootHandle;

        if (!targetDir) {
            return null;
        }

        try {
            const handle = await targetDir.getFileHandle(labelName, { create: true });
            return handle;
        } catch (e) {
            console.error('Error creating label file:', e);
            return null;
        }
    }

    /**
     * Download a file (fallback for when File System Access isn't available)
     * @param {string} filename
     * @param {string} content
     */
    downloadFile(filename, content) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Download multiple modified labels as a ZIP file
     * @param {Map<string, string>} modifiedLabels - Map of filename -> content
     */
    async downloadAllAsZip(modifiedLabels) {
        // Dynamic import of JSZip
        const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;

        const zip = new JSZip();
        const labelsFolder = zip.folder('labels');

        for (const [name, content] of modifiedLabels) {
            labelsFolder.file(name, content);
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'modified_labels.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Handle drag and drop of a folder (fallback mode)
     * @param {DataTransferItemList} items
     * @returns {Promise<{images: Array, labels: Map}>}
     */
    async handleDrop(items) {
        const images = [];
        const labels = new Map();
        this.isReadOnly = true;

        for (const item of items) {
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry?.();
                if (entry?.isDirectory) {
                    await this.scanDroppedDirectory(entry, images, labels);
                }
            }
        }

        // Sort images by filename
        images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        return { images, labels };
    }

    /**
     * Recursively scan a dropped directory
     * @param {FileSystemDirectoryEntry} entry
     * @param {Array} images
     * @param {Map} labels
     */
    async scanDroppedDirectory(entry, images, labels) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif'];

        const readEntries = (dirEntry) => {
            return new Promise((resolve, reject) => {
                const reader = dirEntry.createReader();
                const entries = [];
                const readBatch = () => {
                    reader.readEntries((batch) => {
                        if (batch.length === 0) {
                            resolve(entries);
                        } else {
                            entries.push(...batch);
                            readBatch();
                        }
                    }, reject);
                };
                readBatch();
            });
        };

        const getFile = (fileEntry) => {
            return new Promise((resolve, reject) => {
                fileEntry.file(resolve, reject);
            });
        };

        const entries = await readEntries(entry);

        for (const child of entries) {
            if (child.isDirectory) {
                const name = child.name.toLowerCase();
                // Recursively scan relevant directories
                if (name === 'images' || name === 'labels' || name === 'train' || name === 'valid' || name === 'test') {
                    await this.scanDroppedDirectory(child, images, labels);
                }
            } else if (child.isFile) {
                const ext = this.getExtension(child.name).toLowerCase();
                if (imageExtensions.includes(ext)) {
                    const file = await getFile(child);
                    images.push({
                        name: child.name,
                        file: file
                    });
                } else if (ext === '.txt') {
                    const file = await getFile(child);
                    const baseName = this.getBaseName(child.name);
                    labels.set(baseName, file);
                }
            }
        }
    }

    /**
     * Read a label from a dropped File object
     * @param {File} file
     * @returns {Promise<string>}
     */
    async readLabelFromFile(file) {
        return await file.text();
    }

    /**
     * Create ImageBitmap from a dropped File object
     * @param {File} file
     * @returns {Promise<ImageBitmap>}
     */
    async readImageFromFile(file) {
        return await createImageBitmap(file);
    }

    /**
     * Get file extension including the dot
     * @param {string} filename
     * @returns {string}
     */
    getExtension(filename) {
        const lastDot = filename.lastIndexOf('.');
        return lastDot >= 0 ? filename.substring(lastDot) : '';
    }

    /**
     * Get filename without extension
     * @param {string} filename
     * @returns {string}
     */
    getBaseName(filename) {
        const lastDot = filename.lastIndexOf('.');
        return lastDot >= 0 ? filename.substring(0, lastDot) : filename;
    }

    /**
     * Reset the file manager state
     */
    reset() {
        this.rootHandle = null;
        this.imagesHandle = null;
        this.labelsHandle = null;
        this.isReadOnly = false;
    }
}
