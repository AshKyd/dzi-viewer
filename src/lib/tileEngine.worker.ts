import { TileEngine } from './tileEngine.js';
import type {
	EngineInboundMessage,
	EngineOutboundMessage,
	TileEngineDelta
} from './tileEngineProtocol.js';
import type { PrecacheResult } from './types.js';

interface WorkerScope {
	onmessage: ((event: MessageEvent<EngineInboundMessage>) => void) | null;
	postMessage(message: EngineOutboundMessage, transfer?: Transferable[]): void;
}

const workerSelf = globalThis as unknown as WorkerScope;
const precacheControllers = new Map<number, AbortController>();

function postDelta(delta: TileEngineDelta): void {
	const transfer: Transferable[] = delta.addedTiles
		? delta.addedTiles.map((item) => item.bitmap)
		: [];

	try {
		workerSelf.postMessage({ type: 'delta', delta }, transfer);
	} catch {
		// Fallback if a `tileErrors` entry contains a non-cloneable error value.
		const safeDelta: TileEngineDelta = delta.tileErrors
			? {
					...delta,
					tileErrors: delta.tileErrors.map((err) => ({ ...err, error: String(err.error) }))
				}
			: delta;
		workerSelf.postMessage({ type: 'delta', delta: safeDelta }, transfer);
	}
}

const engine = new TileEngine({
	asyncBatchMs: 8,
	onDelta: postDelta
});

function abortAllPrecaches(): void {
	Array.from(precacheControllers.values()).forEach((controller) => controller.abort());
	precacheControllers.clear();
}

function runPrecache(id: number, start: (signal: AbortSignal) => Promise<PrecacheResult>): void {
	const controller = new AbortController();
	precacheControllers.set(id, controller);

	void start(controller.signal)
		.then((result) => {
			precacheControllers.delete(id);
			workerSelf.postMessage({ type: 'precacheResult', id, result });
		})
		.catch(() => {
			precacheControllers.delete(id);
			workerSelf.postMessage({
				type: 'precacheResult',
				id,
				result: { total: 0, loaded: 0, failed: 0, cancelled: true }
			});
		});
}

workerSelf.onmessage = (event: MessageEvent<EngineInboundMessage>) => {
	const message = event.data;

	switch (message.type) {
		case 'sync':
			if (message.frame.source) {
				abortAllPrecaches();
			}
			engine.applySync(message.frame);
			return;
		case 'precacheViewport':
			runPrecache(message.id, (signal) =>
				engine.precacheViewport(message.viewport, { ...message.options, signal })
			);
			return;
		case 'precacheBounds':
			runPrecache(message.id, (signal) =>
				engine.precacheBounds(message.bounds, message.mode, { ...message.options, signal })
			);
			return;
		case 'abortPrecache': {
			const controller = precacheControllers.get(message.id);
			if (controller) {
				controller.abort();
				precacheControllers.delete(message.id);
			}
			return;
		}
		case 'pauseLoading':
			engine.pauseLoading(message.reason);
			return;
		case 'resumeLoading':
			engine.resumeLoading(message.reason);
			return;
		case 'holdResolution':
			engine.holdResolution();
			return;
		case 'releaseResolution':
			engine.releaseResolution();
			return;
		case 'destroy':
			abortAllPrecaches();
			engine.destroy();
			return;
	}
};
