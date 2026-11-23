"""Deterministic respiratory dose engine for clinical personas and masks."""

from api.models.schemas import (
    ActivityType,
    DoseRequest,
    DoseResponse,
    MaskFit,
    MaskType,
    PersonaType,
)

# Baseline minute ventilation rates V_E in m³/hr
BASELINE_VENTILATION: dict[ActivityType, float] = {
    ActivityType.resting: 0.48,
    ActivityType.walking: 1.20,
    ActivityType.cycling: 2.70,
    ActivityType.running: 3.20,
}

# Persona profile multipliers & clinical thresholds
PERSONA_PROFILES: dict[PersonaType, dict[str, float]] = {
    PersonaType.healthy_adult: {
        "ve_mult": 1.0,
        "who_pm25_24h": 15.0,
        "no2_alert": 40.0,
        "o3_alert": 100.0,
    },
    PersonaType.asthma_copd: {
        "ve_mult": 1.0,
        "who_pm25_24h": 10.0,
        "no2_alert": 25.0,
        "o3_alert": 80.0,
    },
    PersonaType.child_commute: {
        "ve_mult": 1.35,
        "who_pm25_24h": 10.0,
        "no2_alert": 25.0,
        "o3_alert": 85.0,
    },
    PersonaType.endurance_athlete: {
        "ve_mult": 1.25,
        "who_pm25_24h": 15.0,
        "no2_alert": 35.0,
        "o3_alert": 95.0,
    },
    PersonaType.elderly_cardio: {
        "ve_mult": 0.95,
        "who_pm25_24h": 10.0,
        "no2_alert": 30.0,
        "o3_alert": 90.0,
    },
}

# Mask filtration efficiency E_mask
MASK_EFFICIENCY: dict[MaskType, float] = {
    MaskType.none: 0.0,
    MaskType.cloth: 0.30,
    MaskType.surgical: 0.65,
    MaskType.n95: 0.95,
}

# Mask fit factor F_fit
FIT_FACTOR: dict[MaskFit, float] = {
    MaskFit.sealed: 1.0,
    MaskFit.loose: 0.72,
}


def calculate_dose(req: DoseRequest) -> DoseResponse:
    """Compute personalized inhaled dose, alveolar deposition, and clinical alerts."""
    persona_cfg = PERSONA_PROFILES[req.persona]
    baseline_ve = BASELINE_VENTILATION[req.activity]
    v_e_effective = baseline_ve * persona_cfg["ve_mult"]

    # Oronasal breathing switch: >= 2.1 m³/hr (35 L/min)
    if v_e_effective >= 2.1:
        breathing_mode: str = "oronasal"
        deposition_fraction: float = 0.65
    else:
        breathing_mode = "nasal"
        deposition_fraction = 0.45

    e_mask = MASK_EFFICIENCY[req.mask]
    f_fit = FIT_FACTOR[req.mask_fit]
    effective_mask = e_mask * f_fit

    # Formulas:
    # inhaled_dose_ug = pm25_ug_m3 * V_E_effective * duration_hours * (1.0 - effective_mask)
    inhaled_dose_ug = req.pm25_ug_m3 * v_e_effective * req.duration_hours * (1.0 - effective_mask)

    # deposited_dose_ug = inhaled_dose_ug * DF
    deposited_dose_ug = inhaled_dose_ug * deposition_fraction

    # who_daily_budget_ug = who_pm25_24h * 0.48 * 24.0 (resting WHO 2021 daily reference budget)
    who_daily_budget_ug = persona_cfg["who_pm25_24h"] * 0.48 * 24.0
    who_daily_budget_pct = round((inhaled_dose_ug / who_daily_budget_ug) * 100.0, 2)

    # cigarette_equivalent = round((pm25_ug_m3 * (1.0 - effective_mask) * duration_hours) / (22.0 * 24.0), 3)
    cigarette_equivalent = round(
        (req.pm25_ug_m3 * (1.0 - effective_mask) * req.duration_hours) / (22.0 * 24.0),
        3,
    )

    # Clinical persona alerts
    persona_alerts: list[str] = []
    if req.no2_ug_m3 > persona_cfg["no2_alert"]:
        if req.persona == PersonaType.asthma_copd:
            persona_alerts.append(
                f"NO2 level ({req.no2_ug_m3:.1f} µg/m³) exceeds asthma/COPD threshold "
                f"({persona_cfg['no2_alert']:.1f} µg/m³): High risk of bronchoconstriction and airway hyperresponsiveness."
            )
        else:
            persona_alerts.append(
                f"NO2 level ({req.no2_ug_m3:.1f} µg/m³) exceeds clinical safety threshold "
                f"({persona_cfg['no2_alert']:.1f} µg/m³)."
            )

    if req.o3_ug_m3 > persona_cfg["o3_alert"]:
        if req.persona == PersonaType.asthma_copd:
            persona_alerts.append(
                f"O3 level ({req.o3_ug_m3:.1f} µg/m³) exceeds asthma/COPD threshold "
                f"({persona_cfg['o3_alert']:.1f} µg/m³): High risk of oxidative airway injury and bronchoconstriction."
            )
        else:
            persona_alerts.append(
                f"O3 level ({req.o3_ug_m3:.1f} µg/m³) exceeds clinical safety threshold "
                f"({persona_cfg['o3_alert']:.1f} µg/m³)."
            )

    if who_daily_budget_pct > 100.0:
        persona_alerts.append(
            f"Exposure consumes {who_daily_budget_pct:.1f}% of the WHO 24-hour daily reference budget."
        )

    return DoseResponse(
        inhaled_dose_ug=round(inhaled_dose_ug, 3),
        deposited_dose_ug=round(deposited_dose_ug, 3),
        who_daily_budget_pct=who_daily_budget_pct,
        cigarette_equivalent=cigarette_equivalent,
        breathing_mode=breathing_mode,  # type: ignore[arg-type]
        persona_alerts=persona_alerts,
        effective_mask_efficiency=round(effective_mask, 4),
    )
