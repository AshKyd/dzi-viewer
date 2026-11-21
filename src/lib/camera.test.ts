import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCamera } from './camera.js';
import type {
	DziViewerMethods,
	ViewerLifecycleEvent,
	ViewerLifecycleListener
} from './components/DziViewer/dziViewerTypes.js';
import { EMPTY_PRECACHE_RESULT } from './precache.js';
import type { DziDescriptor, PrecacheOptions, Rect, Size, Viewport } from './types.js';
import { getFillViewport, getFitViewport, screenToStage, stageToScreen } from './viewport.js';

interface MockViewerHandle {
	readonly viewer: DziViewerMethods;
	readonly pauseReasons: Set<string>;
	readonly precacheCalls: Array<{ viewport: Viewport; signal?: AbortSignal }>;
	readonly setViewportCalls: Viewport[];
	setImageBounds(bounds: Rect | null): void;
	setContainerSize(size: Size): void;
	emit(event: ViewerLifecycleEvent): void;
}

function createMockViewer(
	initial: {
		viewport?: Viewport;
		imageBounds?: Rect | null;
		containerSize?: Size;
	} = {}
): MockViewerHandle {
	let viewport: Viewport = initial.viewport ?? { x: 1000, y: 500, zoom: 0.5 };
	let imageBounds: Rect | null =
		initial.imageBounds !== undefined
			? initial.imageBounds
			: { x: 0, y: 0, width: 2000, height: 1000 };
	let containerSize: Size = initial.containerSize ?? { width: 1000, height: 1000 };

	const pauseReasons = new Set<string>();
	let resolutionHeld = false;
	const listeners = new Set<ViewerLifecycleListener>();
	const precacheCalls: Array<{ viewport: Viewport; signal?: AbortSignal }> = [];
	const setViewportCalls: Viewport[] = [];

	const viewer: DziViewerMethods = {
		setViewport(next) {
			viewport = {
				x: next.x ?? viewport.x,
				y: next.y ?? viewport.y,
				zoom: next.zoom ?? viewport.zoom
			};
			setViewportCalls.push(viewport);
		},
		getViewport: () => viewport,
		getImageBounds: () => imageBounds,
		getContainerSize: () => containerSize,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getFitViewport: (bounds, options) => {
			const targetBounds = bounds ?? imageBounds;
			return targetBounds ? getFitViewport(targetBounds, containerSize, options) : null;
		},
		getFillViewport: (bounds, options) => {
			const targetBounds = bounds ?? imageBounds;
			return targetBounds ? getFillViewport(targetBounds, containerSize, options) : null;
		},
		precacheViewport(targetViewport: Viewport, options?: PrecacheOptions) {
			precacheCalls.push({ viewport: targetViewport, signal: options?.signal });
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		},
		precacheBounds: () => Promise.resolve(EMPTY_PRECACHE_RESULT),
		stageToScreen: (point) => stageToScreen(point, viewport, containerSize),
		screenToStage: (point) => screenToStage(point, viewport, containerSize),
		pauseLoading: (reason = 'default') => {
			pauseReasons.add(reason);
		},
		resumeLoading: (reason = 'default') => {
			pauseReasons.delete(reason);
		},
		isLoadingPaused: () => pauseReasons.size > 0,
		holdResolution: () => {
			resolutionHeld = true;
		},
		releaseResolution: () => {
			resolutionHeld = false;
		},
		isResolutionHeld: () => resolutionHeld
	};

	return {
		viewer,
		pauseReasons,
		precacheCalls,
		setViewportCalls,
		setImageBounds(next) {
			imageBounds = next;
		},
		setContainerSize(next) {
			containerSize = next;
		},
		emit(event) {
			Array.from(listeners).forEach((listener) => listener(event));
		}
	};
}

/** Installs a deterministic manual `requestAnimationFrame` queue backed by a controllable clock. */
function installManualRaf() {
	let now = 0;
	let nextId = 1;
	const callbacks = new Map<number, FrameRequestCallback>();

	vi.spyOn(performance, 'now').mockImplementation(() => now);
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		const id = nextId++;
		callbacks.set(id, cb);
		return id;
	});
	vi.stubGlobal('cancelAnimationFrame', (id: number) => {
		callbacks.delete(id);
	});

	return {
		step(nextTime: number) {
			now = nextTime;
			const pending = Array.from(callbacks.entries());
			callbacks.clear();
			pending.forEach(([, cb]) => cb(now));
		},
		get pendingCount() {
			return callbacks.size;
		}
	};
}

const dummyDzi: DziDescriptor = {
	width: 2000,
	height: 1000,
	tileSize: 256,
	overlap: 1,
	format: 'jpg',
	tilesUrl: 'https://example.com/photo_files',
	minLevel: 0,
	maxLevel: 11
};

