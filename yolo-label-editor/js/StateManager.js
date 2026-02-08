import { LabelParser } from './LabelParser.js';

/**
 * State Manager
 * Manages application state, undo/redo functionality, and modification tracking
 */
export class StateManager {
    constructor() {
        // Current image index
        this.currentIndex = -1;

        // Per-image state storage
        // Map<index, { boxes, originalBoxes, undoStack, redoStack }>
        this.imageStates = new Map();

        // Global modification tracking
        this.globalModified = new Set();

        // Max undo/redo stack size per image
        this.maxStackSize = 50;
    }

    /**
     * Initialize state for an image
     * @param {number} index
     * @param {Array} boxes
     */
    initImageState(index, boxes) {
        if (!this.imageStates.has(index)) {
            const clonedBoxes = LabelParser.cloneBoxes(boxes);
            this.imageStates.set(index, {
                boxes: clonedBoxes,
                originalBoxes: LabelParser.cloneBoxes(boxes),
                undoStack: [],
                redoStack: []
            });
        }
        this.currentIndex = index;
    }

    /**
     * Set the current image index
     * @param {number} index
     */
    setCurrentIndex(index) {
        this.currentIndex = index;
    }

    /**
     * Get current image's boxes
     * @returns {Array}
     */
    getCurrentBoxes() {
        const state = this.imageStates.get(this.currentIndex);
        return state ? state.boxes : [];
    }

    /**
     * Set current image's boxes (replaces all boxes)
     * @param {Array} boxes
     */
    setCurrentBoxes(boxes) {
        const state = this.imageStates.get(this.currentIndex);
        if (state) {
            state.boxes = LabelParser.cloneBoxes(boxes);
        }
    }

    /**
     * Record an action for undo
     * @param {string} type - Action type ('delete', 'restore', etc.)
     * @param {Array} affectedBoxes - Boxes affected by this action
     * @param {Object} extraData - Any additional data needed to undo
     */
    recordAction(type, affectedBoxes, extraData = {}) {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return;

        const action = {
            type,
            boxes: affectedBoxes.map(b => LabelParser.cloneBox(b)),
            timestamp: Date.now(),
            ...extraData
        };

        state.undoStack.push(action);

        // Trim stack if too large
        if (state.undoStack.length > this.maxStackSize) {
            state.undoStack.shift();
        }

        // Clear redo stack on new action
        state.redoStack = [];
    }

