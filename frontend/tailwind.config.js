/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#0D0D0F",
        surface: "rgba(255, 255, 255, 0.04)",
        surfaceHover: "rgba(255, 255, 255, 0.07)",
        cobalt: "#3B82F6",
        emerald: "#10B981",
        amber: "#F59E0B",
        crimson: "#EF4444",
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderColor: {
        glass: "rgba(255, 255, 255, 0.08)",
        glassHover: "rgba(255, 255, 255, 0.16)",
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.36)",
        glowCobalt: "0 0 24px -4px rgba(59, 130, 246, 0.35)",
        glowEmerald: "0 0 24px -4px rgba(16, 185, 129, 0.35)",
        glowAmber: "0 0 24px -4px rgba(245, 158, 11, 0.35)",
        glowCrimson: "0 0 24px -4px rgba(239, 68, 68, 0.35)",
      },
      backdropBlur: {
        glass: "18px",
      },
    },
  },
  plugins: [],
};
