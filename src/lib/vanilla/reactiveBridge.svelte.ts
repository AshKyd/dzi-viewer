import { untrack, type Component } from 'svelte';
import type { DziViewerMethods } from '../components/DziViewer/dziViewerTypes.js';
import type { PanZoomProps } from '../components/PanZoom/panZoomTypes.js';
import type { DziDescriptor, Size, Viewport } from '../types.js';
import {
	splitBindableProps,
	type BindableKey,
	type BindableValues,
	type ViewerStateSnapshot
} from './vanillaUtils.js';

/** Pass-through props for the mounted viewer (everything except the two-way bound fields). */
export type ViewerRestProps = Omit<PanZoomProps, BindableKey>;

/**
 * A viewer the bridge can mount. `DziViewer` fits too: its props are a subset of `PanZoom`'s,
 * and a component that accepts fewer props can always be given more.
 */
export type ViewerComponent = Component<PanZoomProps, DziViewerMethods, BindableKey>;

export type StateChangeListener = (state: ViewerStateSnapshot) => void;

export type ReactiveBridgeOptions = Partial<ViewerRestProps> &
	BindableValues & { onStateChange?: StateChangeListener };

/**
 * Reactive state shared between a vanilla controller and the mounted `VanillaBridge` component.
 *
 * Controller methods are imperative, so every read and write here is untracked. Otherwise a caller inside
 * a Svelte `$effect` would subscribe to bridge state it then writes (e.g. `rest` in `update`) and loop forever.
 */
export class ReactiveBridge {
	x = $state(0);
	y = $state(0);
	zoom = $state(1);
	containerSize = $state.raw<Size>({ width: 0, height: 0 });
	dzi = $state.raw<DziDescriptor | null>(null);
	isOptimalLoaded = $state(false);
	rest = $state.raw({} as ViewerRestProps);

	#onStateChange?: StateChangeListener;
	#isNotifyQueued = false;

	constructor(options: ReactiveBridgeOptions) {
		this.update(options);
	}

	/** Applies a props update from the controller (`update()` / `setViewport()`). */
	update(props: ReactiveBridgeOptions): void {
		untrack(() => {
			if ('onStateChange' in props) {
				this.#onStateChange = props.onStateChange;
			}
			const { bindables, rest } = splitBindableProps(props);
			Object.assign(this, bindables);
			if (Object.keys(rest).length > 0) {
				this.rest = { ...this.rest, ...rest };
			}
		});
	}

	/**
	 * Called when the mounted component writes a bound field.
	 * A single gesture writes `x`, `y` and `zoom` one after another, so listeners are notified once,
	 * on a microtask, with the finished state rather than three half-updated snapshots.
	 */
	set<K extends BindableKey>(key: K, value: this[K]): void {
		this[key] = value;
		if (this.#isNotifyQueued) {
			return;
		}
		this.#isNotifyQueued = true;
		queueMicrotask(() => {
			this.#isNotifyQueued = false;
			this.#onStateChange?.(this.getSnapshot());
		});
	}

	getSnapshot(): ViewerStateSnapshot {
		return untrack(() => ({
			x: this.x,
			y: this.y,
			zoom: this.zoom,
			containerSize: this.containerSize,
			dzi: this.dzi,
			isOptimalLoaded: this.isOptimalLoaded
		}));
	}

	getViewport(): Viewport {
		return untrack(() => ({ x: this.x, y: this.y, zoom: this.zoom }));
	}
}
