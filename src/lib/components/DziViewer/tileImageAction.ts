import type { ActionReturn } from 'svelte/action';
import type { CachedTile } from '../../types.js';

export interface AttachTileImageParams {
	readonly tile: CachedTile;
	/** Called once the tile's image is in the DOM. */
	readonly onMount: (key: string) => void;
	/** Called when the tile slot unmounts so re-mounting it later fades in cleanly. */
	readonly onUnmount: (key: string) => void;
}

function applyTileImageStyles(img: HTMLImageElement): void {
	img.style.width = '100%';
	img.style.height = '100%';
	img.style.display = 'block';
	img.style.pointerEvents = 'none';
	img.style.userSelect = 'none';
}

/** Returns the decoded cached image, or a plain `<img>` when a custom loader resolved without one. */
function getTileImage(tile: CachedTile): HTMLImageElement {
	if (tile.image) {
		return tile.image;
	}
	const fallbackImg = document.createElement('img');
	fallbackImg.alt = '';
	fallbackImg.draggable = false;
	fallbackImg.src = tile.url;
	return fallbackImg;
}

/**
 * Mounts an already-decoded `HTMLImageElement` from `TileCache` directly into its DOM slot.
 *
 * The fade-in is a CSS animation on the slot (see `.dzi-tile-fade` in `DziViewer.svelte`), and the viewer
 * listens for its `animationend` once at the root, so this action creates no animations or listeners.
 * The parent `{#each}` is keyed by `tile.key`, so one action instance always shows the same tile.
 */
export function attachTileImage(
	node: HTMLElement,
	params: AttachTileImageParams
): ActionReturn<AttachTileImageParams> {
	const { key } = params.tile;
	let latestParams = params;
	let mountedImage: HTMLImageElement | null = null;

	const mountImage = (tile: CachedTile) => {
		if (mountedImage?.parentNode === node && (!tile.image || mountedImage === tile.image)) {
			return;
		}
		if (mountedImage?.parentNode === node) {
			mountedImage.remove();
		}
		mountedImage = getTileImage(tile);
		applyTileImageStyles(mountedImage);
		node.appendChild(mountedImage);
	};

	mountImage(params.tile);
	params.onMount(key);

	return {
		update(nextParams: AttachTileImageParams) {
			latestParams = nextParams;
			mountImage(nextParams.tile);
		},
		destroy() {
			// Only remove the image if it's still ours; it may have moved to another slot already.
			if (mountedImage?.parentNode === node) {
				mountedImage.remove();
			}
			mountedImage = null;
			latestParams.onUnmount(key);
		}
	};
}
