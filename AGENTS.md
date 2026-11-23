# Aether v2 Workspace Rules

Strict workspace and engineering rules for all development steps:

1. **Single Git Branch**: Maintain and commit directly to `main` branch only. Never create, switch to, or checkout secondary branches.
2. **Repo Size Budget**: Keep the total repository size strictly under 2 MB (hackathon maximum ceiling is 10 MB). No binary assets, large test fixtures, or media recordings in the repository.
3. **Zero Secrets in Code**: Never hard-code API keys or credentials. All secrets and sensitive configuration must be read from environment variables or `.env`.
4. **Non-Destructive Iteration**: Never modify or regress already-passing service modules, core contracts, or unit tests unless explicitly instructed.
5. **Python Typing & Documentation**: Every Python module must use comprehensive type hints, Pydantic v2 schemas for all payload validations, and clear docstrings.
6. **Apple macOS Minimalist Design**: Every UI component must follow Apple macOS dark minimalism:
   - Deep neutral base: `#0D0D0F`
   - Frosted glass surfaces: `rgba(255, 255, 255, 0.04)` (or `rgba(28, 28, 30, 0.72)` with blur)
   - Subtle perimeter borders: `1px solid rgba(255, 255, 255, 0.08)`
   - Intentional accent color (monochrome/emerald/amber/rose functional alerts)
   - Zero generic AI slop (no neon purple or cyan gradients).
