/**
 * Advanced Orbital Mechanics Module
 * 
 * This module provides enhanced orbital mechanics calculations for the Space Traffic Simulator,
 * including perturbation modeling, multi-body gravitational effects, and precise orbital propagation.
 */

// Physical constants
const EARTH_RADIUS = 6371.0; // km
const EARTH_MASS = 5.972e24; // kg
const GRAVITATIONAL_CONSTANT = 6.67430e-11; // m³/kg⋅s²
const EARTH_GRAVITATIONAL_PARAMETER = 3.986004418e14; // m³/s²
const J2_EARTH = 1.08263e-3; // Earth's second zonal harmonic
const ATMOSPHERIC_DENSITY_AT_SEA_LEVEL = 1.225; // kg/m³
const SCALE_HEIGHT = 8.5; // km

/**
 * Convert Keplerian elements to Cartesian coordinates
 * @param {Object} elements - Keplerian elements {semiMajorAxis, eccentricity, inclination, raan, argumentOfPerigee, trueAnomaly}
 * @returns {Object} Cartesian coordinates {position: [x, y, z], velocity: [vx, vy, vz]}
 */
function keplerianToCartesian(elements) {
    const {
        semiMajorAxis,
        eccentricity,
        inclination,
        raan,
        argumentOfPerigee,
        trueAnomaly
    } = elements;

    // Convert angles to radians
    const incRad = inclination * Math.PI / 180;
    const raanRad = raan * Math.PI / 180;
    const argPeriRad = argumentOfPerigee * Math.PI / 180;
    const trueAnomRad = trueAnomaly * Math.PI / 180;

    // Calculate distance and velocity magnitude
    const r = semiMajorAxis * (1 - eccentricity * eccentricity) / (1 + eccentricity * Math.cos(trueAnomRad));
    const mu = EARTH_GRAVITATIONAL_PARAMETER;
    const v = Math.sqrt(mu * (2 / r - 1 / semiMajorAxis));

    // Position in orbital plane
    const xOrb = r * Math.cos(trueAnomRad);
    const yOrb = r * Math.sin(trueAnomRad);

    // Velocity in orbital plane
    const vxOrb = (mu / r) * (-Math.sin(trueAnomRad));
    const vyOrb = (mu / r) * (eccentricity + Math.cos(trueAnomRad));

    // Rotation matrices
    const cosInc = Math.cos(incRad);
    const sinInc = Math.sin(incRad);
    const cosRaan = Math.cos(raanRad);
    const sinRaan = Math.sin(raanRad);
    const cosArgPeri = Math.cos(argPeriRad);
    const sinArgPeri = Math.sin(argPeriRad);

    // Transform to ECI coordinates
    const x = (cosRaan * cosArgPeri - sinRaan * sinArgPeri * cosInc) * xOrb +
              (-cosRaan * sinArgPeri - sinRaan * cosArgPeri * cosInc) * yOrb;

    const y = (sinRaan * cosArgPeri + cosRaan * sinArgPeri * cosInc) * xOrb +
              (-sinRaan * sinArgPeri + cosRaan * cosArgPeri * cosInc) * yOrb;

    const z = (sinArgPeri * sinInc) * xOrb +
              (cosArgPeri * sinInc) * yOrb;

    const vx = (cosRaan * cosArgPeri - sinRaan * sinArgPeri * cosInc) * vxOrb +
               (-cosRaan * sinArgPeri - sinRaan * cosArgPeri * cosInc) * vyOrb;

    const vy = (sinRaan * cosArgPeri + cosRaan * sinArgPeri * cosInc) * vxOrb +
               (-sinRaan * sinArgPeri + cosRaan * cosArgPeri * cosInc) * vyOrb;

    const vz = (sinArgPeri * sinInc) * vxOrb +
               (cosArgPeri * sinInc) * vyOrb;

    return {
        position: [x, y, z],
        velocity: [vx, vy, vz]
    };
}

/**
 * Calculate J2 perturbation effects
 * @param {Array} position - Satellite position [x, y, z] in meters
 * @param {Array} velocity - Satellite velocity [vx, vy, vz] in m/s
 * @returns {Object} Perturbation accelerations {ax, ay, az}
 */
