<script lang="ts">
	import { untrack } from 'svelte';
	import { devicePixelRatio } from 'svelte/reactivity/window';
	import { CanvasTileRenderer } from '../../canvasRenderer.js';
	import { loadDzi } from '../../dzi.js';
	import { createLifecycleEmitter } from '../../lifecycleEmitter.js';
	import { EMPTY_PRECACHE_RESULT } from '../../precache.js';
	import { DEFAULT_MAX_CONCURRENT_LOADS } from '../../tileLoader.js';
	import { DEFAULT_MAX_DPR } from '../../tiling.js';
	import { resolveViewportTarget } from '../../transition.js';
	import type {
		DziDescriptor,
		Point,
		PrecacheOptions,
		PrecacheResult,
		Rect,
		Size,
		Viewport,
		ViewportFitOptions
	} from '../../types.js';
	import {
		clampViewport,
		getFillViewport as computeFillViewport,
		getFitViewport as computeFitViewport,
		resolveStageAndImageBounds,
		screenToStage as convertScreenToStage,
		stageRectToScreen as convertStageRectToScreen,
		stageRectToStyle as convertStageRectToStyle,
		stageToScreen as convertStageToScreen
	} from '../../viewport.js';
	import type {
		DziViewerProps,
		DziViewerSnippetContext,
		ViewerLifecycleListener
	} from './dziViewerTypes.js';

	let {
		source = null,
		initialView,
		children,
		x = $bindable(0),
		y = $bindable(0),
		zoom = $bindable(1),
		stageSize,
		imageBounds,
		containerSize = $bindable<Size>({ width: 0, height: 0 }),
		dzi = $bindable<DziDescriptor | null>(null),
		isOptimalLoaded = $bindable(false),
		dpr,
		maxDpr = DEFAULT_MAX_DPR,
		quality = 1,
		constraints,
		maxConcurrentLoads = DEFAULT_MAX_CONCURRENT_LOADS,
		maxCachedTiles = 256,
		maxRetries = 1,
		failedTileRetryDelay = 5000,
		preloadBaseLevel = true,
		tileFadeDuration = 200,
		debug = false,
		crossOrigin,
		getTileUrl,
		alt = '',
		class: className = '',
		onLoad,
		onError,
		onTileError
	}: DziViewerProps = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let canvasEl: HTMLCanvasElement | undefined = $state();
	let renderer: CanvasTileRenderer | undefined = $state.raw();
	let sourceId = $state('source-0');
	let sourceCounter = 0;

	const lifecycle = createLifecycleEmitter();
	// Replayed onto a new renderer if the canvas remounts; no rendering depends on it.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const pauseReasons = new Set<string>();

	let hasAppliedInitialView = false;
	let syncedRenderer: CanvasTileRenderer | undefined;
	let syncedSourceId = '';
	let syncedDzi: DziDescriptor | null = null;

	/**
	 * Sends the active DZI descriptor to `targetRenderer` at most once per `(renderer, sourceId, dzi)`.
	 * Called eagerly when `loadDzi` resolves (before `onLoad` / lifecycle listeners run) so callers
	 * can invoke `precacheViewport()` or `holdResolution()` synchronously inside `onLoad`.
	 */
	function syncSourceToRenderer(
		targetRenderer: CanvasTileRenderer | undefined,
		nextDzi: DziDescriptor | null,
		nextImageBounds: Rect | null,
		nextSourceId: string
	): void {
		if (!targetRenderer) {
			return;
		}
		if (
			syncedRenderer === targetRenderer &&
			syncedSourceId === nextSourceId &&
			syncedDzi === nextDzi
		) {
			return;
		}
		syncedRenderer = targetRenderer;
		syncedSourceId = nextSourceId;
		syncedDzi = nextDzi;
		targetRenderer.setSource(nextDzi, nextImageBounds, nextSourceId);
	}

	/**
	 * Applies `initialView` once per `source` as soon as both `descriptor` and non-zero `size` exist,
	 * before tile loads are scheduled for the default `(0, 0, zoom=1)` viewport.
	 */
	function applyInitialViewIfReady(descriptor: DziDescriptor, size: Size): void {
		if (hasAppliedInitialView || size.width <= 0 || size.height <= 0) {
			return;
		}
		const target = untrack(() => initialView);
		if (!target) {
			return;
		}
		const stage = resolveStageAndImageBounds(
			descriptor,
			untrack(() => stageSize),
			untrack(() => imageBounds)
		);
		const resolved = resolveViewportTarget(target, stage.imageBounds, size);
		x = resolved.x;
		y = resolved.y;
		zoom = resolved.zoom;
		hasAppliedInitialView = true;
	}

	// --- Derived viewer state ---

	const rawDpr = $derived(dpr ?? devicePixelRatio.current ?? 1);

	const resolvedStage = $derived(
		dzi ? resolveStageAndImageBounds(dzi, stageSize, imageBounds) : null
	);

	const effectiveViewport = $derived(clampViewport({ x, y, zoom }, constraints, containerSize));

	const hasContainerSize = $derived(containerSize.width > 0 && containerSize.height > 0);

	// --- Effects ---

	// Create and dispose the WebGL2 / 2D canvas renderer when the `<canvas>` mounts.
	$effect(() => {
		const el = canvasEl;
		if (!el) {
			return;
		}

		const instance = new CanvasTileRenderer(
			el,
			{
				onOptimalLoadedChange: (loaded) => {
					if (isOptimalLoaded !== loaded) {
						isOptimalLoaded = loaded;
					}
				},
				onTileError: (event) => {
					untrack(() => onTileError)?.(event);
				}
			},
			untrack(() => ({
				maxDpr,
				quality,
				maxConcurrentLoads,
				maxCachedTiles,
				maxRetries,
				failedTileRetryDelay,
				preloadBaseLevel,
				tileFadeDuration,
				crossOrigin,
				debug
			}))
		);

		pauseReasons.forEach((reason) => instance.pauseLoading(reason));
		renderer = instance;

		return () => {
			if (renderer === instance) {
				renderer = undefined;
			}
			instance.destroy();
		};
	});

	// Notify lifecycle listeners on unmount.
	$effect(() => {
		return () => {
			lifecycle.emit({ type: 'destroy' });
			lifecycle.clear();
		};
	});

	// Keep renderer configuration in sync with reactive props.
	$effect(() => {
		const currentRenderer = renderer;
		if (!currentRenderer) {
			return;
		}
		currentRenderer.configure({
			maxDpr,
			quality,
			maxConcurrentLoads,
			maxCachedTiles,
			maxRetries,
			failedTileRetryDelay,
			preloadBaseLevel,
			tileFadeDuration,
			crossOrigin,
			debug
		});
	});

	// Sync container size and device pixel ratio to the renderer.
	$effect(() => {
		const currentRenderer = renderer;
		if (!currentRenderer) {
			return;
		}
		currentRenderer.setContainerSize(containerSize, rawDpr);
	});

	// Sync loaded DZI descriptor to the renderer whenever source or renderer changes.
	$effect(() => {
		syncSourceToRenderer(
			renderer,
			dzi,
			untrack(() => resolvedStage?.imageBounds ?? null),
			sourceId
		);
	});

	// Remap cached tile stage rectangles if `stageSize` or `imageBounds` changes after tiles are cached.
	$effect(() => {
		const currentRenderer = renderer;
		if (!currentRenderer || !resolvedStage) {
			return;
		}
		currentRenderer.setImageBounds(resolvedStage.imageBounds);
	});

	// Sync viewport changes to the renderer.
	$effect(() => {
		const currentRenderer = renderer;
		if (!currentRenderer) {
			return;
		}
		currentRenderer.setViewport(effectiveViewport);
	});

	// Observe container size changes via ResizeObserver.
	$effect(() => {
		const el = containerEl;
		if (!el) {
			return;
		}

		// Untracked so writing `containerSize` doesn't re-run this effect and rebuild the observer.
		const updateSize = (width: number, height: number) =>
			untrack(() => {
				const nextWidth = Math.max(0, width);
				const nextHeight = Math.max(0, height);
				if (nextWidth !== containerSize.width || nextHeight !== containerSize.height) {
					const nextSize = { width: nextWidth, height: nextHeight };
					containerSize = nextSize;
					renderer?.setContainerSize(nextSize, rawDpr);
					if (dzi) {
						applyInitialViewIfReady(dzi, nextSize);
						renderer?.setViewport(effectiveViewport);
					}
					lifecycle.emit({ type: 'resize', containerSize: nextSize });
				}
			});

		const initialRect = el.getBoundingClientRect();
		updateSize(initialRect.width, initialRect.height);

		if (typeof ResizeObserver === 'undefined') {
			return;
		}

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) {
				return;
			}
			updateSize(entry.contentRect.width, entry.contentRect.height);
		});

		observer.observe(el);
		return () => observer.disconnect();
	});

	// Load and parse the DZI descriptor whenever `source` or `getTileUrl` changes.
	$effect(() => {
		const currentSource = source;
		const currentGetTileUrl = getTileUrl;
		const controller = new AbortController();

		sourceCounter += 1;
		const nextSourceId = `source-${sourceCounter}`;
		hasAppliedInitialView = false;
		sourceId = nextSourceId;
		dzi = null;
		isOptimalLoaded = false;
		syncSourceToRenderer(
			untrack(() => renderer),
			null,
			null,
			nextSourceId
		);

		if (sourceCounter > 1) {
			lifecycle.emit({ type: 'source-change' });
		}

		if (!currentSource) {
			return;
		}

		loadDzi(currentSource, {
			signal: controller.signal,
			getTileUrl: currentGetTileUrl
		})
			.then((descriptor) => {
				if (controller.signal.aborted) {
					return;
				}
				dzi = descriptor;
				const currentSize = untrack(() => containerSize);
				applyInitialViewIfReady(descriptor, currentSize);
				const stage = resolveStageAndImageBounds(
					descriptor,
					untrack(() => stageSize),
					untrack(() => imageBounds)
				);
				const currentRenderer = untrack(() => renderer);
				currentRenderer?.setContainerSize(
					currentSize,
					untrack(() => rawDpr)
				);
				syncSourceToRenderer(currentRenderer, descriptor, stage.imageBounds, nextSourceId);
				currentRenderer?.setViewport(untrack(() => effectiveViewport));
				onLoad?.(descriptor);
				lifecycle.emit({ type: 'load', dzi: descriptor });
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) {
					return;
				}
				onError?.(error);
			});

		return () => {
			controller.abort();
		};
	});

	// Fallback for non-ResizeObserver size updates (e.g. bound `containerSize` in tests): frame before tiles load.
	$effect(() => {
		if (dzi && hasContainerSize && !hasAppliedInitialView) {
			applyInitialViewIfReady(dzi, containerSize);
		}
	});

	const snippetContext: DziViewerSnippetContext = $derived({
		viewport: effectiveViewport,
		containerSize,
		dzi,
		imageBounds: resolvedStage?.imageBounds ?? null,
		stageToScreen: (point: Point) => convertStageToScreen(point, effectiveViewport, containerSize),
		screenToStage: (point: Point) => convertScreenToStage(point, effectiveViewport, containerSize),
		stageRectToScreen: (rect: Rect) =>
			convertStageRectToScreen(rect, effectiveViewport, containerSize),
		stageRectToStyle: (rect: Rect) =>
			convertStageRectToStyle(rect, effectiveViewport, containerSize)
	});

	// --- Exported methods (see `DziViewerMethods`) ---

	export function setViewport(viewport: Partial<Viewport>): void {
		if (viewport.x !== undefined) {
			x = viewport.x;
		}
		if (viewport.y !== undefined) {
			y = viewport.y;
		}
		if (viewport.zoom !== undefined) {
			zoom = viewport.zoom;
		}
	}

	export function getViewport(): Viewport {
		return untrack(() => effectiveViewport);
	}

	export function getImageBounds(): Rect | null {
		return untrack(() => resolvedStage?.imageBounds ?? null);
	}

	export function getContainerSize(): Size {
		return untrack(() => containerSize);
	}

	export function subscribe(listener: ViewerLifecycleListener): () => void {
		return lifecycle.subscribe(listener);
	}

	/**
	 * Computes a viewport that fits `bounds` inside the current container (defaults to the loaded image's bounds).
	 */
	export function getFitViewport(bounds?: Rect, options?: ViewportFitOptions): Viewport | null {
		const targetBounds = bounds ?? resolvedStage?.imageBounds;
		return targetBounds ? computeFitViewport(targetBounds, containerSize, options) : null;
	}

	/**
	 * Computes a viewport that fills the current container with `bounds` (defaults to the loaded image's bounds).
	 */
	export function getFillViewport(bounds?: Rect, options?: ViewportFitOptions): Viewport | null {
		const targetBounds = bounds ?? resolvedStage?.imageBounds;
		return targetBounds ? computeFillViewport(targetBounds, containerSize, options) : null;
	}

	/**
	 * Pre-caches the optimal tiles for a target viewport into the viewer's shared tile cache.
	 */
	export function precacheViewport(
		targetViewport: Viewport,
		options?: PrecacheOptions
	): Promise<PrecacheResult> {
		if (!renderer || !dzi || !resolvedStage || !hasContainerSize) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}
		return renderer.precacheViewport(targetViewport, options);
	}

	/**
	 * Pre-caches the optimal tiles for a fit or fill view of `bounds` (defaults to the loaded image's bounds).
	 */
	export function precacheBounds(
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: PrecacheOptions & ViewportFitOptions
	): Promise<PrecacheResult> {
		if (!renderer || !dzi || !resolvedStage || !hasContainerSize) {
			return Promise.resolve(EMPTY_PRECACHE_RESULT);
		}
		return renderer.precacheBounds(bounds, mode, options);
	}

	export function stageToScreen(point: Point): Point {
		return convertStageToScreen(point, effectiveViewport, containerSize);
	}

	export function screenToStage(point: Point): Point {
		return convertScreenToStage(point, effectiveViewport, containerSize);
	}

	export function pauseLoading(reason = 'default'): void {
		pauseReasons.add(reason);
		renderer?.pauseLoading(reason);
	}

	export function resumeLoading(reason = 'default'): void {
		if (!pauseReasons.delete(reason)) {
			return;
		}
		renderer?.resumeLoading(reason);
	}

	export function isLoadingPaused(): boolean {
		return pauseReasons.size > 0;
	}

	export function holdResolution(): void {
		renderer?.holdResolution();
	}

	export function releaseResolution(): void {
		renderer?.releaseResolution();
	}

	export function isResolutionHeld(): boolean {
		return renderer?.isResolutionHeld() ?? false;
	}
</script>

<div
	bind:this={containerEl}
	class="dzi-viewport {className}"
	role={alt ? 'img' : undefined}
	aria-label={alt || undefined}
>
	<canvas bind:this={canvasEl} class="dzi-canvas"></canvas>
	{#if children}
		<div class="dzi-overlay-layer">
			{@render children(snippetContext)}
		</div>
	{/if}
</div>

<style>
	.dzi-viewport {
		position: relative;
		overflow: hidden;
		width: 100%;
		height: 100%;
		contain: layout paint;
	}

	.dzi-canvas {
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.dzi-overlay-layer {
		position: absolute;
		inset: 0;
		z-index: 1000;
		pointer-events: none;
	}
</style>