    /**
     * Undo the last action
     * @returns {boolean} True if undo was performed
     */
    undo() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state || state.undoStack.length === 0) {
            return false;
        }

        const action = state.undoStack.pop();

        // Reverse the action
        if (action.type === 'delete') {
            // Restore deleted boxes
            for (const savedBox of action.boxes) {
                const box = state.boxes.find(b => b.id === savedBox.id);
                if (box) {
                    box.deleted = false;
                    box.selected = false;
                }
            }
        } else if (action.type === 'restore') {
            // Re-delete restored boxes
            for (const savedBox of action.boxes) {
                const box = state.boxes.find(b => b.id === savedBox.id);
                if (box) {
                    box.deleted = true;
                    box.selected = false;
                }
            }
        }

        state.redoStack.push(action);
        this.updateModifiedState();

        return true;
    }

    /**
     * Redo the last undone action
     * @returns {boolean} True if redo was performed
     */
    redo() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state || state.redoStack.length === 0) {
            return false;
        }

        const action = state.redoStack.pop();

        // Re-apply the action
        if (action.type === 'delete') {
            // Re-delete boxes
            for (const savedBox of action.boxes) {
                const box = state.boxes.find(b => b.id === savedBox.id);
                if (box) {
                    box.deleted = true;
                    box.selected = false;
                }
            }
        } else if (action.type === 'restore') {
            // Restore boxes again
            for (const savedBox of action.boxes) {
                const box = state.boxes.find(b => b.id === savedBox.id);
                if (box) {
                    box.deleted = false;
                    box.selected = false;
                }
            }
        }

        state.undoStack.push(action);
        this.updateModifiedState();

        return true;
    }

    /**
     * Check if undo is available
     * @returns {boolean}
     */
    canUndo() {
        const state = this.imageStates.get(this.currentIndex);
        return state ? state.undoStack.length > 0 : false;
    }

    /**
     * Check if redo is available
     * @returns {boolean}
     */
    canRedo() {
        const state = this.imageStates.get(this.currentIndex);
        return state ? state.redoStack.length > 0 : false;
    }

    /**
     * Mark selected boxes as deleted
     * @returns {number} Number of boxes deleted
     */
    deleteSelected() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return 0;

        const selected = state.boxes.filter(b => b.selected && !b.deleted);

        if (selected.length === 0) return 0;

        // Record for undo
        this.recordAction('delete', selected);

        // Mark as deleted
        for (const box of selected) {
            box.deleted = true;
            box.selected = false;
        }

        this.markModified();
        return selected.length;
    }

    /**
     * Restore deleted boxes (all or selected)
     * @param {boolean} onlySelected - Only restore selected deleted boxes
     * @returns {number} Number of boxes restored
     */
    restoreDeleted(onlySelected = false) {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return 0;

        const toRestore = onlySelected
            ? state.boxes.filter(b => b.deleted && b.selected)
            : state.boxes.filter(b => b.deleted);

        if (toRestore.length === 0) return 0;

        // Record for undo
        this.recordAction('restore', toRestore);

        // Restore
        for (const box of toRestore) {
            box.deleted = false;
            box.selected = false;
        }

        this.markModified();
        return toRestore.length;
    }

    /**
     * Select all boxes
     */
    selectAll() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return;

        for (const box of state.boxes) {
            if (!box.deleted) {
                box.selected = true;
            }
        }
    }

    /**
     * Clear selection
     */
    clearSelection() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return;

        for (const box of state.boxes) {
            box.selected = false;
        }
    }

    /**
     * Toggle selection on a single box
     * @param {string} boxId
     */
    toggleBoxSelection(boxId) {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return;

        const box = state.boxes.find(b => b.id === boxId);
        if (box && !box.deleted) {
            box.selected = !box.selected;
        }
    }

    /**
     * Select a single box (clearing other selections)
     * @param {string} boxId
     */
    selectBox(boxId) {
        this.clearSelection();
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return;

        const box = state.boxes.find(b => b.id === boxId);
        if (box && !box.deleted) {
            box.selected = true;
        }
    }

    /**
     * Get count of selected boxes
     * @returns {number}
     */
    getSelectedCount() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return 0;
        return state.boxes.filter(b => b.selected && !b.deleted).length;
    }

    /**
     * Get count of non-deleted boxes
     * @returns {number}
     */
    getBoxCount() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return 0;
        return state.boxes.filter(b => !b.deleted).length;
    }

    /**
     * Get count of deleted boxes
     * @returns {number}
     */
    getDeletedCount() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return 0;
        return state.boxes.filter(b => b.deleted).length;
    }

    /**
     * Mark current image as modified
     */
    markModified() {
        this.globalModified.add(this.currentIndex);
    }

    /**
     * Update modified state based on current vs original boxes
     */
    updateModifiedState() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return;

        // Check if current state differs from original
        let hasChanges = false;

        for (const box of state.boxes) {
            const original = state.originalBoxes.find(o => o.id === box.id);
            if (!original || box.deleted !== original.deleted) {
                hasChanges = true;
                break;
            }
        }

        if (hasChanges) {
            this.globalModified.add(this.currentIndex);
        } else {
            this.globalModified.delete(this.currentIndex);
        }
    }

    /**
     * Check if current image is modified
     * @returns {boolean}
     */
    isCurrentModified() {
        return this.globalModified.has(this.currentIndex);
    }

    /**
     * Check if a specific image is modified
     * @param {number} index
     * @returns {boolean}
     */
    isModified(index) {
        return this.globalModified.has(index);
    }

    /**
     * Get count of modified images
     * @returns {number}
     */
    getModifiedCount() {
        return this.globalModified.size;
    }

    /**
     * Get all modified image indices
     * @returns {Set<number>}
     */
    getModifiedIndices() {
        return new Set(this.globalModified);
    }

    /**
     * Mark current image as saved
     * Updates original boxes to match current state
     */
    markSaved() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return;

        // Update original to match current (excluding deleted boxes)
        const nonDeleted = state.boxes.filter(b => !b.deleted);
        state.originalBoxes = LabelParser.cloneBoxes(nonDeleted);
        state.boxes = LabelParser.cloneBoxes(nonDeleted);
        state.undoStack = [];
        state.redoStack = [];

        this.globalModified.delete(this.currentIndex);
    }

    /**
     * Mark a specific image as saved
     * @param {number} index
     */
    markSavedAt(index) {
        const prevIndex = this.currentIndex;
        this.currentIndex = index;
        this.markSaved();
        this.currentIndex = prevIndex;
    }

    /**
     * Get boxes for saving (non-deleted only)
     * @returns {Array}
     */
    getBoxesForSave() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return [];
        return state.boxes.filter(b => !b.deleted);
    }

    /**
     * Check if there are any unsaved changes across all images
     * @returns {boolean}
     */
    hasUnsavedChanges() {
        return this.globalModified.size > 0;
    }

    /**
     * Clear state for a specific image
     * @param {number} index
     */
    clearImageState(index) {
        this.imageStates.delete(index);
        this.globalModified.delete(index);
    }

    /**
     * Clear all state
     */
    clearAll() {
        this.imageStates.clear();
        this.globalModified.clear();
        this.currentIndex = -1;
    }

    /**
     * Reset current image to original state
     */
    resetCurrent() {
        const state = this.imageStates.get(this.currentIndex);
        if (!state) return;

        state.boxes = LabelParser.cloneBoxes(state.originalBoxes);
        state.undoStack = [];
        state.redoStack = [];
        this.globalModified.delete(this.currentIndex);
    }
}
