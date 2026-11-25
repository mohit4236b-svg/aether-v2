/**
 * Pure respiratory physics, AQI, and clinical persona threshold utilities.
 * Mirrors backend `api/services/dose_engine.py` for zero-latency client simulation.
 */

/** @type {Record<string, number>} Baseline minute ventilation rates in m³/hr. */
export const BASELINE_VENTILATION = {
  resting: 0.48,
  walking: 1.20,
  cycling: 2.70,
  running: 3.20,
};

/**
 * @typedef {Object} PersonaProfile
 * @property {number} ve_mult - Minute ventilation multiplier.
 * @property {number} who_pm25_24h - Clinical 24h PM2.5 guideline (µg/m³).
 * @property {number} no2 - Clinical NO2 alert threshold (µg/m³).
 * @property {number} o3 - Clinical O3 alert threshold (µg/m³).
 */

/** @type {Record<string, PersonaProfile>} */
export const PERSONA_PROFILES = {
  healthy_adult: { ve_mult: 1.0, who_pm25_24h: 15.0, no2: 40, o3: 100 },
  asthma_copd: { ve_mult: 1.0, who_pm25_24h: 10.0, no2: 25, o3: 80 },
  child_commute: { ve_mult: 1.35, who_pm25_24h: 10.0, no2: 25, o3: 85 },
  endurance_athlete: { ve_mult: 1.25, who_pm25_24h: 15.0, no2: 35, o3: 95 },
  elderly_cardio: { ve_mult: 0.95, who_pm25_24h: 10.0, no2: 30, o3: 90 },
};

/** @type {Record<string, number>} */
export const MASK_EFFICIENCY = {
  none: 0.0,
  cloth: 0.30,
  surgical: 0.65,
  n95: 0.95,
};

/** @type {Record<string, number>} */
export const FIT_FACTOR = {
  sealed: 1.0,
  loose: 0.72,
};

/** Oronasal breathing switch threshold in m³/hr (35 L/min). */
export const ORONASAL_THRESHOLD_M3_HR = 2.1;

/**
 * @typedef {Object} DoseInput
 * @property {number} pm25 - Ambient PM2.5 concentration (µg/m³).
 * @property {string} activity - Activity key ('resting' | 'walking' | 'cycling' | 'running').
 * @property {number} durationMinutes - Exposure duration in minutes.
 * @property {string} mask - Mask type ('none' | 'cloth' | 'surgical' | 'n95').
 * @property {string} maskFit - Mask fit quality ('sealed' | 'loose').
 * @property {string} persona - Clinical persona identifier.
 */

/**
 * @typedef {Object} DoseResult
 * @property {number} veEffective - Effective minute ventilation (m³/hr).
 * @property {'nasal' | 'oronasal'} breathingMode - Active breathing pathway.
 * @property {boolean} isOronasal - True when ventilation >= 2.1 m³/hr.
 * @property {number} depositionFraction - Alveolar deposition fraction (0.45 or 0.65).
 * @property {number} effectiveMask - Effective filtration percentage (0-100).
 * @property {number} inhaledDoseUg - Total inhaled PM2.5 mass (µg).
 * @property {number} depositedDoseUg - Deep alveolar deposited PM2.5 mass (µg).
 * @property {number} whoBudgetPct - Percentage of persona's 24h WHO budget consumed.
 * @property {number} cigaretteEquivalent - Berkeley Earth cigarette-equivalent exposure.
 */

/**
 * Compute inhaled and alveolar-deposited PM2.5 dose for a given activity and persona.
 * @param {DoseInput} input
 * @returns {DoseResult}
 */
