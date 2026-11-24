import { describe, expect, it, vi } from 'vitest';
import { createFrameLimiter, onAbort, pickDefined } from './cameraUtils.js';

describe('pickDefined', () => {
	it('drops undefined fields so they never override defaults', () => {
		expect({ duration: 600, ...pickDefined({ duration: undefined, curve: 'fly' }) }).toEqual({
			duration: 600,
			curve: 'fly'
		});
		expect(pickDefined(undefined)).toEqual({});
	});
});

describe('onAbort', () => {
	it('fires once on abort and can be detached', () => {
		const handler = vi.fn();
		const controller = new AbortController();
		onAbort(controller.signal, handler);
		controller.abort();
		controller.abort();
		expect(handler).toHaveBeenCalledOnce();

		const detached = vi.fn();
		const other = new AbortController();
		onAbort(other.signal, detached)();
		other.abort();
		expect(detached).not.toHaveBeenCalled();
	});
});

describe('createFrameLimiter', () => {
	it('renders every frame without a cap', () => {
		const shouldRender = createFrameLimiter();
		expect([0, 1, 2].map(shouldRender)).toEqual([true, true, true]);
	});

	it('keeps 30 fps on a 60 Hz clock despite jitter', () => {
		const shouldRender = createFrameLimiter(30);
		const frames = [0, 16.7, 32.9, 50, 66.4, 83.4];
		expect(frames.map(shouldRender)).toEqual([true, false, true, false, true, false]);
	});
});
