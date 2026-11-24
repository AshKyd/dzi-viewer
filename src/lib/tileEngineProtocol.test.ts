import { describe, expect, it } from 'vitest';
import { pickEngineConfig } from './tileEngineProtocol.js';

describe('pickEngineConfig', () => {
	it('keeps set engine fields and drops renderer-only and unset ones', () => {
		expect(
			pickEngineConfig({
				maxDpr: 2,
				quality: undefined,
				tileFadeDuration: 0
			} as Parameters<typeof pickEngineConfig>[0])
		).toEqual({ maxDpr: 2 });
	});

	it('keeps an explicit crossOrigin: undefined so callers can clear it', () => {
		const picked = pickEngineConfig({ crossOrigin: undefined });
		expect('crossOrigin' in picked).toBe(true);
	});
});
