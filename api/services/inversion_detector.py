"""Atmospheric boundary layer inversion and ventilation index detector."""

from api.models.schemas import DispersionStatus, InversionAnalysis

DEFAULT_FALLBACK_BLH_M: float = 500.0
DEFAULT_FALLBACK_WIND_KMH: float = 7.2  # 2.0 m/s


def classify_ventilation(ventilation_index: float) -> DispersionStatus:
    """Classify ventilation index into trapped, lifting, or dispersed."""
    if ventilation_index < 1200.0:
        return DispersionStatus.trapped
    elif ventilation_index <= 3000.0:
        return DispersionStatus.lifting
    else:
        return DispersionStatus.dispersed


def analyze_inversion_series(
    hourly_times: list[str],
    blh_list: list[float | None],
    wind_speed_kmh_list: list[float | None],
    current_index: int = 0,
) -> InversionAnalysis:
    """Analyze a series of boundary layer heights and wind speeds to detect inversions and lift hours.

    Converts wind speed from km/h to m/s, calculates the ventilation index
    (BLH * wind_speed_m_s), classifies dispersion conditions, and detects
    the earliest future hour when thermal inversion trapping disperses.
    """
    if not hourly_times:
        current_vi = DEFAULT_FALLBACK_BLH_M * (DEFAULT_FALLBACK_WIND_KMH / 3.6)
        status = classify_ventilation(current_vi)
        return InversionAnalysis(
            ventilation_index_m2_s=round(current_vi, 1),
            status=status,
            lift_hour_iso=None,
            explanation="No hourly meteorological data provided; using default atmospheric assumptions.",
        )

    # Process all steps safely with None fallback handling
    computed_vi_series: list[float] = []
    status_series: list[DispersionStatus] = []

    last_known_blh = DEFAULT_FALLBACK_BLH_M
    last_known_wind = DEFAULT_FALLBACK_WIND_KMH

    for i in range(len(hourly_times)):
        raw_blh = blh_list[i] if i < len(blh_list) else None
        raw_wind = wind_speed_kmh_list[i] if i < len(wind_speed_kmh_list) else None

        if raw_blh is not None and raw_blh >= 0:
            last_known_blh = float(raw_blh)
        blh = last_known_blh

        if raw_wind is not None and raw_wind >= 0:
            last_known_wind = float(raw_wind)
        wind_kmh = last_known_wind

        wind_m_s = wind_kmh / 3.6
        vi = blh * wind_m_s
        computed_vi_series.append(vi)
        status_series.append(classify_ventilation(vi))

    safe_idx = max(0, min(current_index, len(computed_vi_series) - 1))
    current_vi = computed_vi_series[safe_idx]
    current_status = status_series[safe_idx]

    # Search strictly future hours (after safe_idx) for dispersion or lifting
    lift_hour_iso: str | None = None

    # First look for dispersed
    for idx in range(safe_idx + 1, len(status_series)):
        if status_series[idx] == DispersionStatus.dispersed:
            lift_hour_iso = hourly_times[idx]
            break

    # If never dispersed, look for lifting if currently trapped
    if lift_hour_iso is None and current_status == DispersionStatus.trapped:
        for idx in range(safe_idx + 1, len(status_series)):
            if status_series[idx] == DispersionStatus.lifting:
                lift_hour_iso = hourly_times[idx]
                break

    # Formulate clinical/meteorological explanation
    if current_status == DispersionStatus.trapped:
        if lift_hour_iso:
            lift_msg = f"Inversion layer projected to break around {lift_hour_iso}."
        else:
            lift_msg = "Persistent inversion conditions expected throughout the forecast window."
        explanation = (
            f"Atmospheric boundary layer is suppressed (VI = {current_vi:.0f} m²/s < 1200 m²/s). "
            f"Surface thermal inversion is trapping particulates near ground level. {lift_msg}"
        )
    elif current_status == DispersionStatus.lifting:
        if lift_hour_iso:
            lift_msg = f"Full atmospheric clearance projected at {lift_hour_iso}."
        else:
            lift_msg = "Ventilation remains moderate."
        explanation = (
            f"Atmospheric ventilation is transitioning (VI = {current_vi:.0f} m²/s, 1200–3000 m²/s). "
            f"Thermal capping is weakening with progressive diurnal heating. {lift_msg}"
        )
    else:
        explanation = (
            f"Strong atmospheric ventilation (VI = {current_vi:.0f} m²/s > 3000 m²/s). "
            "Deep boundary layer and turbulent advection facilitate rapid particulate dispersion."
        )

    return InversionAnalysis(
        ventilation_index_m2_s=round(current_vi, 1),
        status=current_status,
        lift_hour_iso=lift_hour_iso,
        explanation=explanation,
    )
