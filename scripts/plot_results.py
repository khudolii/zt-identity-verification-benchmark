#!/usr/bin/env python3
"""
plot_results.py — Visualize k6 benchmark results for the paper.

Reads k6 --summary-export JSON files for scenario comparisons, and
k6 --out json (raw NDJSON) for the failover timeline chart.

Produces:
  fig1_latency.png   — p50/p90/p95 latency bar chart (scenarios 1-3)
  fig2_errors.png    — error rate bar chart (scenarios 1-3)
  fig3_failover.png  — error rate timeline during Keycloak outage

Usage:
  pip install matplotlib numpy
  python3 scripts/plot_results.py \\
    --introspection results/introspection_summary_<ts>.json \\
    --jwt           results/jwt_summary_<ts>.json \\
    --vc            results/vc_summary_<ts>.json \\
    --failover      results/failover_raw_<ts>.json   # optional, NDJSON
    --keycloak-stop 90                               # seconds, default 90
    --output-dir    results/
"""

import json
import argparse
import os
from datetime import datetime, timezone

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

# ── Style ─────────────────────────────────────────────────────────────────────

COLORS = {
    'Token Introspection': '#e74c3c',
    'Short-lived JWT':     '#3498db',
    'DID/VC (Ed25519)':    '#2ecc71',
}

plt.rcParams.update({
    'font.family':    'serif',
    'font.size':      10,
    'axes.titlesize': 11,
    'axes.labelsize': 10,
})


# ── Loaders ───────────────────────────────────────────────────────────────────

def load_summary(path: str) -> dict:
    """Load a k6 --summary-export JSON file and return the metrics dict."""
    with open(path) as f:
        data = json.load(f)
    return data.get('metrics', {})


def load_failover_ndjson(path: str) -> dict[str, list[tuple[float, float]]]:
    """
    Parse k6 raw NDJSON (--out json) for the failover test.
    Returns per-scenario list of (elapsed_seconds, error_flag) tuples.
    """
    events: dict[str, list] = {
        'introspection': [],
        'jwt':           [],
        'vc':            [],
    }

    t0 = None

    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            if obj.get('type') != 'Point':
                continue

            metric = obj.get('metric', '')
            ts_str = obj['data'].get('time', '')
            val    = obj['data'].get('value', 0)

            # Parse ISO timestamp
            try:
                # Python 3.11+: datetime.fromisoformat handles Z
                ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                continue

            if t0 is None:
                t0 = ts

            elapsed = (ts - t0).total_seconds()

            for scenario in events:
                if metric == f'error_rate_{scenario}':
                    events[scenario].append((elapsed, val))

    return events


# ── Plots ─────────────────────────────────────────────────────────────────────

def plot_latency_bars(metrics: dict, output_path: str):
    """
    Fig 1 — Latency comparison: p50 / p90 / p95 per scenario.
    Reads pre-computed percentiles from summary JSON.
    """
    scenarios = list(metrics.keys())
    labels    = ['p50 (med)', 'p90', 'p95', 'p99']
    pct_keys  = ['med', 'p(90)', 'p(95)', 'p(99)']
    x         = np.arange(len(labels))
    width     = 0.25

    fig, ax = plt.subplots(figsize=(7, 4))

    for i, (scenario, m) in enumerate(metrics.items()):
        vl = m.get('verification_latency', {})
        vals = [vl.get(k, 0) for k in pct_keys]
        bars = ax.bar(x + i * width, vals, width,
                      label=scenario,
                      color=COLORS[scenario],
                      alpha=0.85,
                      edgecolor='white')
        for bar, v in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width() / 2,
                    bar.get_height() + 0.3,
                    f'{v:.1f}',
                    ha='center', va='bottom', fontsize=8)

    ax.set_xticks(x + width)
    ax.set_xticklabels(labels)
    ax.set_ylabel('Latency (ms)')
    ax.set_title('Verification Latency — p50 / p90 / p95')
    ax.legend(fontsize=8)
    ax.yaxis.set_minor_locator(ticker.AutoMinorLocator())
    ax.grid(axis='y', alpha=0.3)
    ax.grid(axis='y', which='minor', alpha=0.15)

    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f'Saved: {output_path}')
    plt.close()


