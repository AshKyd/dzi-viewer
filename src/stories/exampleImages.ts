// Example Deep Zoom images for stories, served from `static/dzi/`.
// The source photos were removed from `examples/`; restore them from git history to regenerate with:
// for f in examples/*.jpg; do vips dzsave "${f}[autorotate]" "static/dzi/$(basename "$f" .jpg)" --layout dz --tile-size 254 --overlap 1 --suffix ".webp[Q=80]"; done

/** Canal street with bikes and gabled houses, 4032×3024. */
export const CANAL_DZI = '/dzi/IMG_20190514_124400.dzi';

/** Harbour seen from a hill, with cruise ships and warehouses, 4032×3024. */
export const HARBOUR_DZI = '/dzi/IMG_20190623_165427.dzi';

/** Lakeside park with a fountain and apartment towers, 8160×6144. */
export const PARK_DZI = '/dzi/PXL_20260726_005325426.dzi';

/** Beach and town across the bay, with hills behind, 8160×6144. */
export const BEACH_DZI = '/dzi/PXL_20261009_051635422.dzi';
