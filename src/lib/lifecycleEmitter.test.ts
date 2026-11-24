import { describe, expect, it, vi } from 'vitest';
import { createLifecycleEmitter } from './lifecycleEmitter.js';

describe('createLifecycleEmitter', () => {
	it('calls listeners until they unsubscribe', () => {
		const emitter = createLifecycleEmitter();
		const listener = vi.fn();
		const unsubscribe = emitter.subscribe(listener);

		emitter.emit({ type: 'source-change' });
		unsubscribe();
		emitter.emit({ type: 'source-change' });

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('keeps notifying other listeners when one throws', () => {
		const emitter = createLifecycleEmitter();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const after = vi.fn();
		emitter.subscribe(() => {
			throw new Error('boom');
		});
		emitter.subscribe(after);

		emitter.emit({ type: 'destroy' });

		expect(after).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledOnce();
		consoleError.mockRestore();
	});

	it('clear() removes every listener', () => {
		const emitter = createLifecycleEmitter();
		const listener = vi.fn();
		emitter.subscribe(listener);
		emitter.clear();
		emitter.emit({ type: 'destroy' });
		expect(listener).not.toHaveBeenCalled();
	});
});
