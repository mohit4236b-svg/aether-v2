import { ShieldAlert } from 'lucide-react';
import { calculateAqi, evaluatePersonaAlerts } from '../lib/physics';
import AtmosphereCards, { formatReadableTime } from './AtmosphereCards';

/**
 * Top-level clinical atmosphere summary including persona threshold alerts and 3 telemetry cards.
 * @param {{
 *   atmosphere: object | null,
 *   activePersona: string,
 *   hasHepa: boolean,
 *   onToggleHepa: () => void,
 *   loading: boolean,
 * }} props
 */
export default function AtmosphereHero({
  atmosphere,
  activePersona,
  hasHepa,
  onToggleHepa,
  loading,
}) {
  if (loading || !atmosphere) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 animate-pulse">
        <div className="glass-surface h-52 rounded-2xl lg:col-span-4" />
        <div className="glass-surface h-52 rounded-2xl lg:col-span-4" />
        <div className="glass-surface h-52 rounded-2xl lg:col-span-4" />
      </div>
    );
  }

  const { forecast, inversion, openaq_calibration, ventilation_window, current_index } = atmosphere;
  const aqHourly = forecast?.air_quality?.hourly || {};
  const weatherHourly = forecast?.weather?.hourly || {};

  const curIdx = current_index ?? 0;
  const currentPm25 = aqHourly.pm2_5?.[curIdx] ?? aqHourly.pm2_5?.[0] ?? 0;
  const currentNo2 = aqHourly.nitrogen_dioxide?.[curIdx] ?? aqHourly.nitrogen_dioxide?.[0] ?? 0;
  const currentO3 = aqHourly.ozone?.[curIdx] ?? aqHourly.ozone?.[0] ?? 0;
  const currentBlh = weatherHourly.boundary_layer_height?.[curIdx] ?? weatherHourly.boundary_layer_height?.[0] ?? 0;
  const currentWind = weatherHourly.wind_speed_10m?.[curIdx] ?? weatherHourly.wind_speed_10m?.[0] ?? 0;

  const aqiInfo = calculateAqi(currentPm25);
  const invStatus = inversion?.status || 'trapped';
  const viVal = inversion?.ventilation_index_m2_s ?? currentBlh * (currentWind / 3.6);
  const liftHour = formatReadableTime(inversion?.lift_hour_iso);
  const displayExplanation = inversion?.explanation?.replace(
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/g,
    (m) => formatReadableTime(m) || m
  );

  const isCalibrated = openaq_calibration?.available === true;
  const delta = openaq_calibration?.calibration_delta_ug_m3;
  const triggeredAlerts = evaluatePersonaAlerts({
    pm25: currentPm25,
    no2: currentNo2,
    o3: currentO3,
    persona: activePersona,
  });

  return (
    <div className="space-y-4">
      {triggeredAlerts.length > 0 && (
        <div
          role="alert"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-xl border border-crimson/30 bg-crimson/10 p-3.5 text-xs text-rose-200 backdrop-blur-md"
        >
          {triggeredAlerts.map((alt, idx) => (
            <div key={idx} className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-crimson" />
              <div>
                <span className="font-semibold uppercase tracking-wider text-crimson mr-1.5">
                  [{alt.type} Clinical Alert]
                </span>
                <span>{alt.msg}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <AtmosphereCards
        currentPm25={currentPm25}
        currentNo2={currentNo2}
        currentO3={currentO3}
        currentWind={currentWind}
        currentBlh={currentBlh}
        aqiInfo={aqiInfo}
        isCalibrated={isCalibrated}
        delta={delta}
        invStatus={invStatus}
        viVal={viVal}
        liftHour={liftHour}
        displayExplanation={displayExplanation}
        ventilationWindow={ventilation_window}
        hasHepa={hasHepa}
        onToggleHepa={onToggleHepa}
      />
    </div>
  );
}