function calculateJ2Perturbation(position, velocity) {
    const [x, y, z] = position;
    const r = Math.sqrt(x * x + y * y + z * z);
    const r2 = r * r;
    const r3 = r2 * r;
    const r5 = r3 * r2;
    const r7 = r5 * r2;

    const z2 = z * z;
    const z2_r2 = z2 / r2;

    // J2 perturbation accelerations
    const factor = 1.5 * J2_EARTH * EARTH_GRAVITATIONAL_PARAMETER * EARTH_RADIUS * EARTH_RADIUS;

    const ax = factor * (x / r7) * (1 - 5 * z2_r2) +
               factor * (x / r5) * (7 * z2_r2);

    const ay = factor * (y / r7) * (1 - 5 * z2_r2) +
               factor * (y / r5) * (7 * z2_r2);

    const az = factor * (z / r7) * (3 - 5 * z2_r2) +
               factor * (z / r5) * (7 * z2_r2 - 3);

    return { ax, ay, az };
}

/**
 * Calculate atmospheric drag
 * @param {Array} position - Satellite position [x, y, z] in meters
 * @param {Array} velocity - Satellite velocity [vx, vy, vz] in m/s
 * @param {number} mass - Satellite mass in kg
 * @param {number} dragCoefficient - Drag coefficient (Cd)
 * @param {number} crossSectionalArea - Cross-sectional area in m²
 * @returns {Object} Drag forces {fx, fy, fz}
 */
function calculateAtmosphericDrag(position, velocity, mass, dragCoefficient, crossSectionalArea) {
    const [x, y, z] = position;
    const [vx, vy, vz] = velocity;

    // Calculate altitude
    const r = Math.sqrt(x * x + y * y + z * z);
    const altitude = r / 1000 - EARTH_RADIUS; // km

    // Atmospheric density model (exponential decay)
    const density = ATMOSPHERIC_DENSITY_AT_SEA_LEVEL * Math.exp(-altitude / SCALE_HEIGHT);

    // Relative velocity (assuming rotating atmosphere)
    const vRelX = vx;
    const vRelY = vy;
    const vRelZ = vz;
    const vRelMagnitude = Math.sqrt(vRelX * vRelX + vRelY * vRelY + vRelZ * vRelZ);

    // Drag force calculation
    const dragForceMagnitude = 0.5 * density * vRelMagnitude * vRelMagnitude * dragCoefficient * crossSectionalArea;

    // Drag force components (opposite to velocity direction)
    const fx = -dragForceMagnitude * (vRelX / vRelMagnitude);
    const fy = -dragForceMagnitude * (vRelY / vRelMagnitude);
    const fz = -dragForceMagnitude * (vRelZ / vRelMagnitude);

    return { fx, fy, fz };
}

/**
 * Propagate orbit with perturbations using numerical integration
 * @param {Object} initialState - Initial state {position: [x, y, z], velocity: [vx, vy, vz]}
 * @param {number} timeStep - Time step in seconds
 * @param {number} duration - Propagation duration in seconds
 * @param {Object} satelliteParams - Satellite parameters {mass, dragCoefficient, crossSectionalArea}
 * @returns {Array} Trajectory points [{position, velocity, time}]
 */
function propagateOrbitWithPerturbations(initialState, timeStep, duration, satelliteParams) {
    const { position, velocity } = initialState;
    const { mass, dragCoefficient, crossSectionalArea } = satelliteParams;

    let currentPosition = [...position];
    let currentVelocity = [...velocity];
    const trajectory = [];

    for (let t = 0; t <= duration; t += timeStep) {
        // Store current state
        trajectory.push({
            position: [...currentPosition],
            velocity: [...currentVelocity],
            time: t
        });

        // Calculate gravitational acceleration
        const r = Math.sqrt(
            currentPosition[0] * currentPosition[0] +
            currentPosition[1] * currentPosition[1] +
            currentPosition[2] * currentPosition[2]
        );

        const r3 = r * r * r;
        const mu_r3 = EARTH_GRAVITATIONAL_PARAMETER / r3;

        let ax = -mu_r3 * currentPosition[0];
        let ay = -mu_r3 * currentPosition[1];
        let az = -mu_r3 * currentPosition[2];

        // Add J2 perturbation
        const j2Pert = calculateJ2Perturbation(currentPosition, currentVelocity);
        ax += j2Pert.ax;
        ay += j2Pert.ay;
        az += j2Pert.az;

        // Add atmospheric drag if in LEO
        const altitude = r / 1000 - EARTH_RADIUS;
        if (altitude < 1000) { // Only apply drag in LEO
            const dragForces = calculateAtmosphericDrag(
                currentPosition,
                currentVelocity,
                mass,
                dragCoefficient,
                crossSectionalArea
            );

            ax += dragForces.fx / mass;
            ay += dragForces.fy / mass;
            az += dragForces.fz / mass;
        }

        // Update velocity (Euler integration - for production, use Runge-Kutta)
        currentVelocity[0] += ax * timeStep;
        currentVelocity[1] += ay * timeStep;
        currentVelocity[2] += az * timeStep;

        // Update position
        currentPosition[0] += currentVelocity[0] * timeStep;
        currentPosition[1] += currentVelocity[1] * timeStep;
        currentPosition[2] += currentVelocity[2] * timeStep;
    }

    return trajectory;
}

