import type {
	DisplayRect,
	DziDescriptor,
	DziJsonInput,
	DziLoadOptions,
	DziSourceInput,
	Rect,
	Size,
	TileGrid
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

function extractXmlAttributes(tagContent: string): Readonly<Record<string, string>> {
	const matches = Array.from(tagContent.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*["']([^"']*)["']/g));
	return matches.reduce<Record<string, string>>((acc, match) => {
		const [, key, value] = match;
		if (key !== undefined && value !== undefined) {
			acc[key] = value;
		}
		return acc;
	}, {});
}

function parseXmlFallback(xml: string): DziJsonInput {
	const imageMatch = xml.match(/<Image\b([^>]*)>/i);
	const sizeMatch = xml.match(/<Size\b([^>]*)\/?>/i);

	if (!imageMatch || !sizeMatch) {
		throw new Error('Invalid DZI XML: missing <Image> or <Size> element.');
	}

	const imageAttrs = extractXmlAttributes(imageMatch[1] ?? '');
	const sizeAttrs = extractXmlAttributes(sizeMatch[1] ?? '');

	const displayRectMatches = Array.from(
		xml.matchAll(/<DisplayRect\b([^>]*)>[\s\S]*?<Rect\b([^>]*)\/?>[\s\S]*?<\/DisplayRect>/gi)
	);
	const displayRects = displayRectMatches.map((match) => {
		const drAttrs = extractXmlAttributes(match[1] ?? '');
		const rectAttrs = extractXmlAttributes(match[2] ?? '');
		return {
			MinLevel: drAttrs.MinLevel ?? '0',
			MaxLevel: drAttrs.MaxLevel ?? '0',
			Rect: {
				X: rectAttrs.X ?? '0',
				Y: rectAttrs.Y ?? '0',
				Width: rectAttrs.Width ?? '0',
				Height: rectAttrs.Height ?? '0'
			}
		};
	});

	return {
		Image: {
			xmlns: imageAttrs.xmlns,
			Url: imageAttrs.Url,
			Format: imageAttrs.Format ?? 'jpg',
			Overlap: imageAttrs.Overlap ?? '0',
			TileSize: imageAttrs.TileSize ?? '256',
			Size: {
				Width: sizeAttrs.Width ?? '0',
				Height: sizeAttrs.Height ?? '0'
			},
			DisplayRects: displayRects.length > 0 ? displayRects : undefined
		}
	};
}

