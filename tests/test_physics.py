"""Comprehensive unit test suite for Aether v2 physical and clinical engines."""

import pytest
from pydantic import ValidationError

from api.models.schemas import (
    ActivityType,
    DispersionStatus,
    DoseRequest,
    MaskFit,
    MaskType,
    PersonaType,
)
from api.services.dose_engine import calculate_dose
from api.services.iaq_engine import find_optimal_ventilation_window
from api.services.inversion_detector import (
    analyze_inversion_series,
    classify_ventilation,
)

# --- 1-8: Mask & Fit Factor Exact Math Tests ---


def test_dose_mask_none_sealed() -> None:
    req = DoseRequest(
        pm25_ug_m3=100.0,
        duration_hours=1.0,
        activity=ActivityType.resting,  # 0.48 m³/hr
        persona=PersonaType.healthy_adult,  # ve_mult=1.0, budget=15*0.48*24=172.8 µg
        mask=MaskType.none,
        mask_fit=MaskFit.sealed,
    )
    res = calculate_dose(req)
    assert res.effective_mask_efficiency == 0.0
    assert res.inhaled_dose_ug == 48.0  # 100 * 0.48 * 1.0 * 1.0
    assert res.deposited_dose_ug == round(48.0 * 0.45, 3)  # nasal mode DF=0.45 -> 21.6
    assert res.who_daily_budget_pct == round((48.0 / 172.8) * 100.0, 2)  # 27.78%
    assert res.cigarette_equivalent == round(100.0 * 1.0 / (22.0 * 24.0), 3)  # 0.189


def test_dose_mask_none_loose() -> None:
    req = DoseRequest(
        pm25_ug_m3=50.0,
        duration_hours=2.0,
        activity=ActivityType.resting,
        mask=MaskType.none,
        mask_fit=MaskFit.loose,
    )
    res = calculate_dose(req)
    assert res.effective_mask_efficiency == 0.0


def test_dose_mask_cloth_sealed() -> None:
    req = DoseRequest(
        pm25_ug_m3=100.0,
        duration_hours=1.0,
        activity=ActivityType.walking,  # 1.20 m³/hr
        mask=MaskType.cloth,
        mask_fit=MaskFit.sealed,
    )
    res = calculate_dose(req)
    # E_mask=0.30, F_fit=1.0 -> effective=0.30
    assert res.effective_mask_efficiency == 0.30
    expected_inhaled = 100.0 * 1.20 * 1.0 * (1.0 - 0.30)  # 84.0
    assert res.inhaled_dose_ug == expected_inhaled


def test_dose_mask_cloth_loose() -> None:
    req = DoseRequest(
        pm25_ug_m3=100.0,
        duration_hours=1.0,
        activity=ActivityType.walking,
        mask=MaskType.cloth,
        mask_fit=MaskFit.loose,
    )
    res = calculate_dose(req)
    # E_mask=0.30, F_fit=0.72 -> effective=0.216
    assert res.effective_mask_efficiency == 0.216
    expected_inhaled = round(100.0 * 1.20 * 1.0 * (1.0 - 0.216), 3)
    assert res.inhaled_dose_ug == expected_inhaled


def test_dose_mask_surgical_sealed() -> None:
    req = DoseRequest(
        pm25_ug_m3=100.0,
        duration_hours=1.0,
        activity=ActivityType.walking,
        mask=MaskType.surgical,
        mask_fit=MaskFit.sealed,
    )
    res = calculate_dose(req)
    # E_mask=0.65, F_fit=1.0 -> effective=0.65
    assert res.effective_mask_efficiency == 0.65
    expected_inhaled = round(100.0 * 1.20 * 1.0 * (1.0 - 0.65), 3)
    assert res.inhaled_dose_ug == expected_inhaled


def test_dose_mask_surgical_loose() -> None:
    req = DoseRequest(
        pm25_ug_m3=100.0,
        duration_hours=1.0,
        activity=ActivityType.walking,
        mask=MaskType.surgical,
        mask_fit=MaskFit.loose,
    )
    res = calculate_dose(req)
    # E_mask=0.65, F_fit=0.72 -> effective=0.468
    assert res.effective_mask_efficiency == 0.468
    expected_inhaled = round(100.0 * 1.20 * 1.0 * (1.0 - 0.468), 3)
    assert res.inhaled_dose_ug == expected_inhaled


