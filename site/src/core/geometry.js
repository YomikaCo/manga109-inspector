// @ts-check

/** @typedef {import('../types/manga109').Manga109BoundingBox} Manga109BoundingBox */
/** @typedef {import('../types/manga109').Manga109ImageDimensions} Manga109ImageDimensions */

/**
 * Maps annotation-space coordinates into decoded image-space coordinates.
 * Independent X/Y scales intentionally handle a dimension mismatch without
 * visually drifting away from the underlying image.
 * @param {Manga109BoundingBox} box
 * @param {Manga109ImageDimensions} annotationSize
 * @param {Manga109ImageDimensions} imageSize
 */
export function scaleBoundingBox(box, annotationSize, imageSize) {
  const scaleX = imageSize.width / annotationSize.width;
  const scaleY = imageSize.height / annotationSize.height;
  return {
    xmin: box.xmin * scaleX,
    ymin: box.ymin * scaleY,
    xmax: box.xmax * scaleX,
    ymax: box.ymax * scaleY,
  };
}

/**
 * @param {Manga109ImageDimensions} image
 * @param {Manga109ImageDimensions} viewport
 * @param {number} padding
 */
export function calculateFitScale(image, viewport, padding = 24) {
  if (image.width <= 0 || image.height <= 0) return 1;
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  return Math.min(1, availableWidth / image.width, availableHeight / image.height);
}
