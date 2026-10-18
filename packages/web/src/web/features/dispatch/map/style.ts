/**
 * The two looks of the dispatch map: ArrivePing Ink (the dark vector map) and
 * Satellite (Esri imagery dimmed into the same dark tone). Both carry their
 * data credit inside the style, so MapLibre's attribution control always shows
 * it.
 */
import type { StyleSpecification } from "maplibre-gl-6";
import ink from "../../../lib/basemap/arriveping-ink.style.json";

export type MapMode = "ink" | "satellite";

/** Already on the ink style's vector source; listed here for the tests and the docs. */
export const INK_CREDIT = "OpenFreeMap © OpenMapTiles Data from OpenStreetMap";
export const SAT_CREDIT = "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

/** A fresh copy each time: MapLibre mutates the object it is given. */
export function inkStyle(): StyleSpecification {
  return JSON.parse(JSON.stringify(ink)) as StyleSpecification;
}

export function satelliteStyle(): StyleSpecification {
  const world: GeoJSON.Feature<GeoJSON.Polygon> = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]],
    },
  };
  return {
    version: 8,
    // Same font server as the ink style, for the job-cluster counts.
    glyphs: (ink as { glyphs: string }).glyphs,
    sources: {
      imagery: {
        type: "raster",
        tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
        tileSize: 256,
        maxzoom: 19,
        attribution: SAT_CREDIT,
      },
      // Esri's label cache stops at z16; MapLibre upscales past it.
      labels: {
        type: "raster",
        tiles: [`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
        tileSize: 256,
        maxzoom: 16,
      },
      tint: { type: "geojson", data: world },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#070b12" } },
      { id: "imagery", type: "raster", source: "imagery", paint: { "raster-brightness-max": 0.8, "raster-saturation": -0.15 } },
      { id: "tint", type: "fill", source: "tint", paint: { "fill-color": "#070b12", "fill-opacity": 0.25 } },
      { id: "labels", type: "raster", source: "labels" },
    ],
  };
}