describe('createCamera', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('snaps immediately when duration is 0 or target equals current viewport', async () => {
		const mock = createMockViewer();
		const camera = createCamera(mock.viewer);

		const result = await camera.goTo(
			{ bounds: { x: 0, y: 0, width: 500, height: 500 } },
			{ duration: 0 }
		);
		expect(result).toEqual({
			completed: true,
			cancelled: false,
			viewport: { x: 250, y: 250, zoom: 2 }
		});
		expect(mock.viewer.isLoadingPaused()).toBe(false);
		expect(mock.viewer.isResolutionHeld()).toBe(false);
		expect(mock.precacheCalls).toHaveLength(0);

		// Calling again with the same target is an immediate snap even with duration > 0.
		const same = await camera.goTo({ x: 250, y: 250, zoom: 2 }, { duration: 600 });
		expect(same.completed).toBe(true);
		expect(camera.isTransitioning).toBe(false);
	});

	it('animates goTo with holds, precaching, and transition callbacks', async () => {
		const raf = installManualRaf();
		const mock = createMockViewer();
		const transitions: boolean[] = [];
		const camera = createCamera(mock.viewer, {
			duration: 400,
			onTransitionChange: (active) => transitions.push(active)
		});

		const promise = camera.fitBounds({ x: 0, y: 0, width: 500, height: 500 });
		expect(camera.isTransitioning).toBe(true);
		expect(mock.viewer.isLoadingPaused()).toBe(true);
		expect(mock.viewer.isResolutionHeld()).toBe(true);
		expect(mock.precacheCalls).toHaveLength(1);
		expect(mock.precacheCalls[0].viewport).toEqual({ x: 250, y: 250, zoom: 2 });

		raf.step(200);
		expect(mock.viewer.getViewport().zoom).toBeGreaterThan(0.5);
		expect(mock.viewer.getViewport().zoom).toBeLessThan(2);

		raf.step(400);
		const result = await promise;
		expect(result).toEqual({
			completed: true,
			cancelled: false,
			viewport: { x: 250, y: 250, zoom: 2 }
		});
		expect(camera.isTransitioning).toBe(false);
		expect(mock.viewer.isLoadingPaused()).toBe(false);
		expect(mock.viewer.isResolutionHeld()).toBe(false);
		expect(mock.precacheCalls[0].signal?.aborted).toBe(false);
		expect(transitions).toEqual([true, false]);
	});

	it('interrupts mid-flight transitions cleanly, aborting stale precache without dropping holds', async () => {
		const raf = installManualRaf();
		const mock = createMockViewer();
		const transitions: boolean[] = [];
		const camera = createCamera(mock.viewer, {
			duration: 400,
			onTransitionChange: (active) => transitions.push(active)
		});

		const first = camera.goTo({ x: 250, y: 250, zoom: 2 });
		raf.step(100);
		const firstPrecacheSignal = mock.precacheCalls[0].signal;
		expect(firstPrecacheSignal?.aborted).toBe(false);

		const second = camera.goTo({ x: 1500, y: 750, zoom: 3 });
		const firstResult = await first;
		expect(firstResult.cancelled).toBe(true);
		expect(firstResult.completed).toBe(false);
		expect(firstPrecacheSignal?.aborted).toBe(true);
		// Holds stayed active continuously across the interruption.
		expect(mock.viewer.isLoadingPaused()).toBe(true);
		expect(mock.viewer.isResolutionHeld()).toBe(true);
		expect(transitions).toEqual([true]);

		raf.step(500);
		const secondResult = await second;
		expect(secondResult).toEqual({
			completed: true,
			cancelled: false,
			viewport: { x: 1500, y: 750, zoom: 3 }
		});
		expect(transitions).toEqual([true, false]);
	});

	it('supports AbortSignal cancellation before and during transitions', async () => {
		const raf = installManualRaf();
		const mock = createMockViewer();
		const camera = createCamera(mock.viewer, { duration: 400 });

		const preAborted = new AbortController();
		preAborted.abort();
		const immediateCancel = await camera.goTo(
			{ x: 500, y: 500, zoom: 2 },
			{ signal: preAborted.signal }
		);
		expect(immediateCancel.cancelled).toBe(true);

		const controller = new AbortController();
		const inFlight = camera.goTo({ x: 500, y: 500, zoom: 2 }, { signal: controller.signal });
		raf.step(100);
		controller.abort();

		const result = await inFlight;
		expect(result.cancelled).toBe(true);
		expect(camera.isTransitioning).toBe(false);
		expect(mock.viewer.isLoadingPaused()).toBe(false);
		expect(mock.viewer.isResolutionHeld()).toBe(false);
		expect(raf.pendingCount).toBe(0);
	});

	it('snaps immediately when prefers-reduced-motion matches', async () => {
		installManualRaf();
		vi.stubGlobal('window', {
			matchMedia: () => ({ matches: true })
		});
		const mock = createMockViewer();
		const camera = createCamera(mock.viewer, { duration: 600 });

		const result = await camera.goTo({ x: 300, y: 200, zoom: 2 });
		expect(result.completed).toBe(true);
		expect(mock.viewer.getViewport()).toEqual({ x: 300, y: 200, zoom: 2 });
		expect(camera.isTransitioning).toBe(false);
	});

	it('queues bounds goTo before load/resize and snaps once ready', async () => {
		const mock = createMockViewer({ imageBounds: null, containerSize: { width: 0, height: 0 } });
		const camera = createCamera(mock.viewer, { duration: 600 });

		const pending = camera.fillBounds();
		expect(mock.setViewportCalls).toHaveLength(0);

		// DZI loads first while container is still 0x0: still waiting.
		mock.setImageBounds({ x: 0, y: 0, width: 2000, height: 1000 });
		mock.emit({ type: 'load', dzi: dummyDzi });
		expect(mock.setViewportCalls).toHaveLength(0);

		// Container gets a size: pending goTo flushes immediately.
		mock.setContainerSize({ width: 1000, height: 1000 });
		mock.emit({ type: 'resize', containerSize: { width: 1000, height: 1000 } });

		const result = await pending;
		expect(result).toEqual({
			completed: true,
			cancelled: false,
			viewport: { x: 1000, y: 500, zoom: 1 }
		});
	});

	it('scrubs smoothly with linear default easing, settles after delay, and precaches once per segment', () => {
		vi.useFakeTimers();
		const mock = createMockViewer();
		const camera = createCamera(mock.viewer, { settleDelayMs: 120 });

		const from = { x: 0, y: 0, zoom: 1 };
		const to = { x: 1000, y: 0, zoom: 1 };

		const mid = camera.scrub(from, to, 0.5);
		// Linear by default (not easeOutCubic which would be 875).
		expect(mid).toEqual({ x: 500, y: 0, zoom: 1 });
		expect(camera.isTransitioning).toBe(true);
		expect(mock.viewer.isLoadingPaused()).toBe(true);
		expect(mock.viewer.isResolutionHeld()).toBe(true);
		expect(mock.precacheCalls).toHaveLength(1);

		// Subsequent scrub frames on the same segment do not re-trigger precache.
		camera.scrub(from, to, 0.75);
		expect(mock.precacheCalls).toHaveLength(1);

		vi.advanceTimersByTime(119);
		expect(camera.isTransitioning).toBe(true);

		vi.advanceTimersByTime(1);
		expect(camera.isTransitioning).toBe(false);
		expect(mock.viewer.isLoadingPaused()).toBe(false);
		expect(mock.viewer.isResolutionHeld()).toBe(false);

		// `precache: 'both'` precaches both endpoints once per segment.
		camera.scrubTrack(
			[
				{ at: 0, target: 'fit' },
				{ at: 1, target: 'fill' }
			],
			0.5,
			{ precache: 'both' }
		);
		expect(mock.precacheCalls).toHaveLength(3);
	});

	it('refits bounds, resolver targets, and scrubs on resize when refitOnResize is enabled', async () => {
		const mock = createMockViewer();
		let refitEnabled = true;
		const camera = createCamera(mock.viewer, {
			duration: 0,
			refitOnResize: () => refitEnabled
		});

		await camera.goTo('fit');
		expect(mock.viewer.getViewport()).toEqual({ x: 1000, y: 500, zoom: 0.5 });

		mock.setContainerSize({ width: 500, height: 500 });
		mock.emit({ type: 'resize', containerSize: { width: 500, height: 500 } });
		expect(mock.viewer.getViewport()).toEqual({ x: 1000, y: 500, zoom: 0.25 });

		// Disabling refitOnResize preserves current viewport on resize.
		refitEnabled = false;
		mock.setContainerSize({ width: 1000, height: 1000 });
		mock.emit({ type: 'resize', containerSize: { width: 1000, height: 1000 } });
		expect(mock.viewer.getViewport()).toEqual({ x: 1000, y: 500, zoom: 0.25 });
	});

	it('cancels on user interact, source-change, and destroy, and re-attaches on viewer remount', async () => {
		const raf = installManualRaf();
		let currentMock = createMockViewer();
		const camera = createCamera(() => currentMock.viewer, {
			duration: 400,
			refitOnResize: true
		});

		const inFlight = camera.goTo('fill');
		raf.step(100);
		currentMock.emit({ type: 'interact', viewport: { x: 800, y: 400, zoom: 0.8 } });

		const cancelled = await inFlight;
		expect(cancelled.cancelled).toBe(true);
		expect(currentMock.viewer.isLoadingPaused()).toBe(false);

		// After manual interact, resize should not overwrite user pan/zoom.
		const beforeResize = currentMock.viewer.getViewport();
		currentMock.setContainerSize({ width: 500, height: 500 });
		currentMock.emit({ type: 'resize', containerSize: { width: 500, height: 500 } });
		expect(currentMock.viewer.getViewport()).toEqual(beforeResize);

		// Source change cancels active transitions.
		const second = camera.goTo('fit');
		currentMock.emit({ type: 'source-change' });
		expect((await second).cancelled).toBe(true);

		// Remounting a new viewer instance via getter seamlessly re-attaches.
		currentMock.emit({ type: 'destroy' });
		currentMock = createMockViewer();
		const afterRemount = await camera.goTo('fill', { duration: 0 });
		expect(afterRemount).toEqual({
			completed: true,
			cancelled: false,
			viewport: { x: 1000, y: 500, zoom: 1 }
		});

		camera.destroy();
		const afterDestroy = await camera.goTo('fit', { duration: 0 });
		expect(afterDestroy.cancelled).toBe(true);
	});
});
