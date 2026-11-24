import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, Activity, ShieldCheck, HeartPulse, Baby, Dumbbell, UserCheck, X } from 'lucide-react';
import { geocodeCity } from '../lib/api';

const PRESETS = [
  { name: 'Delhi', lat: 28.6139, lon: 77.2090, tag: 'Inversion Hotspot' },
  { name: 'Baddi', lat: 30.9578, lon: 76.7914, tag: 'Valley Basin' },
  { name: 'London', lat: 51.5072, lon: -0.1276, tag: 'Maritime Maritime' },
  { name: 'Beijing', lat: 39.9042, lon: 116.4074, tag: 'Basin Stagnation' },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194, tag: 'Coastal Advection' },
];

const PERSONAS = [
  { id: 'healthy_adult', label: 'Healthy Adult', icon: UserCheck, desc: '15 µg/m³ WHO baseline' },
  { id: 'asthma_copd', label: 'Asthma / COPD', icon: HeartPulse, desc: 'Bronchoconstriction threshold 10 µg/m³' },
  { id: 'child_commute', label: 'Child Commute', icon: Baby, desc: '+35% minute ventilation rate' },
  { id: 'endurance_athlete', label: 'Endurance Athlete', icon: Dumbbell, desc: '+25% minute ventilation, oronasal switch' },
  { id: 'elderly_cardio', label: 'Elderly Cardio', icon: ShieldCheck, desc: 'Cardiovascular susceptibility' },
];

export default function TopBar({
  activeCity,
  coords,
  onSelectCity,
  activePersona,
  onSelectPersona,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const searchRef = useRef(null);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await geocodeCity(searchQuery);
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch (err) {
        console.error('Geocode search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Click outside to dismiss search dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectResult = (item) => {
    const lat = Number(item.lat ?? item.latitude);
    const lon = Number(item.lon ?? item.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setToastMessage('Invalid coordinates for selected location');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    onSelectCity({
      name: item.city || item.name,
      lat,
      lon,
    });
    setSearchQuery('');
    setShowDropdown(false);
  };

  const handleKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = searchQuery.trim();
      if (!q) return;

      // Check if user entered manual coordinates like "30.9, 76.8"
      if (q.includes(',')) {
        const parts = q.split(',').map((p) => parseFloat(p.trim()));
        if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
          onSelectCity({
            name: `${parts[0].toFixed(2)}, ${parts[1].toFixed(2)}`,
            lat: parts[0],
            lon: parts[1],
          });
          setSearchQuery('');
          setShowDropdown(false);
          return;
        }
      }

      // If results already available in dropdown, pick top one
      if (searchResults.length > 0) {
        handleSelectResult(searchResults[0]);
        return;
      }

      // Otherwise trigger immediate geocode search
      setIsSearching(true);
      try {
        const results = await geocodeCity(q);
        if (results && results.length > 0) {
          handleSelectResult(results[0]);
        } else {
          setToastMessage(`City "${q}" not found`);
          setTimeout(() => setToastMessage(null), 3500);
        }
      } catch (err) {
        console.error('Geocode search failed:', err);
        setToastMessage(`Search error: ${err.message || 'Unable to locate city'}`);
        setTimeout(() => setToastMessage(null), 3500);
      } finally {
        setIsSearching(false);
      }
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-glass bg-[#0D0D0F]/80 backdrop-blur-glass transition-colors">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
        {/* Top Tier: Brand, Search, Preset Pills */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Brand Mark */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cobalt/15 border border-cobalt/30 text-cobalt">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold tracking-tight text-white">Aether</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono tracking-wider text-slate-300">
                  v2.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Clinical Atmospheric Health & Smog Navigation</p>
            </div>
          </div>

          {/* Autocomplete City Search */}
          <div className="relative flex-1 sm:max-w-xs md:max-w-sm z-50" ref={searchRef}>
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                placeholder="Search city or coordinates (lat, lon)..."
                className="w-full rounded-xl border border-glass bg-surface py-2 pl-9 pr-8 text-xs text-slate-100 placeholder-slate-500 backdrop-blur-md transition-all focus:border-cobalt/50 focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-cobalt/50"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 p-0.5 text-slate-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* City Not Found Notification Toast */}
            {toastMessage && (
              <div className="absolute left-0 top-full mt-1.5 w-full z-50 rounded-xl border border-amber/40 bg-[#16161A] px-3.5 py-2 text-xs font-medium text-amber shadow-2xl backdrop-blur-2xl flex items-center justify-between">
                <span>{toastMessage}</span>
                <button
                  type="button"
                  onClick={() => setToastMessage(null)}
                  className="p-0.5 text-amber/70 hover:text-amber"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Dropdown Suggestions */}
            {showDropdown && (
              <div className="absolute left-0 top-full mt-1.5 w-full overflow-hidden rounded-xl border border-glass bg-[#141418] shadow-2xl backdrop-blur-2xl z-50">
                {isSearching ? (
                  <div className="px-4 py-3 text-xs text-slate-400">Searching global coordinates...</div>
                ) : (
                  <ul className="divide-y divide-white/[0.04]">
                    {searchResults.map((item, idx) => {
                      const itemLat = Number(item.lat ?? item.latitude);
                      const itemLon = Number(item.lon ?? item.longitude);
                      return (
                        <li key={`${item.name}-${idx}`}>
                          <button
                            type="button"
                            onClick={() => handleSelectResult(item)}
                            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs text-slate-200 transition-colors hover:bg-white/[0.06]"
                          >
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3.5 w-3.5 text-cobalt" />
                              <span className="font-medium text-white">{item.name}</span>
                              {item.admin1 && (
                                <span className="text-[11px] text-slate-400">{item.admin1},</span>
                              )}
                              {item.country && (
                                <span className="text-[11px] text-slate-400">{item.country}</span>
                              )}
                            </div>
                            <span className="font-mono text-[10px] text-slate-500">
                              {Number.isFinite(itemLat) && Number.isFinite(itemLon)
                                ? `${itemLat.toFixed(2)}, ${itemLon.toFixed(2)}`
                                : ''}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* 5 Instant Demo Preset Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-400 mr-1 hidden lg:inline">Presets:</span>
            {PRESETS.map((preset) => {
              const isActive = activeCity.toLowerCase() === preset.name.toLowerCase();
              return (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => onSelectCity(preset)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.97] ${
                    isActive
                      ? 'bg-cobalt text-white shadow-glowCobalt'
                      : 'border border-glass bg-surface text-slate-300 hover:border-glassHover hover:bg-surfaceHover hover:text-white'
                  }`}
                >
                  <MapPin className="h-3 w-3" />
                  <span>{preset.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Lower Tier: Segmented Clinical Persona Selector */}
        <div className="flex items-center justify-between border-t border-glass/40 pt-2.5">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none w-full">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 mr-1 shrink-0">
              Clinical Persona:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PERSONAS.map((p) => {
                const Icon = p.icon;
                const isSelected = activePersona === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectPersona(p.id)}
                    title={p.desc}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.97] ${
                      isSelected
                        ? 'border-cobalt/60 bg-cobalt/15 text-white shadow-sm ring-1 ring-cobalt/40'
                        : 'border-glass bg-surface text-slate-300 hover:border-glassHover hover:bg-surfaceHover hover:text-white'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-cobalt' : 'text-slate-400'}`} />
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
