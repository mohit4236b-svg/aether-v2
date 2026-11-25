"""Pydantic v2 schemas and enumerations for Aether v2 physical and clinical engines."""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class PersonaType(StrEnum):
    """Clinical persona categories for tailored exposure modeling."""

    healthy_adult = "healthy_adult"
    asthma_copd = "asthma_copd"
    child_commute = "child_commute"
    endurance_athlete = "endurance_athlete"
    elderly_cardio = "elderly_cardio"


class ActivityType(StrEnum):
    """Physical activity levels impacting minute ventilation rate."""

    resting = "resting"
    walking = "walking"
    cycling = "cycling"
    running = "running"


class MaskType(StrEnum):
    """Mask filtration classifications."""

    none = "none"
    cloth = "cloth"
    surgical = "surgical"
    n95 = "n95"


class MaskFit(StrEnum):
    """Mask fit quality factor."""

    sealed = "sealed"
    loose = "loose"


class DispersionStatus(StrEnum):
    """Atmospheric ventilation and pollutant dispersion state."""

    trapped = "trapped"
    lifting = "lifting"
    dispersed = "dispersed"


class DoseRequest(BaseModel):
    """Input payload for personalized inhaled dose calculation."""

    pm25_ug_m3: float = Field(ge=0, description="Ambient PM2.5 concentration in µg/m³")
    duration_hours: float = Field(default=1.0, ge=0, description="Exposure duration in hours")
    activity: ActivityType = Field(default=ActivityType.resting, description="Physical activity level")
    persona: PersonaType = Field(default=PersonaType.healthy_adult, description="Clinical persona profile")
    mask: MaskType = Field(default=MaskType.none, description="Type of mask worn")
    mask_fit: MaskFit = Field(default=MaskFit.sealed, description="Seal quality of the mask")
    no2_ug_m3: float = Field(default=0.0, ge=0, description="Ambient NO2 concentration in µg/m³")
    o3_ug_m3: float = Field(default=0.0, ge=0, description="Ambient O3 concentration in µg/m³")


class DoseResponse(BaseModel):
    """Calculated inhaled and deposited respiratory dose metrics."""

    inhaled_dose_ug: float = Field(description="Total PM2.5 inhaled through mask in µg")
    deposited_dose_ug: float = Field(description="Deposited alveolar PM2.5 dose in µg")
    who_daily_budget_pct: float = Field(description="Percentage of WHO 24h reference PM2.5 intake consumed")
    cigarette_equivalent: float = Field(description="Equivalent cigarettes smoked based on Berkeley Earth model")
    breathing_mode: Literal["nasal", "oronasal"] = Field(description="Respiratory intake pathway mode")
    persona_alerts: list[str] = Field(default_factory=list, description="Clinical warnings triggered by exposure")
    effective_mask_efficiency: float = Field(description="Composite mask filtration efficiency (0.0 to 1.0)")


class InversionAnalysis(BaseModel):
    """Atmospheric boundary layer inversion assessment."""

    ventilation_index_m2_s: float = Field(description="Ventilation index = BLH (m) * Wind Speed (m/s)")
    status: DispersionStatus = Field(description="Dispersion category: trapped, lifting, or dispersed")
    lift_hour_iso: str | None = Field(default=None, description="Projected ISO timestamp when trapped air lifts")
    explanation: str = Field(description="Clinical and physical assessment of current atmospheric condition")


class VentilationWindowResponse(BaseModel):
    """Optimal indoor air quality ventilation window guidance."""

    best_start_hour_iso: str | None = Field(default=None, description="ISO timestamp for start of window")
    best_end_hour_iso: str | None = Field(default=None, description="ISO timestamp for end of window")
    indoor_pm25_closed: float = Field(description="Estimated indoor PM2.5 concentration with closed windows (µg/m³)")
    indoor_pm25_open: float = Field(description="Estimated indoor PM2.5 concentration with open windows (µg/m³)")
    outdoor_pm25_min: float = Field(description="Minimum outdoor PM2.5 during the ventilation window (µg/m³)")
    recommendation: str = Field(description="Actionable guidance on opening windows or keeping indoor air filtered")