/**
 * Calculate orbital elements from position and velocity
 * @param {Array} position - Position vector [x, y, z] in meters
 * @param {Array} velocity - Velocity vector [vx, vy, vz] in m/s
 * @returns {Object} Orbital elements {semiMajorAxis, eccentricity, inclination, raan, argumentOfPerigee, trueAnomaly}
 */
function cartesianToKeplerian(position, velocity) {
    const [x, y, z] = position;
    const [vx, vy, vz] = velocity;

    const r = Math.sqrt(x * x + y * y + z * z);
    const v2 = vx * vx + vy * vy + vz * vz;
    const mu = EARTH_GRAVITATIONAL_PARAMETER;

    // Specific angular momentum vector
    const hx = y * vz - z * vy;
    const hy = z * vx - x * vz;
    const hz = x * vy - y * vx;
    const h = Math.sqrt(hx * hx + hy * hy + hz * hz);

    // Eccentricity vector
    const evx = ((v2 - mu / r) * x - (x * vx + y * vy + z * vz) * vx) / mu;
    const evy = ((v2 - mu / r) * y - (x * vx + y * vy + z * vz) * vy) / mu;
    const evz = ((v2 - mu / r) * z - (x * vx + y * vy + z * vz) * vz) / mu;
    const e = Math.sqrt(evx * evx + evy * evy + evz * evz);

    // Semi-major axis
    const semiMajorAxis = 1 / (2 / r - v2 / mu);

    // Inclination
    const inclination = Math.acos(hz / h) * 180 / Math.PI;

    // Right ascension of ascending node
    let raan = Math.atan2(hx, -hy) * 180 / Math.PI;
    if (raan < 0) raan += 360;

    // Argument of periapsis
    const nodeVectorX = -hy;
    const nodeVectorY = hx;
    const node = Math.sqrt(nodeVectorX * nodeVectorX + nodeVectorY * nodeVectorY);

    let argumentOfPerigee;
    if (node !== 0) {
        argumentOfPerigee = Math.acos((nodeVectorX * evx + nodeVectorY * evy) / (node * e)) * 180 / Math.PI;
        if (evz < 0) argumentOfPerigee = 360 - argumentOfPerigee;
    } else {
        argumentOfPerigee = Math.acos(evx / e) * 180 / Math.PI;
    }

    // True anomaly
    let trueAnomaly;
    if (e !== 0) {
        trueAnomaly = Math.acos((evx * x + evy * y + evz * z) / (e * r)) * 180 / Math.PI;
        const rv = x * vx + y * vy + z * vz;
        if (rv < 0) trueAnomaly = 360 - trueAnomaly;
    } else {
        const nodeVectorX = -hy;
        const nodeVectorY = hx;
        trueAnomaly = Math.acos((nodeVectorX * x + nodeVectorY * y) / (node * r)) * 180 / Math.PI;
        if (z < 0) trueAnomaly = 360 - trueAnomaly;
    }

    return {
        semiMajorAxis: semiMajorAxis / 1000, // Convert to km
        eccentricity: e,
        inclination: inclination,
        raan: raan,
        argumentOfPerigee: argumentOfPerigee,
        trueAnomaly: trueAnomaly
    };
}

/**
 * Calculate collision probability between two objects
 * @param {Object} object1 - Object 1 state {position, velocity, covariance}
 * @param {Object} object2 - Object 2 state {position, velocity, covariance}
 * @returns {number} Collision probability (0-1)
 */
