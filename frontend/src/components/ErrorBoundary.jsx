import React from 'react';

/**
 * React ErrorBoundary that intercepts uncaught render errors and provides a safe recovery UI.
 * @param {{ children: React.ReactNode }} props
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught error caught by Aether ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="min-h-screen bg-[#0D0D0F] text-slate-100 flex flex-col items-center justify-center p-6 font-sans"
        >
          <div className="glass-surface max-w-md w-full rounded-2xl border border-crimson/40 bg-crimson/10 p-6 text-center space-y-4 backdrop-blur-2xl">
            <h2 className="text-base font-semibold text-rose-300">Aether Interface Recovery</h2>
            <p className="text-xs text-slate-300">
              An unexpected render issue was safely intercepted. You can restore the dashboard safely.
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="rounded-xl bg-cobalt px-4 py-2 text-xs font-semibold text-white shadow-glowCobalt active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Reload Aether Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
