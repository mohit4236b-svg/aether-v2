import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { calculateDose, calculateAqi, evaluatePersonaAlerts } from '../lib/physics';
import DoseSimulator from '../components/DoseSimulator';
import AtmosphereHero from '../components/AtmosphereHero';
import AgentDrawer from '../components/AgentDrawer';
import ErrorBoundary from '../components/ErrorBoundary';

describe('Aether v2 Physics & Accessibility Suite', () => {
  it('1. calculates baseline walking inhaled and deposited dose accurately', () => {
    const res = calculateDose({
      pm25: 100,
      activity: 'walking',
      durationMinutes: 60,
      mask: 'none',
      maskFit: 'sealed',
      persona: 'healthy_adult',
    });
    expect(res.veEffective).toBe(1.2);
    expect(res.breathingMode).toBe('nasal');
    expect(res.depositionFraction).toBe(0.45);
    expect(res.inhaledDoseUg).toBe(120);
    expect(res.depositedDoseUg).toBe(54);
  });

  it('2. applies N95 sealed vs loose fit factor filtration correctly', () => {
    const sealed = calculateDose({
      pm25: 100,
      activity: 'walking',
      durationMinutes: 60,
      mask: 'n95',
      maskFit: 'sealed',
      persona: 'healthy_adult',
    });
    const loose = calculateDose({
      pm25: 100,
      activity: 'walking',
      durationMinutes: 60,
      mask: 'n95',
      maskFit: 'loose',
      persona: 'healthy_adult',
    });
    expect(sealed.effectiveMask).toBe(95);
    expect(sealed.inhaledDoseUg).toBe(6);
    expect(loose.effectiveMask).toBe(68);
    expect(loose.inhaledDoseUg).toBeGreaterThan(sealed.inhaledDoseUg);
  });

  it('3. triggers oronasal breathing switch at >= 2.1 m³/hr ventilation', () => {
    const cycling = calculateDose({
      pm25: 50,
      activity: 'cycling',
      durationMinutes: 30,
      mask: 'none',
      maskFit: 'sealed',
      persona: 'healthy_adult',
    });
    expect(cycling.isOronasal).toBe(true);
    expect(cycling.breathingMode).toBe('oronasal');
    expect(cycling.depositionFraction).toBe(0.65);
  });

  it('4. computes WHO 24h budget percentage and Berkeley Earth cigarette equivalent', () => {
    const res = calculateDose({
      pm25: 22,
      activity: 'resting',
      durationMinutes: 1440,
      mask: 'none',
      maskFit: 'sealed',
      persona: 'healthy_adult',
    });
    expect(res.cigaretteEquivalent).toBe(1);
    expect(res.whoBudgetPct).toBeCloseTo((22 / 15) * 100, 1);
  });

  it('5. maps PM2.5 concentrations to US EPA AQI categories', () => {
    expect(calculateAqi(12).label).toBe('Good');
    expect(calculateAqi(25).label).toBe('Moderate');
    expect(calculateAqi(300).label).toBe('Hazardous');
  });

  it('6. recalibrates clinical alert thresholds per persona', () => {
    const healthyAlerts = evaluatePersonaAlerts({ pm25: 20, no2: 30, o3: 85, persona: 'healthy_adult' });
    const asthmaAlerts = evaluatePersonaAlerts({ pm25: 20, no2: 30, o3: 85, persona: 'asthma_copd' });

    expect(healthyAlerts).toHaveLength(0);
    expect(asthmaAlerts.map((a) => a.type)).toEqual(['NO2', 'O3']);
  });

  it('7. renders DoseSimulator with accessible tablist/tab ARIA roles and updates selection', () => {
    render(<DoseSimulator atmosphere={null} activePersona="healthy_adult" />);
    const activityTablist = screen.getByRole('tablist', { name: /physical activity level/i });
    expect(activityTablist).toBeInTheDocument();

    const runningTab = screen.getByRole('tab', { name: 'running' });
    expect(runningTab).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(runningTab);
    expect(runningTab).toHaveAttribute('aria-selected', 'true');
  });

  it('8. renders AtmosphereHero clinical alert banner with role="alert" when thresholds breached', () => {
    const mockAtmosphere = {
      current_index: 0,
      forecast: {
        air_quality: { hourly: { pm2_5: [80], nitrogen_dioxide: [35], ozone: [90] } },
        weather: { hourly: { boundary_layer_height: [200], wind_speed_10m: [5] } },
      },
      inversion: { status: 'trapped', ventilation_index_m2_s: 278 },
      openaq_calibration: { available: false },
      ventilation_window: { indoor_pm25_closed: 18, indoor_pm25_open: 45 },
    };

    render(
      <AtmosphereHero
        atmosphere={mockAtmosphere}
        activePersona="asthma_copd"
        hasHepa={false}
        onToggleHepa={() => {}}
        loading={false}
      />
    );
    const alertBanner = screen.getByRole('alert');
    expect(alertBanner).toBeInTheDocument();
    expect(alertBanner).toHaveTextContent(/NO2 Clinical Alert/i);
  });

  it('9. renders AgentDrawer as accessible modal dialog and closes on Escape key', () => {
    const onClose = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();

    render(
      <AgentDrawer
        isOpen={true}
        onClose={onClose}
        activeCity="Delhi"
        coords={{ lat: 28.6139, lon: 77.209 }}
        activePersona="healthy_adult"
      />
    );

    const dialog = screen.getByRole('dialog', { name: /Aether AI Co-Pilot/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('10. renders ErrorBoundary fallback UI when a child component throws', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenChild() {
      throw new Error('Simulated render crash');
    }

    render(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Aether Interface Recovery');
    expect(screen.getByRole('button', { name: /Reload Aether Dashboard/i })).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
