# Monitoring

Metrics for every app and the cluster, with Grafana to look at them.

## Turn it on

`02-platform.tfvars`:

```hcl
enable_monitoring = true
```

It installs, in the `monitoring` namespace:

| Piece | Chart | Role |
|---|---|---|
| `victoria-metrics` | `victoria-metrics-k8s-stack` 0.93.0 (release `vm`) | VictoriaMetrics, the cluster scrapers, node exporter, Grafana |
| `otel-collector` | `opentelemetry-collector` 0.173.1 | receives OTLP on 4317/4318 and forwards metrics to `http://vmsingle-vm.monitoring.svc:8428/opentelemetry` |

Every app gets `ENABLE_OTEL_METRICS=true` and
`OTEL_BASE_URL=http://otel-collector.monitoring.svc:4318`; y-sweet gets `Y_SWEET_OTEL_ENDPOINT`.

## Grafana

```bash
kubectl -n monitoring get svc | grep -i grafana
kubectl -n monitoring port-forward svc/<grafana service> 3000:80
kubectl -n monitoring get secret | grep -i grafana          # the admin credentials
```

Configure it, and the rest of the stack, through `addon_values["monitoring"]`:

```hcl
addon_values = {
  monitoring = <<-YAML
    values:
      victoriaMetrics:
        grafana:
          enabled: true
  YAML
}
```

## Logs

Monitoring covers metrics. Application logs go to stdout
(`kubectl -n xyne-apps logs deploy/xyne-backend -f`) and are collected by the cloud's log product
when cluster logging is on. Istio access logs are on: the `istio-proxy` container of any pod shows
every request it handled.
