import { describe, expect, it } from 'vitest';
import { splitBindableProps } from './vanillaUtils.js';

describe('splitBindableProps', () => {
	it('separates bindable viewport fields from pass-through configuration props', () => {
		const { bindables, rest } = splitBindableProps({
			x: 400,
			y: 250,
			zoom: 1.5,
			maxDpr: 1.25,
			tileFadeDuration: 300,
			panEnabled: false
		});

		expect(bindables).toEqual({ x: 400, y: 250, zoom: 1.5 });
		expect(rest).toEqual({
			maxDpr: 1.25,
			tileFadeDuration: 300,
			panEnabled: false
		});
	});

	it('drops undefined bindable fields and onStateChange so config updates do not reset position', () => {
		const { bindables, rest } = splitBindableProps({
			x: undefined,
			tileFadeDuration: 150,
			constraints: undefined,
			onStateChange: () => undefined
		});

		expect(bindables).toEqual({});
		// `undefined` pass-through values are kept: that is how a caller clears an option.
		expect(rest).toEqual({ tileFadeDuration: 150, constraints: undefined });
	});
});
