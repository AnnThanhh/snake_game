// Hydrated from the versioned API catalog. No runtime seed fallback.
export let SPECIES=[],SEGMENT_DEFS={},UPGRADE_DEFS=[];
export function configureContent(catalog){SPECIES=structuredClone(catalog.species);SEGMENT_DEFS=structuredClone(catalog.segments);UPGRADE_DEFS=structuredClone(catalog.upgradesList);}