export function calculateDose({
  pm25,
  activity = 'walking',
  durationMinutes = 45,
  mask = 'none',
  maskFit = 'sealed',
  persona = 'healthy_adult',
}) {
  const safePm25 = Math.max(0, Number(pm25) || 0);
  const safeDuration = Math.max(0, Number(durationMinutes) || 0);
  const personaCfg = PERSONA_PROFILES[persona] || PERSONA_PROFILES.healthy_adult;
  const baseVe = BASELINE_VENTILATION[activity] ?? 1.20;
  const veEffective = baseVe * personaCfg.ve_mult;

  const isOronasal = veEffective >= ORONASAL_THRESHOLD_M3_HR;
  const breathingMode = isOronasal ? 'oronasal' : 'nasal';
  const depositionFraction = isOronasal ? 0.65 : 0.45;

  const eMask = MASK_EFFICIENCY[mask] ?? 0.0;
  const fFit = FIT_FACTOR[maskFit] ?? 1.0;
  const effectiveMask = eMask * fFit;

  const durationHours = safeDuration / 60.0;
  const inhaledDoseUg = safePm25 * veEffective * durationHours * (1.0 - effectiveMask);
  const depositedDoseUg = inhaledDoseUg * depositionFraction;

  const whoDailyBudgetUg = personaCfg.who_pm25_24h * 0.48 * 24.0;
  const whoBudgetPct = Math.round((inhaledDoseUg / whoDailyBudgetUg) * 1000) / 10;

  const cigaretteEquivalent =
    Math.round(((safePm25 * (1.0 - effectiveMask) * durationHours) / (22.0 * 24.0)) * 1000) / 1000;

  return {
    veEffective: Math.round(veEffective * 100) / 100,
    breathingMode,
    isOronasal,
    depositionFraction,
    effectiveMask: Math.round(effectiveMask * 100),
    inhaledDoseUg: Math.round(inhaledDoseUg * 10) / 10,
    depositedDoseUg: Math.round(depositedDoseUg * 10) / 10,
    whoBudgetPct,
    cigaretteEquivalent,
  };
}

/**
 * Convert PM2.5 (µg/m³) to US EPA AQI, category label, and semantic color token.
 * @param {number | null | undefined} pm25
 * @returns {{ aqi: number, label: string, color: 'emerald' | 'amber' | 'crimson' | 'slate' }}
 */
export function calculateAqi(pm25) {
  if (pm25 == null || Number.isNaN(Number(pm25))) {
    return { aqi: 0, label: 'Unknown', color: 'slate' };
  }
  const val = Number(pm25);
  if (val <= 12.0) {
    return { aqi: Math.round((50 / 12.0) * val), label: 'Good', color: 'emerald' };
  }
  if (val <= 35.4) {
    return {
      aqi: Math.round(((100 - 51) / (35.4 - 12.1)) * (val - 12.1) + 51),
      label: 'Moderate',
      color: 'amber',
    };
  }
  if (val <= 55.4) {
    return {
      aqi: Math.round(((150 - 101) / (55.4 - 35.5)) * (val - 35.5) + 101),
      label: 'Sensitive Groups',
      color: 'amber',
    };
  }
  if (val <= 150.4) {
    return {
      aqi: Math.round(((200 - 151) / (150.4 - 55.5)) * (val - 55.5) + 151),
      label: 'Unhealthy',
      color: 'crimson',
    };
  }
  if (val <= 250.4) {
    return {
      aqi: Math.round(((300 - 201) / (250.4 - 150.5)) * (val - 150.5) + 201),
      label: 'Very Unhealthy',
      color: 'crimson',
    };
  }
  return {
    aqi: Math.min(500, Math.round(((500 - 301) / (500.0 - 250.5)) * (val - 250.5) + 301)),
    label: 'Hazardous',
    color: 'crimson',
  };
}

/**
 * Evaluate clinical pollutant threshold alerts for a given persona.
 * @param {{ pm25: number, no2: number, o3: number, persona: string }} params
 * @returns {Array<{ type: string, val: number, thresh: number, msg: string }>}
 */
export function evaluatePersonaAlerts({ pm25, no2, o3, persona }) {
  const thresh = PERSONA_PROFILES[persona] || PERSONA_PROFILES.healthy_adult;
  const alerts = [];

  if (no2 > thresh.no2) {
    alerts.push({
      type: 'NO2',
      val: no2,
      thresh: thresh.no2,
      msg: `NO2 (${no2.toFixed(1)} µg/m³) exceeds clinical safety threshold (${thresh.no2} µg/m³): High risk of airway hyperresponsiveness and bronchoconstriction.`,
    });
  }
  if (o3 > thresh.o3) {
    alerts.push({
      type: 'O3',
      val: o3,
      thresh: thresh.o3,
      msg: `O3 (${o3.toFixed(1)} µg/m³) exceeds clinical safety threshold (${thresh.o3} µg/m³): Risk of oxidative airway epithelial irritation.`,
    });
  }
  if (pm25 > thresh.who_pm25_24h * 3) {
    alerts.push({
      type: 'PM2.5',
      val: pm25,
      thresh: thresh.who_pm25_24h,
      msg: `PM2.5 (${pm25.toFixed(1)} µg/m³) is substantially elevated relative to active persona threshold (${thresh.who_pm25_24h} µg/m³). Avoid strenuous outdoor exertion.`,
    });
  }
  return alerts;
}
