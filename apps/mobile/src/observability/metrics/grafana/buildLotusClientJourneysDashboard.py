#!/usr/bin/env python3
"""Generate lotus-client-journeys.json. Edit this file, then run it to refresh the dashboard."""

from __future__ import annotations

import json
from pathlib import Path

DS = {"type": "prometheus", "uid": "${DS_VICTORIAMETRICS}"}
LOGS = {"type": "victoriametrics-logs-datasource", "uid": "${DS_VICTORIALOGS}"}

SEL = (
    'service_name="xynespaces-native", '
    'os_type=~"$os_type", '
    'service_version=~"$service_version"'
)

JOURNEY_STEPS = [
    {"color": "green", "value": None},
    {"color": "yellow", "value": 750},
    {"color": "red", "value": 2000},
]
STARTUP_STEPS = [
    {"color": "green", "value": None},
    {"color": "yellow", "value": 2000},
    {"color": "red", "value": 8000},
]


def labels(extra: str = "") -> str:
    return f"{SEL}, {extra}" if extra else SEL


def quantile_expr(metric: str, q: str, extra: str = "", by: str = "os_type") -> str:
    group = f"le, {by}" if by else "le"
    return (
        f"histogram_quantile({q}, "
        f"sum by ({group}) ("
        f"increase({metric}_milliseconds_bucket{{{labels(extra)}}}[$__range])))"
    )


def quantile_over_time(metric: str, q: str, extra: str = "", by: str = "os_type") -> str:
    group = f"le, {by}" if by else "le"
    return (
        f"histogram_quantile({q}, "
        f"sum by ({group}) ("
        f"increase({metric}_milliseconds_bucket{{{labels(extra)}}}[5m])))"
    )


def count_expr(metric: str, extra: str = "", by: str = "os_type") -> str:
    group = f" by ({by})" if by else ""
    return f"sum{group}(increase({metric}_milliseconds_count{{{labels(extra)}}}[$__range]))"


def target(expr: str, ref_id: str, *, instant: bool, legend: str, fmt: str | None = None) -> dict:
    t: dict = {
        "datasource": DS,
        "editorMode": "code",
        "exemplar": False,
        "expr": expr,
        "legendFormat": legend,
        "refId": ref_id,
        "instant": instant,
        "range": not instant,
    }
    if fmt:
        t["format"] = fmt
    return t


def row(panel_id: int, title: str, y: int) -> dict:
    return {
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": y},
        "id": panel_id,
        "title": title,
        "type": "row",
    }


def stat_panel(
    panel_id: int,
    title: str,
    x: int,
    y: int,
    w: int,
    expr: str,
    *,
    unit: str,
    steps: list,
    legend: str = "{{os_type}}",
    description: str = "",
    values: bool = True,
    decimals: int = 0,
) -> dict:
    panel = {
        "datasource": DS,
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "decimals": decimals,
                "mappings": [],
                "thresholds": {"mode": "absolute", "steps": steps},
                "unit": unit,
            },
            "overrides": [],
        },
        "gridPos": {"h": 5, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {
            "colorMode": "background",
            "graphMode": "area",
            "justifyMode": "center",
            "orientation": "auto",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": values},
            "textMode": "value_and_name",
        },
        "pluginVersion": "10.0.0",
        "targets": [target(expr, "A", instant=True, legend=legend)],
        "title": title,
        "type": "stat",
    }
    if description:
        panel["description"] = description
    return panel