def test_dose_mask_n95_sealed() -> None:
    req = DoseRequest(
        pm25_ug_m3=100.0,
        duration_hours=1.0,
        activity=ActivityType.walking,
        mask=MaskType.n95,
        mask_fit=MaskFit.sealed,
    )
    res = calculate_dose(req)
    # E_mask=0.95, F_fit=1.0 -> effective=0.95
    assert res.effective_mask_efficiency == 0.95
    expected_inhaled = round(100.0 * 1.20 * 1.0 * (1.0 - 0.95), 3)  # 6.0
    assert res.inhaled_dose_ug == expected_inhaled


def test_dose_mask_n95_loose() -> None:
    req = DoseRequest(
        pm25_ug_m3=100.0,
        duration_hours=1.0,
        activity=ActivityType.walking,
        mask=MaskType.n95,
        mask_fit=MaskFit.loose,
    )
    res = calculate_dose(req)
    # E_mask=0.95, F_fit=0.72 -> effective=0.684
    assert res.effective_mask_efficiency == 0.684
    expected_inhaled = round(100.0 * 1.20 * 1.0 * (1.0 - 0.684), 3)
    assert res.inhaled_dose_ug == expected_inhaled


# --- 9-12: Oronasal Switch & Ventilation Tests ---


def test_oronasal_switch_below_threshold() -> None:
    # walking = 1.20 m³/hr < 2.1 m³/hr -> nasal, DF=0.45
    req = DoseRequest(
        pm25_ug_m3=50.0,
        activity=ActivityType.walking,
        persona=PersonaType.healthy_adult,
    )
    res = calculate_dose(req)
    assert res.breathing_mode == "nasal"
    assert res.deposited_dose_ug == round(res.inhaled_dose_ug * 0.45, 3)


def test_oronasal_switch_cycling_above_threshold() -> None:
    # cycling = 2.70 m³/hr >= 2.1 m³/hr -> oronasal, DF=0.65
    req = DoseRequest(
        pm25_ug_m3=50.0,
        activity=ActivityType.cycling,
        persona=PersonaType.healthy_adult,
    )
    res = calculate_dose(req)
    assert res.breathing_mode == "oronasal"
    assert res.deposited_dose_ug == round(res.inhaled_dose_ug * 0.65, 3)


def test_oronasal_switch_running_above_threshold() -> None:
    # running = 3.20 m³/hr >= 2.1 m³/hr -> oronasal, DF=0.65
    req = DoseRequest(
        pm25_ug_m3=50.0,
        activity=ActivityType.running,
        persona=PersonaType.endurance_athlete,  # 3.20 * 1.25 = 4.0 m³/hr
    )
    res = calculate_dose(req)
    assert res.breathing_mode == "oronasal"
    assert res.deposited_dose_ug == round(res.inhaled_dose_ug * 0.65, 3)


def test_child_commute_multiplier() -> None:
    # child_commute: VE_mult = 1.35. For walking (1.20) -> V_E_eff = 1.62 m³/hr
    req = DoseRequest(
        pm25_ug_m3=100.0,
        activity=ActivityType.walking,
        persona=PersonaType.child_commute,
        duration_hours=1.0,
    )
    res = calculate_dose(req)
    assert res.inhaled_dose_ug == 162.0


# --- 13-17: Clinical Persona Alerts & Edge Cases ---


def test_asthma_no2_trigger_alert() -> None:
    # asthma_copd no2_alert = 25.0 µg/m³
    req = DoseRequest(
        pm25_ug_m3=20.0,
        persona=PersonaType.asthma_copd,
        no2_ug_m3=30.0,
    )
    res = calculate_dose(req)
    assert any("bronchoconstriction" in alert.lower() for alert in res.persona_alerts)


def test_asthma_o3_trigger_alert() -> None:
    # asthma_copd o3_alert = 80.0 µg/m³
    req = DoseRequest(
        pm25_ug_m3=20.0,
        persona=PersonaType.asthma_copd,
        o3_ug_m3=90.0,
    )
    res = calculate_dose(req)
    assert any("bronchoconstriction" in alert.lower() for alert in res.persona_alerts)


def test_healthy_adult_no_alert_below_threshold() -> None:
    req = DoseRequest(
        pm25_ug_m3=10.0,
        persona=PersonaType.healthy_adult,
        no2_ug_m3=20.0,
        o3_ug_m3=50.0,
    )
    res = calculate_dose(req)
    assert len(res.persona_alerts) == 0


def test_zero_pm25_edge_case() -> None:
    req = DoseRequest(
        pm25_ug_m3=0.0,
        duration_hours=5.0,
        activity=ActivityType.running,
    )
    res = calculate_dose(req)
    assert res.inhaled_dose_ug == 0.0
    assert res.deposited_dose_ug == 0.0
    assert res.who_daily_budget_pct == 0.0
    assert res.cigarette_equivalent == 0.0


