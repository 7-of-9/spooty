"""Tunable parameter schema. The web page builds its controls from this list."""

STYLES = ["auto", "bassswap", "blend", "echo", "fade", "cut"]
BEAT_STYLES = {"bassswap", "blend"}

SCHEMA = [
    # --- running order -------------------------------------------------------------------
    {"key": "tier_high_pct", "group": "Order", "label": "High-energy tier %", "type": "range",
     "min": 0, "max": 100, "step": 1, "default": 34,
     "help": "Share of tracks (by energy rank) played first."},
    {"key": "tier_mid_pct", "group": "Order", "label": "Mid tier %", "type": "range",
     "min": 0, "max": 100, "step": 1, "default": 33, "help": "The rest are the chill tier."},
    {"key": "order_key_weight", "group": "Order", "label": "Key compatibility weight", "type": "range",
     "min": 0, "max": 3, "step": 0.1, "default": 1.0},
    {"key": "order_tempo_weight", "group": "Order", "label": "Tempo closeness weight", "type": "range",
     "min": 0, "max": 3, "step": 0.1, "default": 1.2},
    {"key": "order_energy_weight", "group": "Order", "label": "Energy slope weight", "type": "range",
     "min": 0, "max": 3, "step": 0.1, "default": 1.0,
     "help": "Keeps energy stepping down gently inside each tier."},
    {"key": "order_timbre_weight", "group": "Order", "label": "Mood (timbre) weight", "type": "range",
     "min": 0, "max": 4, "step": 0.1, "default": 1.5,
     "help": "Keeps similar-sounding tracks adjacent, using rox's timbre fingerprints."},
    {"key": "rating_weight", "group": "Order", "label": "Your-ratings influence", "type": "range",
     "min": 0, "max": 10, "step": 0.5, "default": 5,
     "help": "How strongly saved ratings pull high-scored pairs together and push low-scored pairs apart."},
    {"key": "order_join_weight", "group": "Order", "label": "Join energy-match weight", "type": "range",
     "min": 0, "max": 4, "step": 0.1, "default": 1.2,
     "help": "Penalises a loud outro landing on a quiet intro."},
    # --- energy score --------------------------------------------------------------------
    {"key": "w_lufs", "group": "Energy score", "label": "Loudness", "type": "range",
     "min": -2, "max": 2, "step": 0.1, "default": 1.0},
    {"key": "w_danceability", "group": "Energy score", "label": "Danceability", "type": "range",
     "min": -2, "max": 2, "step": 0.1, "default": 1.0},
    {"key": "w_onset", "group": "Energy score", "label": "Percussive activity", "type": "range",
     "min": -2, "max": 2, "step": 0.1, "default": 1.0},
    {"key": "w_tempo", "group": "Energy score", "label": "Tempo", "type": "range",
     "min": -2, "max": 2, "step": 0.1, "default": 0.6},
    {"key": "w_brightness", "group": "Energy score", "label": "Brightness", "type": "range",
     "min": -2, "max": 2, "step": 0.1, "default": 0.4},
    {"key": "w_bass", "group": "Energy score", "label": "Bass weight", "type": "range",
     "min": -2, "max": 2, "step": 0.1, "default": 0.3},
    {"key": "w_dynamics", "group": "Energy score", "label": "Dynamic range", "type": "range",
     "min": -2, "max": 2, "step": 0.1, "default": -0.5,
     "help": "Negative: wide-dynamic (quiet/soft) tracks score as calmer."},
    # --- transitions ---------------------------------------------------------------------
    {"key": "style", "group": "Transitions", "label": "Style", "type": "select", "options": STYLES,
     "default": "auto", "help": "auto = beatmatched when tempos/beats allow, otherwise the fallback."},
    {"key": "auto_beat_style", "group": "Transitions", "label": "Auto: beatmatched style", "type": "select",
     "options": ["bassswap", "blend"], "default": "bassswap"},
    {"key": "auto_fallback_style", "group": "Transitions", "label": "Auto: no-beat fallback", "type": "select",
     "options": ["fade", "echo", "cut"], "default": "fade",
     "help": "Used when either track lacks a reliable beat grid."},
    {"key": "auto_clash_style", "group": "Transitions", "label": "Auto: tempo-clash fallback", "type": "select",
     "options": ["fade", "echo", "cut"], "default": "fade",
     "help": "Both tracks have solid beats but the gap beats the max stretch."},
    {"key": "bars", "group": "Transitions", "label": "Overlap bars", "type": "select",
     "options": [1, 2, 4, 8, 16, 32], "default": 16},
    {"key": "target_blend_s", "group": "Transitions", "label": "Target blend length (s)", "type": "range",
     "min": 15, "max": 45, "step": 1, "default": 28,
     "help": "Beatmatched overlaps aim for this many seconds regardless of tempo (your ratings peak at 22-35 s)."},
    {"key": "min_overlap_bars", "group": "Transitions", "label": "Min overlap bars (else fade)", "type": "select",
     "options": [1, 2, 4, 8, 16], "default": 8,
     "help": "A beatmatch shorter than this is too abrupt — use a long fade instead."},
    {"key": "phrase", "group": "Transitions", "label": "Snap mix-out to phrase (bars)", "type": "select",
     "options": [0, 4, 8, 16], "default": 8},
    {"key": "glide_bars", "group": "Transitions", "label": "Tempo glide after overlap (bars)", "type": "select",
     "options": [0, 2, 4, 8, 16], "default": 8,
     "help": "The incoming track holds the outgoing track's tempo through the overlap, then glides back to its own tempo over this many bars, alone."},
    {"key": "max_stretch_pct", "group": "Transitions", "label": "Max tempo stretch %", "type": "range",
     "min": 0, "max": 25, "step": 0.5, "default": 8},
    {"key": "allow_half_double", "group": "Transitions", "label": "Allow half/double-time matching",
     "type": "bool", "default": True},
    {"key": "min_regularity", "group": "Transitions", "label": "Min beat regularity to beatmatch",
     "type": "range", "min": 0, "max": 1, "step": 0.01, "default": 0.8},
    {"key": "bass_swap_at", "group": "Transitions", "label": "Bass swap point", "type": "range",
     "min": 0.1, "max": 0.9, "step": 0.05, "default": 0.5},
    {"key": "crossover_hz", "group": "Transitions", "label": "Bass crossover Hz", "type": "range",
     "min": 60, "max": 400, "step": 10, "default": 180},
    {"key": "fade_curve", "group": "Transitions", "label": "Fade curve", "type": "select",
     "options": ["equal_power", "s_curve", "linear"], "default": "equal_power"},
    {"key": "fade_seconds", "group": "Transitions", "label": "Fade length (s, non-beat)", "type": "range",
     "min": 1, "max": 30, "step": 0.5, "default": 14},
    {"key": "echo_beats", "group": "Transitions", "label": "Echo delay (beats)", "type": "select",
     "options": [0.25, 0.5, 0.75, 1, 1.5, 2], "default": 0.75},
    {"key": "echo_feedback", "group": "Transitions", "label": "Echo feedback", "type": "range",
     "min": 0, "max": 0.9, "step": 0.05, "default": 0.6},
    {"key": "echo_seconds", "group": "Transitions", "label": "Echo tail (s)", "type": "range",
     "min": 1, "max": 12, "step": 0.5, "default": 6},
    {"key": "use_structure", "group": "Transitions", "label": "Use section analysis for mix points",
     "type": "bool", "default": True,
     "help": "When a track has cached intro/outro section labels, exit at the outro instead of guessing from loudness."},
    {"key": "end_margin_bars", "group": "Transitions", "label": "Exit before track end (bars)", "type": "range",
     "min": 0, "max": 32, "step": 1, "default": 8,
     "help": "Never mix out closer than this to the file's end — a DJ leaves before the record runs out."},
    {"key": "outro_db", "group": "Transitions", "label": "Outro threshold (dB below loud)", "type": "range",
     "min": 3, "max": 40, "step": 1, "default": 7,
     "help": "Mix out at the last bar within this of the track's loud level — before its fade-out or outro. Higher = later, into the fade."},
    {"key": "intro_db", "group": "Transitions", "label": "Intro threshold (dB below loud)", "type": "range",
     "min": 3, "max": 60, "step": 1, "default": 30,
     "help": "Incoming track starts at the first bar at least this loud."},
    # --- output --------------------------------------------------------------------------
    {"key": "target_lufs", "group": "Output", "label": "Track loudness target (LUFS)", "type": "range",
     "min": -20, "max": -6, "step": 0.5, "default": -11},
    {"key": "ceiling_db", "group": "Output", "label": "Limiter ceiling (dBFS)", "type": "range",
     "min": -6, "max": 0, "step": 0.1, "default": -1.0},
    {"key": "preroll_s", "group": "Output", "label": "Preview: seconds before", "type": "range",
     "min": 2, "max": 60, "step": 1, "default": 12},
    {"key": "postroll_s", "group": "Output", "label": "Preview: seconds after", "type": "range",
     "min": 2, "max": 60, "step": 1, "default": 12},
]