def timeseries_panel(
    panel_id: int,
    title: str,
    x: int,
    y: int,
    w: int,
    targets: list[dict],
    *,
    unit: str,
    axis_label: str,
    draw_style: str = "line",
) -> dict:
    return {
        "datasource": DS,
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "palette-classic"},
                "custom": {
                    "axisBorderShow": False,
                    "axisCenteredZero": False,
                    "axisColorMode": "text",
                    "axisLabel": axis_label,
                    "axisPlacement": "auto",
                    "barAlignment": 0,
                    "drawStyle": draw_style,
                    "fillOpacity": 15 if draw_style == "line" else 70,
                    "gradientMode": "none",
                    "hideFrom": {"legend": False, "tooltip": False, "viz": False},
                    "insertNulls": False,
                    "lineInterpolation": "linear",
                    "lineWidth": 2,
                    "pointSize": 5,
                    "scaleDistribution": {"type": "linear"},
                    "showPoints": "never",
                    "spanNulls": True,
                    "stacking": {"group": "A", "mode": "none"},
                    "thresholdsStyle": {"mode": "off"},
                },
                "mappings": [],
                "thresholds": {
                    "mode": "absolute",
                    "steps": [{"color": "green", "value": None}, {"color": "red", "value": 80}],
                },
                "unit": unit,
            },
            "overrides": [],
        },
        "gridPos": {"h": 8, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {
            "legend": {
                "calcs": ["mean", "max"],
                "displayMode": "table",
                "placement": "bottom",
                "showLegend": True,
            },
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "pluginVersion": "10.0.0",
        "targets": targets,
        "title": title,
        "type": "timeseries",
    }


def percentile_table(
    panel_id: int,
    title: str,
    x: int,
    y: int,
    w: int,
    metric: str,
    extra: str,
    group: str,
    steps: list,
) -> dict:
    return {
        "datasource": DS,
        "description": "Percentiles over the selected Grafana range. Histogram only.",
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "custom": {"align": "auto", "cellOptions": {"type": "auto"}, "inspect": False},
                "decimals": 0,
                "mappings": [],
                "thresholds": {"mode": "absolute", "steps": steps},
                "unit": "ms",
            },
            "overrides": [
                {
                    "matcher": {"id": "byName", "options": "count"},
                    "properties": [
                        {"id": "unit", "value": "short"},
                        {"id": "decimals", "value": 0},
                    ],
                }
            ],
        },
        "gridPos": {"h": 8, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {
            "cellHeight": "sm",
            "footer": {"countRows": False, "fields": "", "reducer": ["sum"], "show": False},
            "showHeader": True,
            "sortBy": [{"desc": True, "displayName": "p95"}],
        },
        "pluginVersion": "10.0.0",
        "targets": [
            target(quantile_expr(metric, "0.50", extra, group), "p50", instant=True, legend="p50", fmt="table"),
            target(quantile_expr(metric, "0.95", extra, group), "p95", instant=True, legend="p95", fmt="table"),
            target(quantile_expr(metric, "0.99", extra, group), "p99", instant=True, legend="p99", fmt="table"),
            target(count_expr(metric, extra, group), "count", instant=True, legend="count", fmt="table"),
        ],
        "title": title,
        "transformations": [
            {"id": "merge", "options": {}},
            {
                "id": "organize",
                "options": {
                    "excludeByName": {"Time": True, "__name__": True},
                    "renameByName": {
                        "Value #p50": "p50",
                        "Value #p95": "p95",
                        "Value #p99": "p99",
                        "Value #count": "count",
                    },
                },
            },
        ],
        "type": "table",
    }


def query_var(name: str, label: str, query: str) -> dict:
    return {
        "allValue": ".*",
        "current": {"text": "All", "value": "$__all"},
        "datasource": DS,
        "definition": query,
        "includeAll": True,
        "label": label,
        "multi": True,
        "name": name,
        "options": [],
        "query": query,
        "refresh": 2,
        "regex": "",
        "sort": 1,
        "type": "query",
    }


def custom_var(name: str, label: str, options: str) -> dict:
    return {
        "allValue": ".*",
        "current": {"text": "All", "value": "$__all"},
        "includeAll": True,
        "label": label,
        "multi": True,
        "name": name,
        "options": [],
        "query": options,
        "type": "custom",
    }


