import { useState, useEffect, useRef } from 'react';
import { Search, MapPin, X } from 'lucide-react';
import { geocodeCity } from '../lib/api';

/**
 * Autocomplete city and coordinate search bar with debounced geocoding and status toast.
 * @param {{ onSelectCity: (city: { name: string, lat: number, lon: number }) => void }} props
 */
export default function CitySearch({ onSelectCity }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
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
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

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

    if (searchResults.length > 0) {
      handleSelectResult(searchResults[0]);
      return;
    }

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
  };

  return (
    <div className="relative flex-1 sm:max-w-xs md:max-w-sm z-50" ref={searchRef}>
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            const val = e.target.value;
            setSearchQuery(val);
            if (!val.trim() || val.length < 2) {
              setSearchResults([]);
              setShowDropdown(false);
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
          placeholder="Search city or coordinates (lat, lon)..."
          aria-label="Search city or coordinates"
          className="w-full rounded-xl border border-glass bg-surface py-2 pl-9 pr-8 text-xs text-slate-100 placeholder-slate-500 backdrop-blur-md transition-all focus:border-cobalt/50 focus:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSearchResults([]);
              setShowDropdown(false);
            }}
            aria-label="Clear search"
            className="absolute right-2.5 p-0.5 text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="absolute left-0 top-full mt-1.5 w-full z-50 rounded-xl border border-amber/40 bg-[#16161A] px-3.5 py-2 text-xs font-medium text-amber shadow-2xl backdrop-blur-2xl flex items-center justify-between"
        >
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            aria-label="Dismiss notification"
            className="p-0.5 text-amber/70 hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

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
                      className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs text-slate-200 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-cobalt" />
                        <span className="font-medium text-white">{item.name}</span>
                        {item.admin1 && <span className="text-[11px] text-slate-400">{item.admin1},</span>}
                        {item.country && <span className="text-[11px] text-slate-400">{item.country}</span>}
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
  );
}
