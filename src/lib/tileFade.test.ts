import { describe, expect, it } from 'vitest';
import { TileFadeTracker } from './tileFade.js';

describe('TileFadeTracker', () => {
	it('fades from the first time a tile is drawn', () => {
		const fade = new TileFadeTracker();
		expect(fade.alphaAt('a', 1000, 200)).toBe(0);
		expect(fade.alphaAt('a', 1100, 200)).toBe(0.5);
		expect(fade.alphaAt('a', 1400, 200)).toBe(1);
		fade.restartFade('a');
		expect(fade.alphaAt('a', 1400, 200)).toBe(0);
	});

	it('reports each newly opaque tile to the engine once', () => {
		const fade = new TileFadeTracker();
		expect(fade.markOpaque('a')).toBe(true);
		expect(fade.markOpaque('a')).toBe(false);
		fade.markOpaque('b');
		fade.forget('b');
		expect(fade.takeNewlyOpaque()).toEqual(['a']);
		expect(fade.takeNewlyOpaque()).toEqual([]);
		expect(fade.isOpaque('a')).toBe(true);
	});
});
