import type { ColorPalette, CompiledScene, ElementState, Geometry } from './types.js';
import { paletteResolver } from './palette.js';
import { textTex } from './render-geometry.js';
import { layoutLatex, layoutLatexGeometry, validateLatexMap } from './latex.js';
import { resolveAssetGeometry } from './asset-geometry.js';
import type { AssetGeometryResolver } from './asset-types.js';

/** CPU preparation shared by author validation and both rendering backends. */
export function validateRenderableScene(scene: CompiledScene, hostPalette?: ColorPalette, assetGeometry?: AssetGeometryResolver): void {
  const prepareGeometry = (geometry: Geometry): void => {
    geometry=resolveAssetGeometry(geometry,assetGeometry);
    if(geometry.imageTexture) {
      if(!assetGeometry?.resolveImage)throw new Error('Image texture requires a held image lease');
      assetGeometry.resolveImage(geometry.imageTexture.image);
    }
    if (geometry.kind === 'latex') layoutLatexGeometry(geometry);
    if (geometry.kind === 'text') layoutLatex(textTex(geometry.text ?? ''));
  };
  const palette = paletteResolver(hostPalette ?? scene.options.palette);
  const prepareElement = (element: ElementState): void => {
    prepareGeometry(element.geometry); palette.resolve(element.fill); palette.resolve(element.stroke);
  };
  palette.resolve(scene.options.background);
  if (scene.options.lighting && scene.options.lighting !== 'studio' && scene.options.lighting.receiver) {
    palette.resolve(scene.options.lighting.receiver.fill ?? 'GREY_D');
  }
  for (const element of [...scene.initial, ...scene.lifecycle.flatMap(event => event.elements ?? [])]) prepareElement(element);
  for (const track of scene.tracks) {
    if (track.action.geometry) prepareGeometry(track.action.geometry);
    const properties = track.action.properties as Partial<ElementState> | undefined;
    if (properties?.fill) palette.resolve(properties.fill);
    if (properties?.stroke) palette.resolve(properties.stroke);
    for (const state of Object.values(track.from)) {
      prepareElement(state);
      if (track.action.type === 'morph' && track.action.geometry?.kind === 'latex' && state.geometry.kind === 'latex') {
        validateLatexMap(layoutLatexGeometry(state.geometry), layoutLatexGeometry(track.action.geometry), track.action.map);
      } else if (track.action.map && Object.keys(track.action.map).length) throw new Error('Part mappings require a LaTeX-to-LaTeX morph.');
    }
  }
}
