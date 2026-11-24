import { getMaxLevel } from './pyramid.js';
import type {
	DisplayRect,
	DziDescriptor,
	DziJsonInput,
	DziLoadOptions,
	DziSourceInput
} from './types.js';

// --- URL & Source Resolution ---

/**
 * Derives the Deep Zoom tiles directory URL and preserved query string from a `.dzi` descriptor URL.
 */
export function resolveTilesUrlFromDziUrl(url: string): {
	readonly tilesUrl: string;
	readonly queryParams: string;
} {
	const queryMatch = url.match(/(\?.*)$/);
	const queryParams = queryMatch ? queryMatch[1] : '';
	const pathWithoutQuery = queryParams ? url.slice(0, -queryParams.length) : url;
	const tilesUrl = pathWithoutQuery.replace(/([^/]+?)(?:\.(?:dzi|xml|json|js))?\/?$/i, '$1_files/');

	return { tilesUrl, queryParams };
}

function isDziDescriptor(source: DziSourceInput): source is DziDescriptor {
	return typeof source === 'object' && source !== null && 'width' in source && 'tileSize' in source;
}

function isDziJsonInput(source: DziSourceInput): source is DziJsonInput {
	return typeof source === 'object' && source !== null && 'Image' in source;
}

function normaliseTilesUrl(tilesUrl: string): string {
	if (!tilesUrl) {
		return '';
	}
	return tilesUrl.endsWith('/') ? tilesUrl : `${tilesUrl}/`;
}

// --- XML & JSON Parsing ---

/** Reads DZI XML with the browser's `DOMParser` (tests install `@xmldom/xmldom` in its place). */
function parseXml(xml: string): DziJsonInput {
	if (typeof DOMParser === 'undefined') {
		throw new Error('Parsing DZI XML needs DOMParser, which this environment does not provide.');
	}
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	const root = doc.documentElement;

	if (!root || root.localName !== 'Image') {
		throw new Error('Invalid DZI XML: root element must be <Image>.');
	}

	const sizeNode =
		root.getElementsByTagName('Size')[0] ??
		(root.namespaceURI ? root.getElementsByTagNameNS(root.namespaceURI, 'Size')[0] : undefined);

	if (!sizeNode) {
		throw new Error('Invalid DZI XML: missing <Size> element.');
	}

	const displayRectElements = Array.from(root.getElementsByTagName('DisplayRect'));
	const displayRects = displayRectElements
		.map((node) => {
			const rectNode = node.getElementsByTagName('Rect')[0];
			if (!rectNode) {
				return null;
			}
			return {
				MinLevel: node.getAttribute('MinLevel') ?? '0',
				MaxLevel: node.getAttribute('MaxLevel') ?? '0',
				Rect: {
					X: rectNode.getAttribute('X') ?? '0',
					Y: rectNode.getAttribute('Y') ?? '0',
					Width: rectNode.getAttribute('Width') ?? '0',
					Height: rectNode.getAttribute('Height') ?? '0'
				}
			};
		})
		.filter((item): item is NonNullable<typeof item> => item !== null);

	return {
		Image: {
			xmlns: root.namespaceURI ?? undefined,
			Url: root.getAttribute('Url') ?? undefined,
			Format: root.getAttribute('Format') ?? 'jpg',
			Overlap: root.getAttribute('Overlap') ?? '0',
			TileSize: root.getAttribute('TileSize') ?? '256',
			Size: {
				Width: sizeNode.getAttribute('Width') ?? '0',
				Height: sizeNode.getAttribute('Height') ?? '0'
			},
			DisplayRects: displayRects.length > 0 ? displayRects : undefined
		}
	};
}

export interface DziParseOptions {
	/** URL the descriptor was fetched from; used to derive the `_files/` tiles URL and query string. */
	readonly sourceUrl?: string;
	readonly tilesUrl?: string;
	readonly getTileUrl?: DziDescriptor['getTileUrl'];
}

/**
 * Converts a Deep Zoom JSON object into a normalised `DziDescriptor`.
 */
export function parseDziJson(input: DziJsonInput, options?: DziParseOptions): DziDescriptor {
	const image = input.Image;
	const width = Number(image.Size.Width);
	const height = Number(image.Size.Height);
	const tileSize = Number(image.TileSize);
	const overlap = Number(image.Overlap);
	const format = image.Format;

	if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
		throw new Error('Invalid DZI dimensions: width and height must be positive numbers.');
	}

	if (!Number.isFinite(tileSize) || tileSize <= 0) {
		throw new Error('Invalid DZI tileSize: must be a positive number.');
	}

	const derived = options?.sourceUrl
		? resolveTilesUrlFromDziUrl(options.sourceUrl)
		: { tilesUrl: '', queryParams: '' };

	const tilesUrl = normaliseTilesUrl(options?.tilesUrl ?? image.Url ?? derived.tilesUrl);
	const maxLevel = getMaxLevel(width, height);

	const displayRects: readonly DisplayRect[] | undefined = image.DisplayRects?.map((entry) => ({
		x: Number(entry.Rect.X),
		y: Number(entry.Rect.Y),
		width: Number(entry.Rect.Width),
		height: Number(entry.Rect.Height),
		minLevel: Number(entry.MinLevel),
		maxLevel: Number(entry.MaxLevel)
	}));

	return {
		width,
		height,
		tileSize,
		overlap: Number.isFinite(overlap) ? Math.max(0, overlap) : 0,
		format,
		tilesUrl,
		queryParams: derived.queryParams || undefined,
		minLevel: 0,
		maxLevel,
		displayRects: displayRects && displayRects.length > 0 ? displayRects : undefined,
		getTileUrl: options?.getTileUrl
	};
}

/**
 * Parses a Deep Zoom `.dzi` XML string into a normalised `DziDescriptor`.
 */
export function parseDziXml(xml: string, options?: DziParseOptions): DziDescriptor {
	return parseDziJson(parseXml(xml), options);
}

/**
 * Loads and normalises any `DziSourceInput` (URL, inline JSON, or pre-parsed `DziDescriptor`).
 */
export async function loadDzi(
	source: DziSourceInput,
	options?: DziLoadOptions
): Promise<DziDescriptor> {
	if (isDziDescriptor(source)) {
		return {
			...source,
			tilesUrl: normaliseTilesUrl(options?.tilesUrl ?? source.tilesUrl),
			getTileUrl: options?.getTileUrl ?? source.getTileUrl
		};
	}

	if (isDziJsonInput(source)) {
		return parseDziJson(source, {
			tilesUrl: options?.tilesUrl,
			getTileUrl: options?.getTileUrl
		});
	}

	const fetchFn = options?.fetch ?? globalThis.fetch;
	const response = await fetchFn(source, { signal: options?.signal });

	if (!response.ok) {
		throw new Error(`Failed to fetch DZI descriptor (${response.status}): ${source}`);
	}

	const text = (await response.text()).trim();
	const parseOptions = {
		sourceUrl: source,
		tilesUrl: options?.tilesUrl,
		getTileUrl: options?.getTileUrl
	};

	if (text.startsWith('{')) {
		return parseDziJson(JSON.parse(text) as DziJsonInput, parseOptions);
	}

	return parseDziXml(text, parseOptions);
}
