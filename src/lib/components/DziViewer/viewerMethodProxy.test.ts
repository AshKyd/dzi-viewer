import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PRECACHE_RESULT } from '../../precache.js';
import type { Viewport } from '../../types.js';
import type { DziViewerMethods } from './dziViewerTypes.js';
import { createViewerMethodProxy } from './viewerMethodProxy.js';

function makeFallback() {
	let viewport: Viewport = { x: 50, y: 50, zoom: 2 };
	return {
		getViewport: () => viewport,
		getContainerSize: () => ({ width: 100, height: 100 }),
		setViewport: (next: Partial<Viewport>) => {
			viewport = { ...viewport, ...next };
		}
	};
}

describe('createViewerMethodProxy', () => {
	it('answers from the fallback before the viewer mounts', async () => {
		const proxy = createViewerMethodProxy(() => undefined, makeFallback());

		proxy.setViewport({ x: 10 });
		expect(proxy.getViewport()).toEqual({ x: 10, y: 50, zoom: 2 });
		// Centre of a 100×100 container is stage (10, 50); one stage unit right is 2px right.
		expect(proxy.stageToScreen({ x: 11, y: 50 })).toEqual({ x: 52, y: 50 });
		expect(proxy.screenToStage({ x: 52, y: 50 })).toEqual({ x: 11, y: 50 });
		expect(proxy.getImageBounds()).toBeNull();
		expect(proxy.isLoadingPaused()).toBe(false);
		await expect(proxy.precacheViewport({ x: 0, y: 0, zoom: 1 })).resolves.toBe(
			EMPTY_PRECACHE_RESULT
		);
	});

	it('forwards to the viewer once it exists', () => {
		const viewer = {
			setViewport: vi.fn(),
			isLoadingPaused: () => true
		} as Partial<DziViewerMethods>;
		const fallback = makeFallback();
		const proxy = createViewerMethodProxy(() => viewer as DziViewerMethods, fallback);

		proxy.setViewport({ zoom: 4 });
		expect(viewer.setViewport).toHaveBeenCalledWith({ zoom: 4 });
		expect(fallback.getViewport().zoom).toBe(2);
		expect(proxy.isLoadingPaused()).toBe(true);
	});
});