def test_negative_input_raises_validation_error() -> None:
    with pytest.raises(ValidationError):
        DoseRequest(pm25_ug_m3=-10.0)
    with pytest.raises(ValidationError):
        DoseRequest(pm25_ug_m3=10.0, duration_hours=-1.0)


# --- 18-20: Inversion Detector Tests ---


def test_classify_ventilation_thresholds() -> None:
    assert classify_ventilation(500.0) == DispersionStatus.trapped
    assert classify_ventilation(1200.0) == DispersionStatus.lifting
    assert classify_ventilation(2500.0) == DispersionStatus.lifting
    assert classify_ventilation(3000.0) == DispersionStatus.lifting
    assert classify_ventilation(3001.0) == DispersionStatus.dispersed


def test_inversion_trapped_to_dispersed_lift_hour() -> None:
    times = [
        "2026-11-24T06:00:00",
        "2026-11-24T07:00:00",
        "2026-11-24T08:00:00",
        "2026-11-24T09:00:00",
    ]
    # BLH: 300m, 500m, 1200m, 1800m
    # Wind km/h: 3.6 (1 m/s), 7.2 (2 m/s), 7.2 (2 m/s), 10.8 (3 m/s)
    # VI: 300*1=300 (trapped), 500*2=1000 (trapped), 1200*2=2400 (lifting), 1800*3=5400 (dispersed)
    blh = [300.0, 500.0, 1200.0, 1800.0]
    winds = [3.6, 7.2, 7.2, 10.8]

    analysis = analyze_inversion_series(times, blh, winds)
    assert analysis.status == DispersionStatus.trapped
    assert analysis.ventilation_index_m2_s == 300.0
    assert analysis.lift_hour_iso == "2026-11-24T09:00:00"


def test_inversion_trapped_to_lifting_fallback() -> None:
    times = ["2026-11-24T06:00:00", "2026-11-24T07:00:00"]
    # VI: 300 (trapped), 1500 (lifting, never > 3000)
    blh = [300.0, 750.0]
    winds = [3.6, 7.2]

    analysis = analyze_inversion_series(times, blh, winds)
    assert analysis.status == DispersionStatus.trapped
    assert analysis.lift_hour_iso == "2026-11-24T07:00:00"


def test_inversion_none_and_partial_none_handling() -> None:
    times = ["2026-11-24T06:00:00", "2026-11-24T07:00:00", "2026-11-24T08:00:00"]
    blh = [None, 800.0, None]
    winds = [None, None, 14.4]

    # Must execute smoothly without error
    analysis = analyze_inversion_series(times, blh, winds)
    assert analysis.ventilation_index_m2_s > 0
    assert analysis.status in [DispersionStatus.trapped, DispersionStatus.lifting, DispersionStatus.dispersed]


# --- 21-22: IAQ Ventilation Window Engine Tests ---


def test_optimal_iaq_ventilation_window_selection() -> None:
    times = [
        "2026-11-24T04:00:00",  # Night (excluded)
        "2026-11-24T08:00:00",  # 45.0
        "2026-11-24T12:00:00",  # 20.0
        "2026-11-24T15:00:00",  # 12.0 (lowest daylight)
        "2026-11-24T19:00:00",  # 35.0
        "2026-11-24T23:00:00",  # Night (5.0, excluded)
    ]
    pm25_series = [10.0, 45.0, 20.0, 12.0, 35.0, 5.0]

    res = find_optimal_ventilation_window(times, pm25_series, has_hepa=False)
    assert res.best_start_hour_iso == "2026-11-24T15:00:00"
    assert res.best_end_hour_iso == "2026-11-24T19:00:00"
    assert res.outdoor_pm25_min == 12.0
    # Closed: 12.0 * 0.55 = 6.6
    assert res.indoor_pm25_closed == 6.6
    # Open: 12.0 * 0.95 = 11.4
    assert res.indoor_pm25_open == 11.4


def test_optimal_iaq_with_hepa_reduction() -> None:
    times = ["2026-11-24T10:00:00", "2026-11-24T11:00:00"]
    pm25_series = [50.0, 40.0]

    res = find_optimal_ventilation_window(times, pm25_series, has_hepa=True)
    assert res.best_start_hour_iso == "2026-11-24T11:00:00"
    assert res.outdoor_pm25_min == 40.0
    # Without HEPA: 40 * 0.55 = 22.0
    # With HEPA (60% reduction): 40 * 0.55 * 0.40 = 8.8
    assert res.indoor_pm25_closed == 8.8
    assert res.indoor_pm25_open == 38.0
