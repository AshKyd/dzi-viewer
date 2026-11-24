import { describe, expect, it } from 'vitest';
import { toCloneable } from './utils.js';

describe('toCloneable', () => {
	it('copies nested objects and arrays and drops functions', () => {
		const input = {
			dzi: { width: 10, getTileUrl: () => 'x', rects: [{ x: 1 }] },
			crossOrigin: undefined
		};
		const output = toCloneable(input);

		expect(output).toEqual({ dzi: { width: 10, rects: [{ x: 1 }] }, crossOrigin: undefined });
		expect(output.dzi).not.toBe(input.dzi);
		expect('getTileUrl' in output.dzi).toBe(false);
		expect(() => structuredClone(output)).not.toThrow();
	});

	it('reads through proxies into plain objects', () => {
		const proxied = new Proxy({ x: 1, y: 2 }, {});
		expect(toCloneable(proxied)).toEqual({ x: 1, y: 2 });
	});
});