function calculateCollisionProbability(object1, object2) {
    // Simplified calculation - in a real implementation, this would use
    // Mahalanobis distance and probability integration
    
    const pos1 = object1.position;
    const pos2 = object2.position;
    
    // Calculate distance between objects
    const dx = pos1[0] - pos2[0];
    const dy = pos1[1] - pos2[1];
    const dz = pos1[2] - pos2[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    // Assume a combined collision radius (simplified)
    const combinedRadius = 10; // meters
    
    // Very simplified probability model
    if (distance < combinedRadius) {
        return 1.0;
    } else if (distance < combinedRadius * 10) {
        return Math.exp(-(distance - combinedRadius) / (combinedRadius * 2));
    } else {
        return 0.0;
    }
}

/**
 * Calculate orbital density considering perturbations.
 * When `realCounts` is provided (from CelesTrak), density is derived from
 * actual object counts instead of hardcoded baseline values.
 *
 * @param {number} altitude - Altitude in km
 * @param {number} inclination - Inclination in degrees
 * @param {Object} timeParams - Time parameters {startDate, endDate}
 * @param {Object|null} realCounts - Optional real counts from CelesTrak
 *   { leoCount, meoCount, geoCount }
 * @returns {Object} Density analysis {baseDensity, perturbedDensity, variationFactors}
 */
function calculatePerturbedOrbitalDensity(altitude, inclination, timeParams, realCounts) {
  // ------------------------------------------------------------------
  // Base density — use real counts if available, otherwise hardcoded
  // ------------------------------------------------------------------
  let baseDensity = 0.1;
  let orbitType = 'LEO';

  if (altitude < 2000) {
    orbitType = 'LEO';
    if (realCounts && realCounts.leoCount > 0) {
      // Normalise: LEO band spans 0–2000 km. We express density as
      // objects per 100 km altitude band, then scale to a 0–1 range
      // relative to a congested reference (5 000 objects → density 1.0).
      const REFERENCE_LEO_COUNT = 5000;
      baseDensity = Math.min(1.0, (realCounts.leoCount / REFERENCE_LEO_COUNT));
    } else {
      baseDensity = 0.45;
    }
  } else if (altitude < 35786) {
    orbitType = 'MEO';
    if (realCounts && realCounts.meoCount > 0) {
      const REFERENCE_MEO_COUNT = 600;
      baseDensity = Math.min(1.0, (realCounts.meoCount / REFERENCE_MEO_COUNT));
    } else {
      baseDensity = 0.15;
    }
  } else {
    orbitType = 'GEO';
    if (realCounts && realCounts.geoCount > 0) {
      const REFERENCE_GEO_COUNT = 600;
      baseDensity = Math.min(1.0, (realCounts.geoCount / REFERENCE_GEO_COUNT));
    } else {
      baseDensity = 0.05;
    }
  }

  // ------------------------------------------------------------------
  // Perturbation factors (unchanged from original)
  // ------------------------------------------------------------------

  // Adjust for inclination clustering
  const inclinationFactor = 1 - Math.abs(inclination - 90) / 90 * 0.3;

  // Adjust for altitude within orbital band
  let altitudeFactor = 1;
  if (orbitType === 'LEO') {
    altitudeFactor = 1 - Math.pow((altitude - 550) / 1000, 2);
  } else if (orbitType === 'GEO') {
    altitudeFactor = 1.2;
  }

  const perturbationFactors = {
    j2Effect: 1 + J2_EARTH * Math.sin(inclination * Math.PI / 180),
    atmosphericDrag: orbitType === 'LEO' ? 1 + (1000 - altitude) / 1000 * 0.2 : 1,
    solarRadiationPressure: 1 + 0.05 * Math.sin(Date.now() / 86400000),
    lunarGravity: 1 + 0.02 * Math.sin(Date.now() / 2592000000)
  };

  const perturbedDensity = baseDensity *
    inclinationFactor *
    altitudeFactor *
    perturbationFactors.j2Effect *
    perturbationFactors.atmosphericDrag *
    perturbationFactors.solarRadiationPressure *
    perturbationFactors.lunarGravity;

  return {
    baseDensity,
    perturbedDensity,
    variationFactors: perturbationFactors,
    orbitType,
    usingRealCounts: !!(realCounts && realCounts.leoCount > 0)
  };
}


module.exports = {
    keplerianToCartesian,
    calculateJ2Perturbation,
    calculateAtmosphericDrag,
    propagateOrbitWithPerturbations,
    cartesianToKeplerian,
    calculateCollisionProbability,
    calculatePerturbedOrbitalDensity
};