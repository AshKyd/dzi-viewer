import { byGridPosition, computeLayerOrigin } from './retention.js';
import type { CachedTile, Point, RenderLevelLayer } from './types.js';

/** Default number of new tiles mounted per animation frame. Removals get twice this. */
export const DEFAULT_MAX_TILE_MOUNTS_PER_FRAME = 8;

export interface LimitTileChangesParams {
	/** Layers currently in the DOM (the previous result). */
	readonly displayed: readonly RenderLevelLayer[];
	/** Layers the render plan wants in the DOM. */
	readonly planned: readonly RenderLevelLayer[];
	/** Most tiles to add this frame. `Infinity` applies the plan as-is. */
	readonly maxAdds: number;
	/** Most tiles to remove this frame. */
	readonly maxRemoves: number;
	/** Viewport centre in stage coordinates; tiles nearest it are added first and removed last. */
	readonly viewportCentre: Point;
}

export interface LimitedTileChanges {
	readonly layers: readonly RenderLevelLayer[];
	/** True when some adds or removes were deferred to a later frame. */
	readonly pending: boolean;
}

interface PlacedTile {
	readonly tile: CachedTile;
	readonly layer: RenderLevelLayer;
}

function distanceSqFrom(centre: Point, tile: CachedTile): number {
	const dx = tile.stageRect.x + tile.stageRect.width / 2 - centre.x;
	const dy = tile.stageRect.y + tile.stageRect.height / 2 - centre.y;
	return dx * dx + dy * dy;
}

function flattenLayers(layers: readonly RenderLevelLayer[]): PlacedTile[] {
	return layers.flatMap((layer) => layer.tiles.map((tile) => ({ tile, layer })));
}

function withTiles(
	layer: RenderLevelLayer,
	tiles: CachedTile[],
	zIndex = layer.zIndex
): RenderLevelLayer {
	const sortedTiles = tiles.sort(byGridPosition);
	return { ...layer, zIndex, origin: computeLayerOrigin(sortedTiles), tiles: sortedTiles };
}

/**
 * Moves the displayed layers towards the planned layers by a limited number of tile adds and removes.
 *
 * Svelte creates or destroys every changed tile element in one update, so when a zoom lands and a whole
 * level swaps in, one frame can take 100+ ms. Spreading the changes over several frames is safe:
 * - A tile added late just leaves the coarser fallback showing a little longer. The render plan only
 *   drops a fallback once the tile above it is in the DOM and opaque.
 * - A tile removed late sits at its correct position in the image, either under the new tiles (its own
 *   layer goes to `zIndex: 0`) or merged into its level's layer, so it never shows the wrong content.
 */
export function limitTileChanges({
	displayed,
	planned,
	maxAdds,
	maxRemoves,
	viewportCentre
}: LimitTileChangesParams): LimitedTileChanges {
	if (maxAdds === Number.POSITIVE_INFINITY && maxRemoves === Number.POSITIVE_INFINITY) {
		return { layers: planned, pending: false };
	}

	const plannedTiles = flattenLayers(planned);
	const displayedTiles = flattenLayers(displayed);
	const plannedKeys = new Set(plannedTiles.map(({ tile }) => tile.key));
	const displayedKeys = new Set(displayedTiles.map(({ tile }) => tile.key));

	// --- Choose which tiles change this frame ---

	// Optimal-level tiles first (they're what the user is waiting for), then centre-first.
	const adds = plannedTiles
		.filter(({ tile }) => !displayedKeys.has(tile.key))
		.sort(
			(a, b) =>
				Number(b.layer.isOptimal) - Number(a.layer.isOptimal) ||
				distanceSqFrom(viewportCentre, a.tile) - distanceSqFrom(viewportCentre, b.tile)
		);
	// Farthest from the centre goes first: it's the least likely to be noticed lingering.
	const removes = displayedTiles
		.filter(({ tile }) => !plannedKeys.has(tile.key))
		.sort(
			(a, b) => distanceSqFrom(viewportCentre, b.tile) - distanceSqFrom(viewportCentre, a.tile)
		);

	if (adds.length === 0 && removes.length === 0) {
		return { layers: planned, pending: false };
	}

	const addedKeys = new Set(adds.slice(0, Math.max(1, maxAdds)).map(({ tile }) => tile.key));
	const lingering = removes.slice(Math.max(1, maxRemoves));

	// --- Rebuild the layers ---

	const plannedLevels = new Set(planned.map((layer) => layer.level));
	// Not `Map.groupBy`: it needs Safari 17.4+.
	const lingeringByLevel = lingering.reduce((groups, placed) => {
		groups.set(placed.tile.level, [...(groups.get(placed.tile.level) ?? []), placed]);
		return groups;
	}, new Map<number, PlacedTile[]>());

	const keptPlannedLayers = planned
		.map((layer) =>
			withTiles(layer, [
				...layer.tiles.filter((tile) => displayedKeys.has(tile.key) || addedKeys.has(tile.key)),
				...(lingeringByLevel.get(layer.level) ?? []).map(({ tile }) => tile)
			])
		)
		.filter((layer) => layer.tiles.length > 0);

	// Levels that dropped out of the plan keep their remaining tiles underneath everything else.
	const lingeringLayers = Array.from(lingeringByLevel)
		.filter(([level]) => !plannedLevels.has(level))
		.map(([, placed]) => {
			const [{ layer }] = placed;
			return withTiles(
				{ ...layer, isOptimal: false },
				placed.map(({ tile }) => tile),
				0
			);
		});

	return {
		layers: [...lingeringLayers, ...keptPlannedLayers],
		pending: addedKeys.size < adds.length || lingering.length > 0
	};
}
