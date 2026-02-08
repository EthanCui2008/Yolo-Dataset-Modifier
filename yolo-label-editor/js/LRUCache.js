/**
 * LRU (Least Recently Used) Cache for efficient image memory management
 * Automatically evicts oldest entries when capacity is exceeded
 */
export class LRUCache {
    constructor(maxSize = 10) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    /**
     * Get an item from the cache
     * Moves the item to the end (most recently used)
     * @param {string|number} key
     * @returns {*} The cached value or null if not found
     */
    get(key) {
        if (!this.cache.has(key)) {
            return null;
        }
        // Move to end (most recently used)
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    /**
     * Set an item in the cache
     * If at capacity, removes the least recently used item
     * @param {string|number} key
     * @param {*} value
     */
    set(key, value) {
        // If key exists, delete it first (will be re-added at end)
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Delete oldest (first item in Map)
            const firstKey = this.cache.keys().next().value;
            const evicted = this.cache.get(firstKey);
            this.cache.delete(firstKey);
            // Clean up if it's an ImageBitmap
            if (evicted && typeof evicted.close === 'function') {
                evicted.close();
            }
        }
        this.cache.set(key, value);
    }

    /**
     * Check if a key exists in the cache
     * Does NOT update the access order
     * @param {string|number} key
     * @returns {boolean}
     */
    has(key) {
        return this.cache.has(key);
    }

    /**
     * Remove an item from the cache
     * @param {string|number} key
     * @returns {boolean} True if item was removed
     */
    delete(key) {
        if (this.cache.has(key)) {
            const value = this.cache.get(key);
            // Clean up if it's an ImageBitmap
            if (value && typeof value.close === 'function') {
                value.close();
            }
            return this.cache.delete(key);
        }
        return false;
    }

    /**
     * Clear all items from the cache
     */
    clear() {
        // Clean up all ImageBitmaps before clearing
        for (const value of this.cache.values()) {
            if (value && typeof value.close === 'function') {
                value.close();
            }
        }
        this.cache.clear();
    }

    /**
     * Get current cache size
     * @returns {number}
     */
    get size() {
        return this.cache.size;
    }

    /**
     * Get all keys in the cache (oldest to newest)
     * @returns {IterableIterator<string|number>}
     */
    keys() {
        return this.cache.keys();
    }

    /**
     * Get all values in the cache (oldest to newest)
     * @returns {IterableIterator<*>}
     */
    values() {
        return this.cache.values();
    }
}
