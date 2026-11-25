# Changelog

## [1.0.0](https://github.com/AshKyd/dzi-viewer/compare/v0.5.1...v1.0.0) (2026-11-25)

### ⚠ BREAKING CHANGES

* TileCache, TileLoader, CanvasTileRenderer, computeRenderPlan, subtractRect(s), standalone precacheViewport/precacheBounds, EMPTY_PRECACHE_RESULT, canvas sizing helpers, tile-grid builders and internal types (CachedTile, RenderLevelLayer, TileStatus, ViewportTileGrid) are no longer exported.

### Bug Fixes

* PanZoom coordinate helpers no longer return input unchanged before mount ([096f69c](https://github.com/AshKyd/dzi-viewer/commit/096f69cd240010eaf62893aeb9514eedd123208d))

### Code Refactoring

* limit public exports to the documented viewer API ([5126879](https://github.com/AshKyd/dzi-viewer/commit/5126879920d36563ed66056b0cc7ef04e004f52e))

## [0.5.1](https://github.com/AshKyd/dzi-viewer/compare/v0.5.0...v0.5.1) (2026-11-24)

### Bug Fixes

* bundle tile worker into dist so consumers' bundlers can load it ([3d75900](https://github.com/AshKyd/dzi-viewer/commit/3d759007e86e9975ccbc2e41b6d1b85d8cd1bfa2))

## [0.5.0](https://github.com/AshKyd/dzi-viewer/compare/v0.4.0...v0.5.0) (2026-11-24)

### Features

* use rapid-render 3d acceleration & workerise ([a41667e](https://github.com/AshKyd/dzi-viewer/commit/a41667e75e6814d47be58063d2d09362a358ffa1))

## [0.4.0](https://github.com/AshKyd/dzi-viewer/compare/v0.3.0...v0.4.0) (2026-11-23)

### Features

* limit fps ([086bc42](https://github.com/AshKyd/dzi-viewer/commit/086bc42496a3d57c356ff01547393392e1b6564a))

## [0.3.0](https://github.com/AshKyd/dzi-viewer/compare/v0.2.0...v0.3.0) (2026-11-23)

### Features

* export easeinout ([d0a32fe](https://github.com/AshKyd/dzi-viewer/commit/d0a32fe0c8fd749e3af51a9ad07b78d232baecc4))

## [0.2.0](https://github.com/AshKyd/dzi-viewer/compare/v0.1.0...v0.2.0) (2026-11-22)

### Features

* add camera transitions, overlays, initialView, and gesture load debouncing ([eaf7c2a](https://github.com/AshKyd/dzi-viewer/commit/eaf7c2ae4cf3587903b67baec38ae26d4d70d124))

## 0.1.0 (2026-11-20)

### Features

* add cooperativeGestures to PanZoom ([de8ce75](https://github.com/AshKyd/dzi-viewer/commit/de8ce75453e7c3ed9956715d7f6ab99f1169736e))
* conventional commit ([a916d7c](https://github.com/AshKyd/dzi-viewer/commit/a916d7cc1c3850032b80e51a7de181d46e77a9b4))
* default to 16 parallel tile loads and add pause/resume loading ([eca07c1](https://github.com/AshKyd/dzi-viewer/commit/eca07c128fc890ba0f4819da26f2b276531ae785))
* static demo site with a landing page ([09e79f4](https://github.com/AshKyd/dzi-viewer/commit/09e79f44b2f534dd4a72d6a4d0f9c031251e29a5))

### Performance Improvements

* smoother zooming and tile swaps ([7438b82](https://github.com/AshKyd/dzi-viewer/commit/7438b82133769b8f1dc17fce2c8323701390ded8))
