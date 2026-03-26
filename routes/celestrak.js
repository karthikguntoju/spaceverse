/**
 * CelesTrak Integration Module
 *
 * Fetches real active satellite data from CelesTrak's free public API
 * (no API key required) and returns orbital object counts by regime.
 *
 * Data source: https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json
 * Each record uses the GP (General Perturbations) format with fields like
 * MEAN_MOTION, INCLINATION, ECCENTRICITY, etc.
 */

const axios = require('axios');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CELESTRAK_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json';

const EARTH_RADIUS_KM = 6371.0;
const GM = 3.986004418e5; // km³/s² (Earth gravitational parameter)

// How long to keep the cached result before re-fetching (10 minutes)
const CACHE_TTL_MS = 10 * 60 * 1000;

// Maximum number of satellites to parse per fetch (keeps it fast)
const MAX_SATELLITES = 50;

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let cache = null; // { data, fetchedAt }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive altitude (km) from mean motion (revolutions/day).
 * Uses vis-viva simplified for circular orbit: n = sqrt(GM / a³) → a (km).
 *
 * @param {number} meanMotionRevDay  Mean motion in revolutions per day
 * @returns {number} Altitude above Earth's surface in km
 */
function meanMotionToAltitude(meanMotionRevDay) {
  // Convert rev/day → rad/s
  const n = (meanMotionRevDay * 2 * Math.PI) / 86400;
  // Semi-major axis: a = (GM / n²)^(1/3)
  const semiMajorAxisKm = Math.cbrt(GM / (n * n));
  return semiMajorAxisKm - EARTH_RADIUS_KM;
}

/**
 * Classify altitude into orbit regime.
 *
 * @param {number} altitudeKm
 * @returns {'LEO'|'MEO'|'GEO'|'HEO'}
 */
function classifyOrbit(altitudeKm) {
  if (altitudeKm < 2000) return 'LEO';
  if (altitudeKm < 35000) return 'MEO';
  if (altitudeKm < 36500) return 'GEO'; // GEO band ≈ 35 786 km
  return 'HEO'; // Highly Elliptical Orbit — exclude from standard traffic counts
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch and return real satellite counts from CelesTrak, with TTL caching.
 *
 * Returns an object of the form:
 * {
 *   totalFetched,          // number of satellites actually parsed
 *   leoCount,              // objects in LEO (< 2 000 km)
 *   meoCount,              // objects in MEO (2 000 – 35 000 km)
 *   geoCount,              // objects in GEO band (≈ 35 786 km)
 *   byInclinationBand: {   // LEO objects grouped by inclination
 *     equatorial,          //  0 – 30°
 *     midInclination,      // 30 – 60°
 *     polar,               // 60 – 90°
 *     retrograde           // 90 – 180°
 *   },
 *   source,                // 'celestrak' | 'cache' | 'fallback'
 *   fetchedAt              // ISO timestamp of the underlying data
 * }
 *
 * @returns {Promise<Object>}
 */
async function getCelesTrakCounts() {
  // Return cached result if still fresh
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { ...cache.data, source: 'cache' };
  }

  try {
    const response = await axios.get(CELESTRAK_URL, { timeout: 8000 });
    const satellites = Array.isArray(response.data)
      ? response.data.slice(0, MAX_SATELLITES)
      : [];

    // Tally counts
    let leoCount = 0;
    let meoCount = 0;
    let geoCount = 0;
    const byInclinationBand = { equatorial: 0, midInclination: 0, polar: 0, retrograde: 0 };

    for (const sat of satellites) {
      const meanMotion = parseFloat(sat.MEAN_MOTION);
      const inclination = parseFloat(sat.INCLINATION);

      if (isNaN(meanMotion) || meanMotion <= 0) continue;

      const altitude = meanMotionToAltitude(meanMotion);
      const regime = classifyOrbit(altitude);

      if (regime === 'LEO') {
        leoCount++;
        // Bucket by inclination
        if (inclination < 30) byInclinationBand.equatorial++;
        else if (inclination < 60) byInclinationBand.midInclination++;
        else if (inclination <= 90) byInclinationBand.polar++;
        else byInclinationBand.retrograde++;
      } else if (regime === 'MEO') {
        meoCount++;
      } else if (regime === 'GEO') {
        geoCount++;
      }
      // HEO objects are counted but not added to standard traffic regimes
    }

    const data = {
      totalFetched: satellites.length,
      leoCount,
      meoCount,
      geoCount,
      byInclinationBand,
      fetchedAt: new Date().toISOString()
    };

    // Store in cache
    cache = { data, fetchedAt: Date.now() };

    return { ...data, source: 'celestrak' };
  } catch (error) {
    console.warn('CelesTrak fetch failed, using fallback counts:', error.message);

    // Return last cached data if available, otherwise hardcoded fallback
    if (cache) {
      return { ...cache.data, source: 'cache' };
    }

    // Hardcoded fallback based on publicly known approximate counts
    return {
      totalFetched: 0,
      leoCount: 3000,
      meoCount: 500,
      geoCount: 550,
      byInclinationBand: { equatorial: 200, midInclination: 800, polar: 1800, retrograde: 200 },
      fetchedAt: new Date().toISOString(),
      source: 'fallback'
    };
  }
}

module.exports = { getCelesTrakCounts };
