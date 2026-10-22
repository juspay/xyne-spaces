//! One metric as the server reports it, whatever carries it away: a name,
//! a kind, a unit, and its points, each a set of labels and a value. The
//! measurements ([`crate::stats::Stats::metrics`]) are listed once in this
//! form and written out twice: as Prometheus exposition text for whoever
//! scrapes `/metrics` ([`prometheus`]), and as an OTLP request for the
//! collector the server pushes to (`crate::otel`). Both carry the same
//! names, labels and values, so a dashboard reads the same either way.

use std::fmt::Write as _;

/// What a metric's value means over time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A total that only grows while the process lives.
    Counter,
    /// A value as it is now.
    Gauge,
    /// A distribution of samples over fixed bounds.
    Histogram,
}

/// A point's value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Int(u64),
    Float(f64),
    /// `cumulative[i]` samples were at most `bounds[i]`; `count` samples
    /// in all, adding up to `sum`, the largest `max`.
    Distribution {
        bounds: Vec<f64>,
        cumulative: Vec<u64>,
        count: u64,
        sum: f64,
        max: f64,
    },
}

/// One labelled value of a metric.
#[derive(Debug, Clone, PartialEq)]
pub struct Point {
    pub labels: Vec<(&'static str, String)>,
    pub value: Value,
}

/// One metric: every point that shares its name.
#[derive(Debug, Clone, PartialEq)]
pub struct Metric {
    pub name: String,
    pub help: &'static str,
    /// The unit in UCUM, as OTLP carries it: `s`, `By`, or nothing.
    pub unit: &'static str,
    pub kind: Kind,
    pub points: Vec<Point>,
}

/// Metrics in the order they were first named, points of one name kept
/// together.
#[derive(Debug, Default)]
pub struct Catalogue {
    metrics: Vec<Metric>,
}

impl Catalogue {
    /// Add one point to the metric `name`, which is created when this is
    /// its first point.
    pub fn point(
        &mut self,
        name: &str,
        kind: Kind,
        unit: &'static str,
        help: &'static str,
        labels: Vec<(&'static str, String)>,
        value: Value,
    ) {
        let point = Point { labels, value };
        match self.metrics.iter_mut().find(|metric| metric.name == name) {
            Some(metric) => metric.points.push(point),
            None => self.metrics.push(Metric {
                name: name.to_owned(),
                help,
                unit,
                kind,
                points: vec![point],
            }),
        }
    }

    /// The metrics collected.
    pub fn into_metrics(self) -> Vec<Metric> {
        self.metrics
    }
}

/// `metrics` in Prometheus exposition format: a histogram's buckets are
/// cumulative with a closing `+Inf`, then its sum and count.
pub fn prometheus(metrics: &[Metric]) -> String {
    let mut out = String::with_capacity(16 * 1024);
    for metric in metrics {
        let name = &metric.name;
        if !metric.help.is_empty() {
            let _ = writeln!(out, "# HELP {name} {}", metric.help);
        }
        let kind = match metric.kind {
            Kind::Counter => "counter",
            Kind::Gauge => "gauge",
            Kind::Histogram => "histogram",
        };
        let _ = writeln!(out, "# TYPE {name} {kind}");
        for point in &metric.points {
            match &point.value {
                Value::Int(value) => {
                    let _ = writeln!(out, "{name}{} {value}", braced(&point.labels, None));
                }
                Value::Float(value) => {
                    let _ = writeln!(out, "{name}{} {value}", braced(&point.labels, None));
                }
                Value::Distribution {
                    bounds,
                    cumulative,
                    count,
                    sum,
                    ..
                } => {
                    for (bound, at_most) in bounds.iter().zip(cumulative) {
                        let le = bound.to_string();
                        let _ = writeln!(
                            out,
                            "{name}_bucket{} {at_most}",
                            braced(&point.labels, Some(&le))
                        );
                    }
                    let _ = writeln!(
                        out,
                        "{name}_bucket{} {count}",
                        braced(&point.labels, Some("+Inf"))
                    );
                    let _ = writeln!(out, "{name}_sum{} {sum}", braced(&point.labels, None));
                    let _ = writeln!(out, "{name}_count{} {count}", braced(&point.labels, None));
                }
            }
        }
    }
    out
}

/// A point's labels in braces, `le` last when given; nothing when there
/// are none.
fn braced(labels: &[(&'static str, String)], le: Option<&str>) -> String {
    let mut parts: Vec<String> = labels
        .iter()
        .map(|(key, value)| format!("{key}=\"{}\"", escaped(value)))
        .collect();
    if let Some(le) = le {
        parts.push(format!("le=\"{le}\""));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("{{{}}}", parts.join(","))
    }
}

/// A label value with what the exposition format escapes.
fn escaped(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Points of one name share one TYPE line, labels are escaped, and a
    /// distribution is written as cumulative buckets, a sum and a count.
    #[test]
    fn the_text_groups_points_and_writes_distributions() {
        let mut catalogue = Catalogue::default();
        catalogue.point(
            "x_total",
            Kind::Counter,
            "",
            "things",
            vec![("result", "hit".to_owned())],
            Value::Int(3),
        );
        catalogue.point(
            "x_seconds",
            Kind::Histogram,
            "s",
            "",
            vec![("name", "a\"b".to_owned())],
            Value::Distribution {
                bounds: vec![0.5, 1.0],
                cumulative: vec![1, 3],
                count: 4,
                sum: 6.5,
                max: 4.0,
            },
        );
        catalogue.point(
            "x_total",
            Kind::Counter,
            "",
            "things",
            vec![("result", "miss".to_owned())],
            Value::Int(1),
        );
        let metrics = catalogue.into_metrics();
        assert_eq!(metrics.len(), 2);
        assert_eq!(metrics[0].points.len(), 2);
        let text = prometheus(&metrics);
        assert_eq!(text.matches("# TYPE x_total counter").count(), 1);
        assert!(text.contains("# HELP x_total things\n"));
        assert!(text.contains("x_total{result=\"miss\"} 1\n"));
        assert!(text.contains("x_seconds_bucket{name=\"a\\\"b\",le=\"0.5\"} 1\n"));
        assert!(text.contains("x_seconds_bucket{name=\"a\\\"b\",le=\"+Inf\"} 4\n"));
        assert!(text.contains("x_seconds_sum{name=\"a\\\"b\"} 6.5\n"));
        assert!(text.contains("x_seconds_count{name=\"a\\\"b\"} 4\n"));
    }
}
