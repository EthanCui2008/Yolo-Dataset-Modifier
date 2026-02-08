/**
 * YOLO Label Parser
 * Handles parsing and serialization of YOLO format label files
 * Format: class_id x_center y_center width height (all values normalized 0-1)
 */
export class LabelParser {
    /**
     * Parse YOLO label file content into box objects
     * @param {string} content - Raw file content
     * @returns {Array<Object>} Array of box objects
     */
    static parse(content) {
        const boxes = [];

        if (!content || content.trim() === '') {
            return boxes;
        }

        const lines = content.trim().split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Skip empty lines and comments
            if (!line || line.startsWith('#')) {
                continue;
            }

            const parts = line.split(/\s+/);

            // YOLO format requires at least 5 values
            if (parts.length >= 5) {
                const classId = parseInt(parts[0], 10);
                const xCenter = parseFloat(parts[1]);
                const yCenter = parseFloat(parts[2]);
                const width = parseFloat(parts[3]);
                const height = parseFloat(parts[4]);

                // Validate values
                if (
                    !isNaN(classId) && classId >= 0 &&
                    !isNaN(xCenter) && xCenter >= 0 && xCenter <= 1 &&
                    !isNaN(yCenter) && yCenter >= 0 && yCenter <= 1 &&
                    !isNaN(width) && width > 0 && width <= 1 &&
                    !isNaN(height) && height > 0 && height <= 1
                ) {
                    boxes.push({
                        id: crypto.randomUUID(),
                        classId,
                        xCenter,
                        yCenter,
                        width,
                        height,
                        deleted: false,
                        selected: false,
                        lineIndex: i  // Track original line for reference
                    });
                }
            }
        }

        return boxes;
    }

    /**
     * Serialize box objects back to YOLO format string
     * @param {Array<Object>} boxes - Array of box objects
     * @returns {string} YOLO format string
     */
    static serialize(boxes) {
        return boxes
            .filter(box => !box.deleted)
            .map(box => {
                // Use 6 decimal places for precision (standard for YOLO)
                const xc = box.xCenter.toFixed(6);
                const yc = box.yCenter.toFixed(6);
                const w = box.width.toFixed(6);
                const h = box.height.toFixed(6);
                return `${box.classId} ${xc} ${yc} ${w} ${h}`;
            })
            .join('\n');
    }

    /**
     * Convert normalized YOLO coordinates to pixel coordinates
     * @param {Object} box - Box object with normalized coords
     * @param {number} imageWidth - Image width in pixels
     * @param {number} imageHeight - Image height in pixels
     * @returns {Object} Box with pixel coordinates {x, y, w, h}
     */
    static toPixelCoords(box, imageWidth, imageHeight) {
        const w = box.width * imageWidth;
        const h = box.height * imageHeight;
        const x = (box.xCenter * imageWidth) - (w / 2);
        const y = (box.yCenter * imageHeight) - (h / 2);

        return {
            id: box.id,
            classId: box.classId,
            x,
            y,
            w,
            h,
            deleted: box.deleted,
            selected: box.selected
        };
    }

    /**
     * Convert pixel coordinates back to normalized YOLO coordinates
     * @param {Object} pixelBox - Box with pixel coordinates
     * @param {number} imageWidth - Image width in pixels
     * @param {number} imageHeight - Image height in pixels
     * @returns {Object} Box with normalized coordinates
     */
    static toNormalizedCoords(pixelBox, imageWidth, imageHeight) {
        const xCenter = (pixelBox.x + pixelBox.w / 2) / imageWidth;
        const yCenter = (pixelBox.y + pixelBox.h / 2) / imageHeight;
        const width = pixelBox.w / imageWidth;
        const height = pixelBox.h / imageHeight;

        return {
            id: pixelBox.id,
            classId: pixelBox.classId,
            xCenter,
            yCenter,
            width,
            height,
            deleted: pixelBox.deleted,
            selected: pixelBox.selected
        };
    }

    /**
     * Get bounding box corners in pixel coordinates
     * Useful for intersection testing
     * @param {Object} box - Box object (normalized or pixel)
     * @param {number} imageWidth - Image width (only needed if box is normalized)
     * @param {number} imageHeight - Image height (only needed if box is normalized)
     * @returns {Object} {x1, y1, x2, y2} corners
     */
    static getCorners(box, imageWidth = null, imageHeight = null) {
        let x, y, w, h;

        // Check if box has pixel coords (x, y, w, h) or normalized (xCenter, yCenter, width, height)
        if ('x' in box && 'y' in box) {
            x = box.x;
            y = box.y;
            w = box.w;
            h = box.h;
        } else if (imageWidth && imageHeight) {
            const pixel = this.toPixelCoords(box, imageWidth, imageHeight);
            x = pixel.x;
            y = pixel.y;
            w = pixel.w;
            h = pixel.h;
        } else {
            throw new Error('Cannot get corners: need pixel coords or image dimensions');
        }

        return {
            x1: x,
            y1: y,
            x2: x + w,
            y2: y + h
        };
    }

    /**
     * Check if two rectangles intersect
     * @param {Object} rect1 - {x, y, w, h} or {x1, y1, x2, y2}
     * @param {Object} rect2 - {x, y, w, h} or {x1, y1, x2, y2}
     * @returns {boolean}
     */
    static rectsIntersect(rect1, rect2) {
        // Normalize to x1, y1, x2, y2 format
        const a = {
            x1: rect1.x1 ?? rect1.x,
            y1: rect1.y1 ?? rect1.y,
            x2: rect1.x2 ?? (rect1.x + rect1.w),
            y2: rect1.y2 ?? (rect1.y + rect1.h)
        };
        const b = {
            x1: rect2.x1 ?? rect2.x,
            y1: rect2.y1 ?? rect2.y,
            x2: rect2.x2 ?? (rect2.x + rect2.w),
            y2: rect2.y2 ?? (rect2.y + rect2.h)
        };

        return !(
            a.x2 < b.x1 ||
            b.x2 < a.x1 ||
            a.y2 < b.y1 ||
            b.y2 < a.y1
        );
    }

    /**
     * Check if a point is inside a box
     * @param {number} px - Point X
     * @param {number} py - Point Y
     * @param {Object} box - Box with x, y, w, h (pixel) or normalized coords
     * @param {number} imageWidth - Image width (only needed if normalized)
     * @param {number} imageHeight - Image height (only needed if normalized)
     * @returns {boolean}
     */
    static pointInBox(px, py, box, imageWidth = null, imageHeight = null) {
        const corners = this.getCorners(box, imageWidth, imageHeight);
        return (
            px >= corners.x1 &&
            px <= corners.x2 &&
            py >= corners.y1 &&
            py <= corners.y2
        );
    }

    /**
     * Deep clone a box object
     * @param {Object} box
     * @returns {Object}
     */
    static cloneBox(box) {
        return { ...box };
    }

    /**
     * Deep clone an array of boxes
     * @param {Array<Object>} boxes
     * @returns {Array<Object>}
     */
    static cloneBoxes(boxes) {
        return boxes.map(box => this.cloneBox(box));
    }
}
