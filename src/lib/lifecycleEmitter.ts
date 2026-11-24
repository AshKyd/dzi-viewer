import type {
	ViewerLifecycleEvent,
	ViewerLifecycleListener
} from './components/DziViewer/dziViewerTypes.js';

export interface LifecycleEmitter {
	/** Adds `listener`; returns a function that removes it. */
	subscribe(listener: ViewerLifecycleListener): () => void;
	/** Calls every listener with `event`. A listener that throws is logged and never stops the others. */
	emit(event: ViewerLifecycleEvent): void;
	/** Removes all listeners. */
	clear(): void;
}

/** Listener registry shared by `DziViewer` and `PanZoom` for `subscribe()` lifecycle events. */
export function createLifecycleEmitter(): LifecycleEmitter {
	const listeners = new Set<ViewerLifecycleListener>();

	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit(event) {
			// Copy first so a listener that unsubscribes mid-emit doesn't skip its neighbours.
			[...listeners].forEach((listener) => {
				try {
					listener(event);
				} catch (error) {
					console.error(
						`[dzi-viewer] Viewer lifecycle listener threw: ${JSON.stringify({ event: event.type, error: String(error) })}`
					);
				}
			});
		},
		clear() {
			listeners.clear();
		}
	};
}
