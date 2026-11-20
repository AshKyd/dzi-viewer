import type { DziDescriptor, Size } from '../types.js';

/** Viewer state that the vanilla API reads back from the mounted component. */
export interface ViewerStateSnapshot {
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
	readonly containerSize: Size;
	readonly dzi: DziDescriptor | null;
	readonly isOptimalLoaded: boolean;
}

/** Props that are two-way bound to the mounted component rather than passed straight through. */
export const BINDABLE_KEYS = [
	'x',
	'y',
	'zoom',
	'containerSize',
	'dzi',
	'isOptimalLoaded'
] as const satisfies readonly (keyof ViewerStateSnapshot)[];

export type BindableKey = (typeof BINDABLE_KEYS)[number];

export type BindableValues = { -readonly [K in BindableKey]?: ViewerStateSnapshot[K] };

function isBindableKey(key: string): key is BindableKey {
	return (BINDABLE_KEYS as readonly string[]).includes(key);
}

/**
 * Splits a partial props update into bindable-field changes and pass-through props.
 * Bindable fields set to `undefined` are dropped so updating other options never resets pan/zoom.
 * Pass-through props keep `undefined` values, because that is how a caller clears an option.
 */
export function splitBindableProps(props: object): {
	readonly bindables: BindableValues;
	readonly rest: Record<string, unknown>;
} {
	const entries: [string, unknown][] = Object.entries(props);
	const bindableEntries = entries.filter(
		(entry): entry is [BindableKey, unknown] => isBindableKey(entry[0]) && entry[1] !== undefined
	);

	return {
		// Values aren't checked at runtime; callers are typed through `BindableValues`.
		bindables: Object.fromEntries(bindableEntries),
		rest: Object.fromEntries(
			entries.filter(([key]) => !isBindableKey(key) && key !== 'onStateChange')
		)
	};
}
