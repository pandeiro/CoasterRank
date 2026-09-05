// Enthusiast-standard manufacturer abbreviations (punchlist §4.2), applied
// only in dense table contexts; the full name stays available via the title
// attribute (see CoasterTable). Shared util so other surfaces can adopt the
// same mapping.
export const MANUFACTURER_ABBREVIATIONS: Record<string, string> = {
  'Bolliger & Mabillard': 'B&M',
  'Custom Coasters International': 'CCI',
  'Great Coasters International': 'GCI',
  'Rocky Mountain Construction': 'RMC',
}