function parseXmlViaDomParser(xml: string): DziJsonInput {
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

export function getMaxLevel(width: number, height: number): number {
	return Math.ceil(Math.log2(Math.max(1, width, height)));
}

/** Every pyramid level from `minLevel` to `maxLevel`, lowest resolution first. */
export function getLevelRange(dzi: Pick<DziDescriptor, 'minLevel' | 'maxLevel'>): number[] {
	return Array.from(
		{ length: dzi.maxLevel - dzi.minLevel + 1 },
		(_, index) => dzi.minLevel + index
	);
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
	const jsonInput =
		typeof DOMParser !== 'undefined' ? parseXmlViaDomParser(xml) : parseXmlFallback(xml);
	return parseDziJson(jsonInput, options);
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

// --- Pyramid Geometry ---

export function getLevelScale(maxLevel: number, level: number): number {
	return 1 / 2 ** (maxLevel - level);
}

/**
 * Level sizes per descriptor object. `getLevelSize` runs several times per visible tile on every animation
 * frame, so each level's size is worked out once. Descriptors are treated as immutable.
 */
const levelSizeCache = new WeakMap<object, Map<number, Size>>();

/**
 * Returns the pixel dimensions of pyramid `level` using Deep Zoom integer halving (`ceil(dim / 2^(maxLevel - level))`).
 */
export function getLevelSize(
	dzi: Pick<DziDescriptor, 'width' | 'height' | 'maxLevel'>,
	level: number
): Size {
	const sizes = levelSizeCache.get(dzi) ?? new Map<number, Size>();
	levelSizeCache.set(dzi, sizes);

	const cached = sizes.get(level);
	if (cached) {
		return cached;
	}

	const divisor = 2 ** (dzi.maxLevel - level);
	const size: Size = {
		width: Math.max(1, Math.ceil(dzi.width / divisor)),
		height: Math.max(1, Math.ceil(dzi.height / divisor))
	};
	sizes.set(level, size);
	return size;
}

export function getLevelGrid(
	dzi: Pick<DziDescriptor, 'width' | 'height' | 'tileSize' | 'maxLevel'>,
	level: number
): TileGrid {
	const levelSize = getLevelSize(dzi, level);
	return {
		cols: Math.ceil(levelSize.width / dzi.tileSize),
		rows: Math.ceil(levelSize.height / dzi.tileSize)
	};
}

/**
 * Returns a tile's position and dimensions in level-native pixels, including DZI overlap on interior edges.
 */
export function getTilePixelRect(
	dzi: Pick<DziDescriptor, 'width' | 'height' | 'tileSize' | 'overlap' | 'maxLevel'>,
	level: number,
	col: number,
	row: number
): Rect {
	const levelSize = getLevelSize(dzi, level);
	const x = col === 0 ? 0 : col * dzi.tileSize - dzi.overlap;
	const y = row === 0 ? 0 : row * dzi.tileSize - dzi.overlap;
	const rawWidth = dzi.tileSize + (col === 0 ? 1 : 2) * dzi.overlap;
	const rawHeight = dzi.tileSize + (row === 0 ? 1 : 2) * dzi.overlap;

	return {
		x,
		y,
		width: Math.max(0, Math.min(rawWidth, levelSize.width - x)),
		height: Math.max(0, Math.min(rawHeight, levelSize.height - y))
	};
}

/**
 * Returns a tile's non-overlapping logical footprint projected into virtual stage coordinates.
 * Used for viewport culling and exact coverage subtraction without overlap double-counting.
 */
export function getTileStageRect(
	dzi: Pick<DziDescriptor, 'width' | 'height' | 'tileSize' | 'maxLevel'>,
	level: number,
	col: number,
	row: number,
	imageBounds: Rect
): Rect {
	const levelSize = getLevelSize(dzi, level);
	const logicalX = col * dzi.tileSize;
	const logicalY = row * dzi.tileSize;
	const logicalWidth = Math.max(0, Math.min(dzi.tileSize, levelSize.width - logicalX));
	const logicalHeight = Math.max(0, Math.min(dzi.tileSize, levelSize.height - logicalY));

	return {
		x: imageBounds.x + (logicalX / levelSize.width) * imageBounds.width,
		y: imageBounds.y + (logicalY / levelSize.height) * imageBounds.height,
		width: (logicalWidth / levelSize.width) * imageBounds.width,
		height: (logicalHeight / levelSize.height) * imageBounds.height
	};
}

export function getTileUrl(dzi: DziDescriptor, level: number, col: number, row: number): string {
	if (dzi.getTileUrl) {
		return dzi.getTileUrl(level, col, row);
	}
	return `${dzi.tilesUrl}${level}/${col}_${row}.${dzi.format}${dzi.queryParams ?? ''}`;
}

export function tileExists(dzi: DziDescriptor, level: number, col: number, row: number): boolean {
	if (level < dzi.minLevel || level > dzi.maxLevel) {
		return false;
	}

	const grid = getLevelGrid(dzi, level);
	if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) {
		return false;
	}

	if (!dzi.displayRects || dzi.displayRects.length === 0) {
		return true;
	}

	const rectsForLevel = dzi.displayRects.filter(
		(rect) => level >= rect.minLevel && level <= rect.maxLevel
	);
	if (rectsForLevel.length === 0) {
		return true;
	}

	const scale = getLevelScale(dzi.maxLevel, level);
	return rectsForLevel.some((rect) => {
		const colMin = Math.floor((rect.x * scale) / dzi.tileSize);
		const rowMin = Math.floor((rect.y * scale) / dzi.tileSize);
		const colMax = Math.ceil(((rect.x + rect.width) * scale) / dzi.tileSize);
		const rowMax = Math.ceil(((rect.y + rect.height) * scale) / dzi.tileSize);
		return col >= colMin && col < colMax && row >= rowMin && row < rowMax;
	});
}

/**
 * Returns the highest pyramid level that still fits inside a single 1x1 tile.
 */
export function getClosestSingleTileLevel(dzi: DziDescriptor): number {
	const singleTileLevels = getLevelRange(dzi).filter((level) => {
		const grid = getLevelGrid(dzi, level);
		return grid.cols === 1 && grid.rows === 1;
	});

	return singleTileLevels.at(-1) ?? dzi.minLevel;
}
