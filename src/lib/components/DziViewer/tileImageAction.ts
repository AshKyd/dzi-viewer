import type { ActionReturn } from 'svelte/action';
import type { CachedTile } from '../../types.js';

export interface AttachTileImageParams {
	readonly tile: CachedTile;
	/** Fade-in duration in milliseconds; `0` mounts immediately at full opacity. */
	readonly fadeDuration: number;
	/** Called once the tile reaches full opacity so underlying fallback tiles can be removed. */
	readonly onOpaque: (key: string) => void;
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
 * Mounts an already-decoded `HTMLImageElement` from `TileCache` directly into its DOM slot
 * and fades it in on the compositor thread before signalling opacity completion.
 *
 * The parent `{#each}` is keyed by `tile.key`, so one action instance always shows the same tile.
 */
export function attachTileImage(
	node: HTMLElement,
	params: AttachTileImageParams
): ActionReturn<AttachTileImageParams> {
	const { key } = params.tile;
	let latestParams = params;
	let mountedImage: HTMLImageElement | null = null;
	let destroyed = false;

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

	const signalOpaque = () => {
		if (!destroyed) {
			latestParams.onOpaque(key);
		}
	};

	mountImage(params.tile);

	// --- Fade in ---
	// Reduced motion keeps the fade: it's an opacity change, not movement.
	const canAnimate = params.fadeDuration > 0 && typeof node.animate === 'function';
	const animation = canAnimate
		? node.animate([{ opacity: 0 }, { opacity: 1 }], {
				duration: params.fadeDuration,
				easing: 'ease-out'
			})
		: null;

	if (animation) {
		animation.finished.then(signalOpaque).catch(() => {
			// Expected when a tile unmounts mid-fade and cancels its animation.
		});
	} else {
		queueMicrotask(signalOpaque);
	}

	return {
		update(nextParams: AttachTileImageParams) {
			latestParams = nextParams;
			mountImage(nextParams.tile);
		},
		destroy() {
			destroyed = true;
			animation?.cancel();
			// Only remove the image if it's still ours; it may have moved to another slot already.
			if (mountedImage?.parentNode === node) {
				mountedImage.remove();
			}
			mountedImage = null;
			latestParams.onUnmount(key);
		}
	};
}