FLOAT_RANGES = {"bass_swap_at": (0.1, 0.9), "fade_seconds": (1.0, 30.0),
                "handover": (0.1, 0.9), "length_s": (2.0, 90.0),
                "a_shift": (-64.0, 64.0), "b_shift": (-64.0, 64.0)}

OVERRIDE_KEYS = {
    "style": {"type": "select", "options": ["", *STYLES]},
    "bars": {"type": "select", "options": ["", 1, 2, 4, 8, 16, 32]},
    "a_shift": {"type": "float"},   # bars (0.5 = half a bar); + = later
    "b_shift": {"type": "float"},
    "bass_swap_at": {"type": "float"},
    "fade_seconds": {"type": "float"},
    "handover": {"type": "float"},   # where A and B trade places, 0.1..0.9 of the blend
    "length_s": {"type": "float"},   # total blend length in seconds (beat styles snap to bars)
}


def defaults() -> dict:
    return {p["key"]: p["default"] for p in SCHEMA}


def coerce(params: dict) -> dict:
    out = defaults()
    by_key = {p["key"]: p for p in SCHEMA}
    for k, v in (params or {}).items():
        spec = by_key.get(k)
        if spec is None:
            continue
        try:
            if spec["type"] == "bool":
                out[k] = bool(v)
            elif spec["type"] == "range":
                out[k] = min(spec["max"], max(spec["min"], float(v)))
            elif spec["type"] == "select":
                opts = spec["options"]
                if isinstance(opts[0], (int, float)):
                    v = type(opts[0])(float(v))
                out[k] = v if v in opts else spec["default"]
        except (TypeError, ValueError):
            pass
    return out


def coerce_override(o: dict) -> dict:
    out = {}
    for k, v in (o or {}).items():
        spec = OVERRIDE_KEYS.get(k)
        if spec is None or v in ("", None):
            continue
        try:
            if spec["type"] == "int":
                if int(v) != 0:
                    out[k] = int(v)
            elif spec["type"] == "float":
                lo, hi = FLOAT_RANGES.get(k, (-1e9, 1e9))
                out[k] = min(hi, max(lo, float(v)))
            elif k == "bars":
                out[k] = int(v)
            elif v in spec["options"]:
                out[k] = v
        except (TypeError, ValueError):
            pass
    return out