def plot_error_bars(metrics: dict, output_path: str):
    """
    Fig 2 — Error rate per scenario (bar chart).
    """
    scenarios = list(metrics.keys())
    colors    = [COLORS[s] for s in scenarios]
    values    = [metrics[s].get('error_rate', {}).get('value', 0) * 100
                 for s in scenarios]

    fig, ax = plt.subplots(figsize=(5, 4))
    bars = ax.bar(scenarios, values, color=colors, alpha=0.85, edgecolor='white')

    for bar, v in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2,
                bar.get_height() + 0.5,
                f'{v:.1f}%',
                ha='center', va='bottom', fontsize=9)

    ax.set_ylabel('Error Rate (%)')
    ax.set_title('Error Rate Under Ramp Load')
    ax.set_ylim(0, max(values) * 1.25 + 5)
    ax.grid(axis='y', alpha=0.3)

    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f'Saved: {output_path}')
    plt.close()


def plot_failover_timeline(events: dict, keycloak_stop: float, output_path: str):
    """
    Fig 3 — Error rate timeline during failover test.
    Bins raw error_rate_* Point events into 5s windows.
    """
    scenario_meta = {
        'introspection': ('Token Introspection', '#e74c3c'),
        'jwt':           ('Short-lived JWT',     '#3498db'),
        'vc':            ('DID/VC (Ed25519)',     '#2ecc71'),
    }

    fig, ax = plt.subplots(figsize=(7, 3.5))

    for scenario, (label, color) in scenario_meta.items():
        pts = events.get(scenario, [])
        if not pts:
            continue

        # Bin into 5s windows and compute mean error rate per window
        max_t   = max(t for t, _ in pts)
        bins    = np.arange(0, max_t + 5, 5)
        sums    = np.zeros(len(bins) - 1)
        counts  = np.zeros(len(bins) - 1)

        for t, v in pts:
            idx = min(int(t / 5), len(sums) - 1)
            sums[idx]   += v
            counts[idx] += 1

        bin_centers = (bins[:-1] + bins[1:]) / 2
        rates = np.where(counts > 0, sums / counts, np.nan)

        ax.plot(bin_centers, rates,
                label=label, color=color, linewidth=1.8)

    ax.axvline(x=keycloak_stop, color='gray', linestyle='--',
               linewidth=1.2, label='Keycloak stopped')
    ax.text(keycloak_stop + 1, 0.55,
            'Keycloak\nstopped', fontsize=8, color='gray')

    ax.set_xlabel('Time (s)')
    ax.set_ylabel('Error Rate')
    ax.set_ylim(-0.05, 1.15)
    ax.set_title('Failover Test — Error Rate Timeline')
    ax.legend(fontsize=8)
    ax.grid(alpha=0.3)

    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f'Saved: {output_path}')
    plt.close()


def print_summary_table(metrics: dict):
    print()
    print(f"{'Scenario':<25} {'Avg':>8} {'p50':>8} {'p90':>8} {'p95':>8} {'p99':>8} {'Error%':>8}")
    print('-' * 76)
    for scenario, m in metrics.items():
        vl  = m.get('verification_latency', {})
        err = m.get('error_rate', {}).get('value', 0) * 100
        print(f"{scenario:<25} "
              f"{vl.get('avg', 0):>8.2f} "
              f"{vl.get('med', 0):>8.2f} "
              f"{vl.get('p(90)', 0):>8.2f} "
              f"{vl.get('p(95)', 0):>8.2f} "
              f"{vl.get('p(99)', 0):>8.2f} "
              f"{err:>7.1f}%")
    print()


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--introspection', required=True,
                        help='Summary JSON for scenario 1')
    parser.add_argument('--jwt',           required=True,
                        help='Summary JSON for scenario 2')
    parser.add_argument('--vc',            required=True,
                        help='Summary JSON for scenario 3')
    parser.add_argument('--failover',      default=None,
                        help='Raw NDJSON from run-failover.sh (--out json)')
    parser.add_argument('--keycloak-stop', type=float, default=90,
                        help='Seconds into failover test when Keycloak was stopped (default: 90)')
    parser.add_argument('--output-dir',    default='results',
                        help='Directory to save figures (default: results/)')
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    metrics = {
        'Token Introspection': load_summary(args.introspection),
        'Short-lived JWT':     load_summary(args.jwt),
        'DID/VC (Ed25519)':    load_summary(args.vc),
    }

    print_summary_table(metrics)

    plot_latency_bars(metrics,
                      os.path.join(args.output_dir, 'fig1_latency.png'))
    plot_error_bars(metrics,
                    os.path.join(args.output_dir, 'fig2_errors.png'))

    if args.failover:
        events = load_failover_ndjson(args.failover)
        plot_failover_timeline(events, args.keycloak_stop,
                               os.path.join(args.output_dir, 'fig3_failover.png'))

    print('Done. Figures saved to', args.output_dir)
