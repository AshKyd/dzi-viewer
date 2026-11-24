import * as Comlink from 'comlink';
import { CANCELLED_PRECACHE_RESULT } from './precache.js';
import { TileEngine } from './tileEngine.js';
import type { EngineFrameSync, TileEngineDelta } from './tileEngineProtocol.js';
import type {
	PrecacheOptions,
	PrecacheResult,
	Rect,
	Viewport,
	ViewportFitOptions
} from './types.js';

type DeltaListener = (delta: TileEngineDelta) => void;

let engine: TileEngine | undefined;
const precacheControllers = new Map<number, AbortController>();

// --- Delta delivery ---

/** Error values may not be cloneable (e.g. custom classes), so they fall back to strings. */
function withStringErrors(delta: TileEngineDelta): TileEngineDelta {
	return delta.tileErrors
		? {
				...delta,
				tileErrors: delta.tileErrors.map((err) => ({ ...err, error: String(err.error) }))
			}
		: delta;
}

/** Sends `delta` to the main thread, transferring bitmaps rather than copying them. */
function postDelta(onDelta: Comlink.Remote<DeltaListener>, delta: TileEngineDelta): void {
	const bitmaps = delta.addedTiles?.map((item) => item.bitmap) ?? [];
	// A failed clone transfers nothing, so the retry can still send the same bitmaps.
	void onDelta(Comlink.transfer(delta, bitmaps)).catch(() =>
		onDelta(Comlink.transfer(withStringErrors(delta), bitmaps))
	);
}

// --- Precaching ---

function abortAllPrecaches(): void {
	precacheControllers.forEach((controller) => controller.abort());
	precacheControllers.clear();
}

/** Runs a precache under an id the main thread can abort, since `AbortSignal` can't cross threads. */
function runPrecache(
	id: number,
	start: (signal: AbortSignal) => Promise<PrecacheResult>
): Promise<PrecacheResult> {
	const controller = new AbortController();
	precacheControllers.set(id, controller);
	return start(controller.signal)
		.catch(() => CANCELLED_PRECACHE_RESULT)
		.finally(() => precacheControllers.delete(id));
}

// --- API exposed to `WorkerTileEngineClient` ---

const workerApi = {
	/** Starts the engine; every delta is pushed back through the proxied `onDelta`. */
	init(onDelta: DeltaListener): void {
		// The main thread passed `Comlink.proxy(fn)`, so each call here is really an async message.
		const remoteOnDelta = onDelta as unknown as Comlink.Remote<DeltaListener>;
		engine = new TileEngine({
			asyncBatchMs: 8,
			onDelta: (delta) => postDelta(remoteOnDelta, delta)
		});
	},
	sync(frame: EngineFrameSync): void {
		if (frame.source) {
			abortAllPrecaches();
		}
		engine?.sync(frame);
	},
	precacheViewport(
		id: number,
		viewport: Viewport,
		options?: Omit<PrecacheOptions, 'signal'>
	): Promise<PrecacheResult> {
		return runPrecache(id, async (signal) =>
			engine ? engine.precacheViewport(viewport, { ...options, signal }) : CANCELLED_PRECACHE_RESULT
		);
	},
	precacheBounds(
		id: number,
		bounds: Rect | undefined,
		mode: 'fit' | 'fill',
		options?: Omit<PrecacheOptions & ViewportFitOptions, 'signal'>
	): Promise<PrecacheResult> {
		return runPrecache(id, async (signal) =>
			engine
				? engine.precacheBounds(bounds, mode, { ...options, signal })
				: CANCELLED_PRECACHE_RESULT
		);
	},
	abortPrecache(id: number): void {
		precacheControllers.get(id)?.abort();
		precacheControllers.delete(id);
	},
	pauseLoading(reason?: string): void {
		engine?.pauseLoading(reason);
	},
	resumeLoading(reason?: string): void {
		engine?.resumeLoading(reason);
	},
	holdResolution(): void {
		engine?.holdResolution();
	},
	releaseResolution(): void {
		engine?.releaseResolution();
	}
};

export type TileEngineWorkerApi = typeof workerApi;

Comlink.expose(workerApi);