def build() -> dict:
    next_id = 1

    def nid() -> int:
        nonlocal next_id
        value = next_id
        next_id += 1
        return value

    panels: list[dict] = []
    y = 0

    panels.append(row(nid(), "Overview", y))
    y += 1
    panels.append(
        stat_panel(
            nid(),
            "Active sessions",
            0,
            y,
            8,
            (
                "count by (os_type) (sum by (session_id, os_type) ("
                f"increase(app_session_heartbeat_total{{{SEL}}}[2m])) > 0)"
            ),
            unit="short",
            steps=[{"color": "green", "value": None}],
            description="Foreground sessions with a heartbeat in the last 2 minutes.",
        )
    )
    panels.append(
        stat_panel(
            nid(),
            "Startups",
            8,
            y,
            4,
            count_expr("app_startup_duration", 'launch_cause=~"$launch_cause", destination=~"$destination"'),
            unit="short",
            steps=[{"color": "blue", "value": None}],
        )
    )
    panels.append(
        stat_panel(
            nid(),
            "Activity → chat",
            12,
            y,
            4,
            count_expr("activity_message_highlight_duration", 'surface=~"$surface"'),
            unit="short",
            steps=[{"color": "blue", "value": None}],
        )
    )
    panels.append(
        stat_panel(
            nid(),
            "Chat skeletons",
            16,
            y,
            4,
            count_expr("chat_open_skeleton_duration", 'entry=~"$entry", surface=~"$surface"'),
            unit="short",
            steps=[{"color": "blue", "value": None}],
        )
    )
    panels.append(
        stat_panel(
            nid(),
            "Notification opens",
            20,
            y,
            4,
            count_expr(
                "notification_message_highlight_duration",
                'app_state=~"$app_state", surface=~"$surface"',
            ),
            unit="short",
            steps=[{"color": "blue", "value": None}],
        )
    )
    y += 5
    panels.append(
        timeseries_panel(
            nid(),
            "Active sessions over time",
            0,
            y,
            24,
            [
                target(
                    (
                        "count by (os_type) (sum by (session_id, os_type) ("
                        f"increase(app_session_heartbeat_total{{{SEL}}}[2m])) > 0)"
                    ),
                    "A",
                    instant=False,
                    legend="{{os_type}}",
                )
            ],
            unit="short",
            axis_label="Sessions",
            draw_style="bars",
        )
    )
    y += 8

    journeys = [
        {
            "title": "Activity to chat",
            "metric": "activity_message_highlight_duration",
            "extra": 'surface=~"$surface"',
            "group": "os_type, surface",
            "steps": JOURNEY_STEPS,
            "table_title": "Activity to chat by OS / surface",
        },
        {
            "title": "App startup",
            "metric": "app_startup_duration",
            "extra": 'launch_cause=~"$launch_cause", destination=~"$destination"',
            "group": "os_type, launch_cause, destination",
            "steps": STARTUP_STEPS,
            "table_title": "App startup by OS / cause / destination",
        },
        {
            "title": "Chat skeleton shown",
            "metric": "chat_open_skeleton_duration",
            "extra": 'entry=~"$entry", surface=~"$surface"',
            "group": "os_type, entry, surface",
            "steps": JOURNEY_STEPS,
            "table_title": "Chat skeleton by OS / entry / surface",
        },
        {
            "title": "Notification open journey",
            "metric": "notification_message_highlight_duration",
            "extra": 'app_state=~"$app_state", surface=~"$surface"',
            "group": "os_type, app_state, surface",
            "steps": JOURNEY_STEPS,
            "table_title": "Notification open by OS / app state / surface",
        },
    ]

    for journey in journeys:
        panels.append(row(nid(), journey["title"], y))
        y += 1
        for index, (label, q) in enumerate((("p50", "0.50"), ("p95", "0.95"), ("p99", "0.99"))):
            panels.append(
                stat_panel(
                    nid(),
                    f"{journey['title']} {label}",
                    index * 8,
                    y,
                    8,
                    quantile_expr(journey["metric"], q, journey["extra"]),
                    unit="ms",
                    steps=journey["steps"],
                    description="Split by OS. Thresholds are user-perceived, not cache-hit Zero times.",
                )
            )
        y += 5
        panels.append(
            timeseries_panel(
                nid(),
                f"{journey['title']} p50 / p95",
                0,
                y,
                14,
                [
                    target(
                        quantile_over_time(journey["metric"], "0.50", journey["extra"]),
                        "p50",
                        instant=False,
                        legend="p50 {{os_type}}",
                    ),
                    target(
                        quantile_over_time(journey["metric"], "0.95", journey["extra"]),
                        "p95",
                        instant=False,
                        legend="p95 {{os_type}}",
                    ),
                ],
                unit="ms",
                axis_label="Latency",
            )
        )
        panels.append(
            percentile_table(
                nid(),
                journey["table_title"],
                14,
                y,
                10,
                journey["metric"],
                journey["extra"],
                journey["group"],
                journey["steps"],
            )
        )
        y += 8

    panels.append(row(nid(), "Who is emitting", y))
    y += 1
    panels.append(
        {
            "datasource": LOGS,
            "description": (
                "Emails live in VictoriaLogs only — they are not metric attributes. "
                "Distinct identities that emitted any native log in the selected range."
            ),
            "fieldConfig": {
                "defaults": {
                    "color": {"mode": "thresholds"},
                    "custom": {"align": "auto", "cellOptions": {"type": "auto"}, "inspect": False},
                    "mappings": [],
                    "thresholds": {
                        "mode": "absolute",
                        "steps": [{"color": "green", "value": None}],
                    },
                },
                "overrides": [],
            },
            "gridPos": {"h": 10, "w": 24, "x": 0, "y": y},
            "id": nid(),
            "options": {
                "cellHeight": "sm",
                "footer": {"countRows": True, "fields": "", "reducer": ["count"], "show": True},
                "showHeader": True,
            },
            "pluginVersion": "10.0.0",
            "targets": [
                {
                    "datasource": LOGS,
                    "editorMode": "code",
                    "expr": (
                        'serviceName:="xynespaces-native" AND email:* '
                        "| stats by (email, appVersion, osName) count() as events"
                    ),
                    "legendFormat": "",
                    "queryType": "instant",
                    "refId": "A",
                }
            ],
            "title": "Emitters in range",
            "type": "table",
        }
    )

    return {
        "__inputs": [
            {
                "name": "DS_VICTORIAMETRICS",
                "label": "VictoriaMetrics",
                "description": "Prometheus-compatible VictoriaMetrics datasource",
                "type": "datasource",
                "pluginId": "prometheus",
            },
            {
                "name": "DS_VICTORIALOGS",
                "label": "VictoriaLogs",
                "description": "Used only for the emitters table (emails are not in metrics)",
                "type": "datasource",
                "pluginId": "victoriametrics-logs-datasource",
            },
        ],
        "__requires": [
            {"type": "grafana", "id": "grafana", "name": "Grafana", "version": "10.0.0"},
            {"type": "datasource", "id": "prometheus", "name": "Prometheus", "version": "1.0.0"},
            {
                "type": "datasource",
                "id": "victoriametrics-logs-datasource",
                "name": "VictoriaLogs",
                "version": "1.0.0",
            },
            {"type": "panel", "id": "stat", "name": "Stat", "version": ""},
            {"type": "panel", "id": "table", "name": "Table", "version": ""},
            {"type": "panel", "id": "timeseries", "name": "Time series", "version": ""},
        ],
        "annotations": {
            "list": [
                {
                    "builtIn": 1,
                    "datasource": {"type": "grafana", "uid": "-- Grafana --"},
                    "enable": True,
                    "hide": True,
                    "iconColor": "rgba(0, 211, 255, 1)",
                    "name": "Annotations & Alerts",
                    "type": "dashboard",
                }
            ]
        },
        "description": (
            "Lotus user-perceived journeys from VictoriaMetrics: startup, activity → chat, "
            "chat skeleton, notification open, and active sessions. Extend this file when "
            "adding more journey panels. Emails stay on VictoriaLogs."
        ),
        "editable": True,
        "fiscalYearStartMonth": 0,
        "graphTooltip": 1,
        "id": None,
        "links": [],
        "panels": panels,
        "preload": False,
        "refresh": "1m",
        "schemaVersion": 39,
        "tags": ["lotus", "mobile", "native", "journeys"],
        "templating": {
            "list": [
                query_var(
                    "os_type",
                    "OS",
                    'label_values(app_startup_duration_milliseconds_count{service_name="xynespaces-native"}, os_type)',
                ),
                query_var(
                    "service_version",
                    "App version",
                    'label_values(app_startup_duration_milliseconds_count{service_name="xynespaces-native"}, service_version)',
                ),
                custom_var("launch_cause", "Launch cause", "direct,notification,call,deeplink,share"),
                custom_var("destination", "Startup destination", "dms,login,enrollment"),
                custom_var("entry", "Chat entry", "direct,notification"),
                custom_var("surface", "Surface", "channel,thread"),
                custom_var("app_state", "Notification app state", "cold,warm"),
            ]
        },
        "time": {"from": "now-6h", "to": "now"},
        "timepicker": {},
        "timezone": "browser",
        "title": "Lotus — Client journeys",
        "uid": "lotus-client-journeys",
        "version": 1,
    }


def main() -> None:
    out = Path(__file__).with_name("lotus-client-journeys.json")
    out.write_text(json.dumps(build(), indent=2) + "\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
