#!/usr/bin/env python3
"""
plot_results.py — Visualize k6 benchmark results for the paper.

Reads k6 JSON output files and generates:
  1. Latency comparison (p50/p95/p99 bar chart)
  2. Throughput comparison
  3. Failover test timeline (error rate over time)

Usage:
  pip install pandas matplotlib seaborn
  python3 scripts/plot_results.py \
    --introspection results/introspection.json \
    --jwt results/jwt.json \
    --vc results/vc.json \
    --failover results/failover.json
"""

import json
import argparse
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

COLORS = {
    'Token Introspection': '#e74c3c',
    'Short-lived JWT':     '#3498db',
    'DID/VC':              '#2ecc71',
}

FONT_SIZE = 10
plt.rcParams.update({
    'font.family': 'serif',
    'font.size': FONT_SIZE,
    'axes.titlesize': FONT_SIZE + 1,
    'axes.labelsize': FONT_SIZE,
})


def load_k6_json(path):
    """Extract http_req_duration metrics from k6 JSON output."""
    latencies = []
    with open(path) as f:
        for line in f:
            try:
                obj = json.loads(line)
                if (obj.get('type') == 'Point'
                        and obj.get('metric') == 'verification_latency'):
                    latencies.append(obj['data']['value'])
            except json.JSONDecodeError:
                continue
    return np.array(latencies)


def plot_latency_bars(data: dict, output_path='results/fig1_latency.png'):
    """Bar chart: p50, p95, p99 per scenario — Fig. 1 in paper."""
    scenarios = list(data.keys())
    percentiles = [50, 95, 99]
    x = np.arange(len(percentiles))
    width = 0.25

    fig, ax = plt.subplots(figsize=(7, 4))

    for i, (scenario, values) in enumerate(data.items()):
        pcts = [np.percentile(values, p) for p in percentiles]
        bars = ax.bar(x + i * width, pcts, width,
                      label=scenario,
                      color=COLORS[scenario],
                      alpha=0.85,
                      edgecolor='white')
        for bar, val in zip(bars, pcts):
            ax.text(bar.get_x() + bar.get_width() / 2,
                    bar.get_height() + 0.5,
                    f'{val:.1f}',
                    ha='center', va='bottom', fontsize=8)

    ax.set_xticks(x + width)
    ax.set_xticklabels([f'p{p}' for p in percentiles])
    ax.set_ylabel('Latency (ms)')
    ax.set_title('Verification Latency — p50 / p95 / p99')
    ax.legend(fontsize=8)
    ax.yaxis.set_minor_locator(ticker.AutoMinorLocator())
    ax.grid(axis='y', alpha=0.3)
    ax.grid(axis='y', which='minor', alpha=0.15)

    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f'Saved: {output_path}')
    plt.close()


def plot_failover(failover_path, output_path='results/fig2_failover.png'):
    """
    Timeline of error rates during failover test — Fig. 2 in paper.
    Keycloak stop event marked with vertical dashed line.
    """
    # Bin error events by 5-second windows
    events = {'introspection': [], 'jwt': [], 'vc': []}

    with open(failover_path) as f:
        for line in f:
            try:
                obj = json.loads(line)
                if obj.get('type') != 'Point':
                    continue
                metric = obj.get('metric', '')
                ts = obj['data']['time']
                val = obj['data']['value']
                for scenario in events:
                    if f'error_rate_{scenario}' in metric:
                        events[scenario].append((ts, val))
            except (json.JSONDecodeError, KeyError):
                continue

    fig, ax = plt.subplots(figsize=(7, 3.5))

    scenario_labels = {
        'introspection': ('Token Introspection', '#e74c3c'),
        'jwt':           ('Short-lived JWT',     '#3498db'),
        'vc':            ('DID/VC',              '#2ecc71'),
    }

    for scenario, (label, color) in scenario_labels.items():
        if not events[scenario]:
            continue
        times  = [e[0] for e in events[scenario]]
        errors = [e[1] for e in events[scenario]]
        ax.plot(times, errors, label=label, color=color, linewidth=1.5)

    # Mark Keycloak stop (annotate manually or set via env)
    ax.axvline(x=60, color='gray', linestyle='--', linewidth=1,
               label='Keycloak stopped')
    ax.text(61, 0.5, 'Keycloak\nstopped', fontsize=8, color='gray')

    ax.set_xlabel('Time (s)')
    ax.set_ylabel('Error Rate')
    ax.set_ylim(-0.05, 1.15)
    ax.set_title('Failover Test — Error Rate During Keycloak Outage')
    ax.legend(fontsize=8)
    ax.grid(alpha=0.3)

    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f'Saved: {output_path}')
    plt.close()


def print_summary(data: dict):
    """Print summary table for paper."""
    print()
    print(f"{'Scenario':<25} {'Mean':>8} {'p50':>8} {'p95':>8} {'p99':>8} {'Std':>8}")
    print("-" * 65)
    for scenario, values in data.items():
        print(f"{scenario:<25} "
              f"{np.mean(values):>8.2f} "
              f"{np.percentile(values, 50):>8.2f} "
              f"{np.percentile(values, 95):>8.2f} "
              f"{np.percentile(values, 99):>8.2f} "
              f"{np.std(values):>8.2f}")
    print()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--introspection', required=True)
    parser.add_argument('--jwt',           required=True)
    parser.add_argument('--vc',            required=True)
    parser.add_argument('--failover',      default=None)
    args = parser.parse_args()

    import os
    os.makedirs('results', exist_ok=True)

    data = {
        'Token Introspection': load_k6_json(args.introspection),
        'Short-lived JWT':     load_k6_json(args.jwt),
        'DID/VC':              load_k6_json(args.vc),
    }

    print_summary(data)
    plot_latency_bars(data)

    if args.failover:
        plot_failover(args.failover)

    print("Done. Figures saved to results/")
