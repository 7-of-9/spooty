"""Claude_Best · Medley: every song of a set, each heard only at its highlight, joined by
composed transitions (DESIGN.md, with its 29 Sep 2026 AMENDMENTS applied).

`CFG` is the single source of truth for every numeric default. The first groups repeat
Appendix A key for key (flat keys, exact names); the later groups collect the constants
that the design states in its body text (section numbers in the comments). Code reads
numbers from here and never hard-codes them. CFG is JSON-native (plain dicts, lists,
numbers, None) so it can be hashed into plan keys; use `cfg()` for a private copy with
overrides.
"""

from __future__ import annotations

import copy

MEDLEY_VERSION = "1.1"      # plan/clip cache keys; bump when planning output changes (1.1: fixer v2)
COMPILER_VERSION = "1.0"    # Program.version; bump when compile_join output changes
FEATS_VERSION = 1           # feats cache key; bump when Feats fields or their maths change

CFG: dict = {
    # ---- Appendix A: set and excerpts (AMENDMENTS 1: every eligible song, no artist cap)
    "target_s": 1200,                   # not a cap: total length is what the excerpts add up to
    "target_songs": None,               # None = all eligible tracks
    "min_h": 1.5,                       # integrator (AMENDMENTS 1, every song): 2.5 selected a top 24
                                        # and dropped 6 tracks that excerpt fine (best H 1.52-2.49)
    "min_duration_s": 100,
    "max_per_artist": None,             # None = off
    "body_bars_allowed": [8, 12, 16, 24, 32],
    "body_s": [28, 64],
    "lead_body_max_s": 85,
    "min_solo_bars": 8,
    "min_solo_s": 12,
    "lead_max_bars": 8,
    "lead_max_s": 16,
    "phrase_min_s": 12,

    # ---- Appendix A: landings, leads and exits (dB are relative to the track's p90)
    "land_min_rel_db": -3,
    "veto_rel_db": -4,
    "veto_low_db": -15,
    "arrival_db": 3,
    "arrival_low_db": 6,
    "natural_exit_db": 4,
    "dip_db": 3,
    "build_db": 2.5,
    "break_db": 3,
    "break_low_db": 8,
    "pickup_vox_db": 6,

    # ---- Appendix A: grid
    "grid_snap_s": 0.070,
    "refine_win_s": 0.035,
    "locked_rms_ms": 6,
    "locked_max_ms": 15,
    "verify_rms_ms": 15,
    "keep_locked": 0.9,
    "keep_verify": 0.8,

    # ---- Appendix A: tempo
    "lock_max_pct": 6.0,
    "layer_perc_max_pct": 3.0,
    "double_tol_pct": 6.0,
    "ramp_pct_per_bar": 1.0,
    "ramp_bars": [2, 6],

    # ---- Appendix A: mixing and moves
    "crossover_low_hz": 150,
    "crossover_high_hz": 2500,
    "splice_pre_ms": 3,
    "splice_xf_ms": 3,
    "splice_xf_low_ms": 10,
    "splice_search_ms": 1.5,
    "air_beats": 1.0,                   # AMENDMENTS 6 / REVIEW #5 (R6): A's low out at -1 beat
    "air_top_end_beats": 0.25,          # R6: A's top fades cos over [-1, -1/4]
    "a_air_db": 6,
    "vacuum_beats": 0.5,
    "pickup_max_beats": 2,
    "lead_from_db": -12,
    "pulse_floor_db": -12,
    "pulse_ramp_ms": 2,
    "gate_attack_ms": 2,
    "gate_release_ms": 25,
    "echo_delay_beats": 0.75,
    "echo_send_db": -4,
    "echo_hp_hz": [400, 1500],
    "echo_fb_max": 0.55,
    "tail_floor_db": -20,
    "backspin": {"push": 0.125, "peak_rate": -3.5, "tau": 0.35, "end_by": -0.25},
    "tape_stop": {"len": 2, "k": 1.5},
    "rewind": {"peak_rate": -10, "len_bars": 0.75, "gap_bars": 0.25},
    "roll_sizes": [[2, 4], [1, 2], [0.5, 1], [0.25, 0.5]],
    "roll_min_ms": 60,
    "roll_hp_hz": [40, 1000],

    # ---- Appendix A: planner
    "cands_per_join": 160,              # integrator: 48 kept only 1-2 (X_A, j_B) pairs per join (see per_xj_keep)
    # fixer (review v1, musical #2): width 32 -> 128 (the same objective scored +38 on the real
    # set, for 0.3 s), h 1.0 -> 1.5 (the join terms that depend on B's landing out-weighed its H:
    # 32 of 83 songs missed their best landing, 12 of them by >= 0.5 H; now 30 and 9)
    "beam_width": 128,
    "weights": {"bin": 2.0, "beat": 1.0, "key": 0.6, "loud": 0.5, "fit": 0.4, "exit": 0.5, "h": 1.5},
    # all subtracted from the beam score except first_use, which is added
    "penalties": {"same_form": 0.6, "sig_within3": 0.8, "loud_within3": 0.6, "same_shape": 0.3,
                  "first_use": 0.3, "share": 2.0,
                  # integrator: every cut_on_one pick; without it the same-form penalties made the
                  # beam alternate echo_slam / cut_on_one (15 of 78 joins) where Phase 1 wants ~10 %
                  "fallback": 1.0,
                  # fixer (review v1, musical #1): a vacuum join (the dry audio stops before the
                  # landing: every slam but air_cut) right after another; the set's vacuum share
                  # above vacuum_cap costs vacuum_share x the excess fraction x joins
                  "vacuum_b2b": 1.0, "vacuum_share": 2.0},
    "vacuum_cap": 0.5,
    "tier_targets": {"smooth": 0.55, "noticeable": 0.30, "signature": 0.15},
    "caps": {"spin": 2, "tape_stop": 2, "wheel": 1, "double_drop": 1, "tease": 3, "vocal_reveal": 2,
             "stutter": 4, "motif": 3},

    # ---- Appendix A: loudness and resources
    "excerpt_gain_clamp_db": 9,
    "arc_off_lu": {"house": 0, "dnb": 1, "swing": 0, "rock": 0, "close": -1},   # fixer: + rock
    "loud_correct_max_db": 3,
    "r2_procs": 4,
    "warp_cache_mb": 768,
    "medley_clip_cache_mb": 400,
    "tau_key_default": 0.30,

    # ================= constants stated in the design body (same authority) =================
    # §4.1-4.3 analysis
    "analysis": {
        "onset_n_fft": 1024, "onset_hop": 64,        # percussive flux at 44.1 kHz
        "onset_mad_k": 3.0, "onset_mad_win_s": 1.0,  # clear peak: >= median + k*MAD over 1 s
        "fit_w_refined": 1.0, "fit_w_unrefined": 0.25,
        "fit_outlier_ms": 40, "fit_iters": 3,
        "octave_tol_ln": 0.05,                       # |ln(bpm_bt / bpm_a1)| < 0.05
        "low_hz": 120, "vox_hz": [300, 3400], "chroma_floor_pct": 20,
        "kblock_s": 0.4, "kblock_hop_s": 0.1,
        "db_floor": -120.0,                          # every *_db field is floored here
        "last_loud_db": -6,                          # "last loud" bar: last bar with rel_db > -6
        "novelty_kernel_bars": 16,
    },
    # §5 highlights
    "highlight": {
        "phrase_conf_min": 0.5, "land_move_db": 0.5, "land_low_w": 0.1,
        "drop_prior": 0.95, "drop_contrast_db": 3, "drop_low_db": 6,
        "land_onset_ms": 15, "land_onset_ratio": 0.8, "free_no_onset_bin": -0.2,
        # integrator (AMENDMENTS 1): a non-free track is eligible when some landing reaches this
        # ratio; landings under land_onset_ratio are used only when the track has no other, and
        # V1 then decides per join (slams usually pass)
        "eligible_onset_ratio": 0.7,
        "top_landings": 3,
        # fixer (musical #2, #3): + the best arrival when the top 3 have none, + the best landing
        # V1 can pass (onset_ok or drop_ok) when the top 3 have none
        "arrival_extra": 2,
        "nobass_low_db": -15, "nobass_min_bars": 3, "fill_bars_max": 2, "nodrums_perc_db": -6,
        "build_L": [8, 4], "break_L": [2, 1],
        "pickup_stem_db": -24,
        "prior": {"chorus": 1.0, "solo": 0.8, "inst": 0.7, "verse": 0.4, "bridge": 0.3,
                  "intro": 0.1, "break": 0.1, "outro": 0.05, "unlabelled": 0.6},
        "lead_q": {"nobass-nodrums": 1.0, "nobass-drums": 0.8, "build": 0.7, "break": 0.5, "none": 0.0},
        "h": {"level": 0.12, "contrast": 0.06, "contrast_cap": 10, "rep": 2.0, "lead_q": 0.4,
              "exit": 0.2, "on_grid": 0.2, "lull": -1.5, "ends_in_fade": -0.8, "early": -0.4,
              "dur": -0.006, "dur_target_s": 50, "rep_bars": 8,
              # fixer (review v1, musical #4, #7): an exit through a sung line; each verse /
              # outro / break bar in the body; X closing the landing's highlight section. note:
              # the review's -1.5 made a verse with a clean exit beat the chorus of the same song
              # (Live In Life) and pushed 5 sung tracks under min_h; -0.6 keeps clean exits
              # first without that (the echo throw of §5.3 handles the rest)
              "vocal_edge": -0.6, "verse_bar": -0.03, "section_end": 0.15},
        "verse_labels": ["verse", "outro", "break"],
        "highlight_labels": ["chorus", "inst", "solo"],
        # fixer (musical #4): with stems, an exit runs through the sung line when the vocal stem
        # (>= vocal_run_db rel. the mix p90 bar level) sounds at the air point X - 1/4 beat and
        # runs on >= vocal_gap_s before a 60 ms pause (V12 measures the same on the render); a
        # track counts as sung when the p75 of its bar vocal-stem level reaches vocal_track_db
        "vocal_gap_s": 0.25, "vocal_gap_frame_s": 0.01, "vocal_track_db": -20, "vocal_run_db": -28,
        # fixer (musical #2): a drop (contrast >= drop_contrast_db or low jump >= drop_low_db)
        # whose downbeat onset is on time but weak after its riser passes the onset gate from
        # drop_onset_ratio x the median downbeat strength; other weak landings only lose bin
        "drop_onset_ratio": 0.5, "no_onset_bin": -0.2,
        # fixer (musical #3): a slam needs an arrival: contrast >= arrival_contrast_db, a low
        # jump >= drop_low_db, or a section start where the vocal enters within 1 beat
        # (>= arrival_vocal_db over the beats before it)
        "arrival_contrast_db": 2, "arrival_vocal_db": 6,
        "early_s": 20, "early_frac": 0.12,
        "s_out": {"natural": 0.4, "dip": 0.2, "tail48": 0.3, "in_fade_or_lull": -1.0,
                  "vocal_at_edge": -0.5},
        "tail_db": 3, "tail_bars": [4, 8],
        "vocal_edge_stem_db": -30, "vocal_edge_vox_db": 3,
    },
    # §6 selection and order
    "blocks": {
        "order": ["house", "dnb", "swing", "rock", "close"],      # fixer: + rock (musical #5)
        "house": {"bpm": [115, 131]}, "dnb": {"bpm": [160, 180]}, "swing": {"bpm": [80, 112]},
        # fixer (musical #5): energy no longer sends locked 4/4 dance tracks to close; the old
        # close block is split by genre bucket into rock (rock bucket, or energy >=
        # rock_energy_min) and close (chill and the rest)
        "close_energy_max": 0.3, "rock_energy_min": 0.45, "min_tracks": 3,
        "quota": "all",                              # AMENDMENTS 1: every eligible track of each block
        "dnb_swing_double_pct": 6.0,
    },
    # fixer (musical #5): step 1.5 -> 4, + bucket (a change of genre bucket between neighbours)
    "order_cost": {"tempo": 25, "arc": 1.0, "step": 4.0, "step_free": 0.15, "key": 0.3, "bucket": 1.0,
                   "timbre": 0.3, "same_artist": 5, "non_lock": 0.5, "house_down": 0.5,
                   "house_down_bpm": 1},
    "e_star": [[0.0, 0.50], [0.45, 0.70], [0.50, 0.85], [0.65, 0.85], [0.70, 0.65], [0.88, 0.65],
               [1.0, 0.45]],
    # §7 relations
    # A window [X - (E + R + a_pad) bars, X + a_after], B window [j - E - b_pre bars, j + b_after]
    "relation": {"entry_bars": 8, "a_pad_bars": 2, "a_after_bars": 1, "b_pre_bars": 1, "b_after_bars": 8,
                 "min_fit_beats": 16, "ramp_bars_max": 6},
    "key": {"cam_ok": 1, "layer_max_beats": 1, "cap_lead_bars": 4, "mid_high_db": -6,
            "mid_high_clash_db": -8, "tonal_db": -12, "ht_beats": 32,
            "clash": {"0": 0.0, "1": 0.0, "2": 0.5, "3": 1.0}},
    # §10 forms
    "base_f": {"double_drop": 1.10, "tease_drop": 1.05, "drop_swap": 1.00, "stem_handover": 1.00,
               "vocal_reveal": 1.00, "phrase_trade": 0.95, "stutter_stitch": 0.90, "half_time": 0.90,
               "roll_slam": 0.75, "echo_slam": 0.70, "tape_stop_slam": 0.60, "spin_slam": 0.60,
               "cut_on_one": 0.30, "air_cut": 0.70,       # fixer: + air_cut (gapless lock slam)
               "mashup": 1.10, "drum_swap": 1.05, "loop_rewind": 1.10, "call_response": 1.05,
               "gated_weave": 1.05},
    # creation forms (medley v5): A and B coexist in a composed middle; stems keep one drum kit
    # and one bassline at any instant. A warps onto B's clock (ramping while alone first)
    "creation": {
        "enabled": True,
        "max_stretch_pct": 8.0,                      # A warped within 8 % (else half/double, else slams)
        "max_T_s": 72.0,                             # keep a creation region under limits.max_T_s
        "static_overlap_beats": 0.25,                # KIT/BASS_OVERLAP tolerance (static step)
        "kit_tol_beats": 0.25,                       # measured: both kits >= ref - kit_rel_db this long
        "kit_rel_db": 20.0,                          # a kit sounds within 20 dB of its own p90 level
        "kit_floor_dbfs": -45.0,
        "variety_window": 4,                         # no creation form twice within 4 joins
        "pitch_max_semis": 1,                        # v6: never more than 1 semitone, only on "p" variants
        "stem_min_db": -14.0,                        # a source window needs the stem's mean bar RMS above this
        "variants": 2,                               # LONG parameter seeds per form (r0, r1) beside s0 / c0
        "bonus": 4.0,
        "bar_bonus": 0.0,                            # v6: no blanket length bonus (was 0.08 per bar)
        "prior_w": 2.0,                              # beam: x the form's rating prior in [-1, 1]
        "loop_penalty": 1.5,                         # beam: loop_rewind until ratings say otherwise
        "smooth_bonus": 0.3,                         # beam: drum_swap / mashup / call_response
        "form_prior": {},                            # filled from medley-ratings.json by the host                           # beam: per bar of composed middle (longer when it fits)                                # beam: a creation beats every slam when it fits
        "spread": 0.4,                               # beam: per earlier use of the same creation form
    },
    "forms": {
        "ramp_bars_per_pct": 1.0,                    # R = clamp(ceil(|stretch| / 1.0), 2, 6)
        "trade_lens": [8, 8, 4, 4, 2, 2, 1, 1],
        "stutter_steps": ["AAABBBAAAAABBBAA", "BBBAAABBBBBAAABB"],
        "stutter_entry_db": -12, "stutter_top_db": -3,
        "tease_hp_hz": 200, "tease_db": -6, "tease_duck_db": -3,
        "double_drop_a_db": -6, "double_drop_bars": 8,
        "half_time_lead_bars": 4, "half_time_to_db": -3,
        "roll_long_hp_hz": [30, 400], "echo_tail_beats": 8, "echo_preroll_lp_hz": [300, 20000],
        "preroll_max_s": 8,
        "cut_v_loud_db": -3,                         # cut_on_one: v = 1/4 when A's last bar >= -3 dB
        "swell_db": -8, "swell_hp_hz": 2000, "swell_peak_ms": 10,
        "wheel_bonus_dnb": 0.4, "wheel_min_lead_bars": 4, "wheel_arrival_db": 3,
        "wheel_play_bars": 7, "wheel_R_bars": [4, 8],
        "vocal_reveal_min_body_bars": 16,
        "pulse_patterns": {"offbeat": "..xx..xx..xx..xx", "332": "x..x..x.x..x..x.",
                           "stab13": "xx......xx......"},
        "pump_db": [-9, 0], "pump_tau": 0.15,
        "groove_tol_ms": 10,                         # lead addition A: per-position pulse agreement
        # fixer (timing #2): a slam in a lock join ramps A to B's tempo before its gesture (A
        # absorbs the tempo change, R2/R5) when |stretch| > slam_ramp_min_pct
        "slam_ramp_min_pct": 1.0,
        # fixer (musical #1): air_cut holds A's top this far down into the one (no silence)
        "air_cut_hold_db": -9,
        # fixer (musical #1): echo_slam settings rotate with the join index (no repeat within 5)
        "echo_sets": [{"delay": 0.75, "hp_hz": [400, 1500], "send_db": -4},
                      {"delay": 0.5, "hp_hz": [600, 2500], "send_db": -6},
                      {"delay": 1.0, "hp_hz": [300, 1200], "send_db": -5},
                      {"delay": 1.5, "hp_hz": [500, 2000], "send_db": -6},
                      {"delay": 0.75, "hp_hz": [800, 3000], "send_db": -5},
                      {"delay": 0.5, "hp_hz": [300, 1000], "send_db": -4}],
    },
    # §11 scoring
    "score": {
        "bin_lead": {"nobass-nodrums": 1.0, "nobass-drums": 0.8, "build": 0.6, "break": 0.5, "none": 0.25},
        "bin_nobass_drums_weak": 0.4,
        # fixer (musical #3): "onset" now rewards an arrival; no_arrival: the review's -0.5 made a
        # verse or a bar-15 chorus (H 1.0 below the song's best) win on arrival alone
        "bin_slam": {"base": 0.5, "onset": 0.3, "pickup": 0.2, "no_arrival": -0.2},
        "bin_quiet_landing": -0.3, "quiet_landing_db": 2,
        "beat_verify": 0.8,
        "loud_free_db": 2, "loud_span_db": 6,
        "fit_default": 0.6,
        "rt": {"hi": 80, "hi_bonus": 0.2, "lo": 30, "lo_pen": -0.5},
        "per_form_keep": 3, "variants_per_form": 2,
        "per_xj_keep": 2,          # integrator: non-cut forms kept per (X_A, j_B) (see forms.enumerate_candidates)
        "vocal_edge_noecho": -1.0,  # fixer (musical #4): cut_on_one through a sung line
    },
    # §8.9, §9, §12 composition and compiler limits
    "limits": {
        "max_span_beats": 160, "max_T_s": 75,
        "gesture_max_beats": 8, "rewind_max_beats": 4, "scratch_max_beats": 2,
        "knot_slack_beats": 0.125, "perc_db": -20,
        "loop_onset_ms": 10, "reverse_peak_ms": 10,
        "backspin_gain_rate": 0.3, "gesture_lp_hz": [20000, 2000],
        "backspin_end_by_max": -0.25, "reverse_max_beats": 8,   # tape_stop len <= the master bpb
        "bpm_cont_tol": 0.005,         # bpm continuity at clock segment boundaries (bpm)
        "fit_bpm_tol": 0.01,           # a_fit/b_fit bpm0 vs 60 / ref period_s (bpm)
        "static_step_beats": 0.015625, # schema.static_eval sampling (1/64 beat)
    },
    "compile": {
        "clock_steps_per_beat": 64, "vary_step_s": 0.001,
        "reach_pad_beats": 1, "reach_pad_s": 0.5,
        "splice_onset_ms": 15, "splice_low_onset_ms": 20, "splice_low_db": -20,
        "splice_search_retry_ms": 3,
        "xf_ms": 15,                                 # render.XF: region edge overlap
        "cut_ms": 5, "swap_ms": 4, "trade_xf_ms": 4, "cut_in_fade_ms": 2, "steps_ramp_ms": 4,
        "out_guard_ms": 10,                          # integrator: outgoing fades end 10 ms before an onset
        "echo_tail_hp_hz": 1000, "echo_duck_db": 6, "echo_duck_release_beats": 0.25,
    },
    # §13, §15 render and loudness
    "render": {"sinc_taps": 32, "sinc_beta": 8.0, "hermite_max_rate": 1.2, "filter_block": 64,
               "anchor_round_ms": 0.1},
    "loudness": {"abs_gate_lufs": -70, "rel_gate_lu": -10, "block_reset_min_db": -4,
                 "short_s": 3.0, "momentary_s": 0.4, "correct_over_lu": 1,
                 "first_fade_rel_db": -6, "first_fade_bars": 1, "final_fade_bars": 2,
                 "final_end_within_s": 60, "correct_min_bars": 1,
                 # fixer (musical #6): the last song plays to a section end with a fade >= 8 s
                 "final_fade_min_s": 8.0,
                 # fixer (timing #1): the excerpt gain leaves the limiter at most max_gr_db of gain
                 # reduction on the body's loud bars (peak_pct of the bar true peaks, bars.peak_db);
                 # v2 measured the p75 / 2 dB rule still pulling B's first downbeat 3.6 dB down
                 "max_gr_db": 1.5, "peak_pct": 95,
                 # fixer (timing #3): the MP3's limiter ceiling sits this far under ceiling_db (LAME
                 # overshoots the PCM true peak by up to ~0.5 dB)
                 "mp3_headroom_db": 0.6},
    # §14 stems
    # AMENDMENTS 2: stems for every track live at <data_dir>/stems/<mp3 stem>/<name>.flac (44.1 kHz,
    # 16-bit, stereo, same length as the MP3 within len_tol_s). A track has stems only when all four
    # files exist; separate() is never called during a build.
    "stems": {"dir": "stems", "names": ["drums", "bass", "vocals", "other"], "ext": ".flac",
              "sr": 44100, "len_tol_s": 0.1, "separate_in_build": False,
              "offset_tol_ms": 0.1, "residual_db": -15, "search_ms": 60, "windows": 3, "window_s": 20,
              "sync_med_ms": 2, "sync_p95_ms": 4, "vocal_edge_db": -25},
    # AMENDMENTS 3/5: operations. Never restart the live server; test servers use test_ports.
    "ops": {"serve_port": 4300, "test_ports": [4301, 4309], "max_cpu_procs": 3},
    # §16 verification thresholds
    "verify": {
        "onset_n_fft": 1024, "onset_hop": 128,
        "land_err_ms": 10, "land_strength": 0.8, "bt_down_ms": 40, "bt_window_beats": 8,
        "v2a_window_ms": 60, "v2a_med_ms": 6, "v2a_p90_ms": 12, "v2a_warn_p90_ms": 16,
        "v2b_native_med_ms": 1, "v2b_warp_med_ms": 3, "v2b_warp_p95_ms": 8,
        "flam_ms": [20, 90], "flam_rel_db": 18, "flam_floor_dbfs": -30, "rms_ms": 50,
        "dbl_bass_hz": 120, "dbl_bass_db": -15, "dbl_bass_beats": 1,
        "key_overlap_beats": 4, "key_band_hz": [150, 5000], "key_rel_db": -12,
        "click_hp_hz": 8000, "click_ratio": 4, "click_win_ms": 5, "click_ref_ms": 100, "click_onset_ms": 5,
        "tp_dbtp": -0.8, "gr_db": 6, "gr_ms": 50,
        "step_lu": 2, "step_warn_lu": 3, "region_over_lu": 1, "momentary_jump_lu": 6,
        "silence_dbfs": -50, "silence_ms": 30, "vacuum_max_beats": 1, "rewind_gap_max_beats": 1.5,
        "stop_before_beats": 0.25, "seam_ms": 10,
        "tempo_jump_pct": 1.2,
        "air_db": -6, "air_warn_db": -4,
        "vocal_edge_db": -25,
        # fixer (musical #4): V12 fails when A's vocal (stem) sounds at A's cut and runs on for
        # >= v12_tail_s in the source, with no echo throw on A
        "v12_tail_s": 0.25, "v12_frame_s": 0.02,
        "land_strength_drop": 0.5,                   # fixer (musical #2): V1 strength floor for drops
        "v13_body_frac": 0.95, "v13_body_ms": 20, "v13_land_frac": 0.90, "v13_land_ms": 40,
        "max_renders": 5, "max_repairs": 2,
        # v6 candidate search: renders per join (forms x lengths x pitch), scored by the measured
        # blend; shorter wins within tie_band points; variety is a tie-breaker
        "blend_renders": 6, "blend_tie_band": 3.0, "blend_pitch_gain": 10.0,
    },
}


def cfg(overrides: dict | None = None) -> dict:
    """A deep copy of CFG with `overrides` merged in (nested dicts merge key by key)."""
    out = copy.deepcopy(CFG)

    def merge(dst: dict, src: dict) -> None:
        for k, v in src.items():
            if isinstance(v, dict) and isinstance(dst.get(k), dict):
                merge(dst[k], v)
            else:
                dst[k] = copy.deepcopy(v)

    if overrides:
        merge(out, overrides)
    return out
