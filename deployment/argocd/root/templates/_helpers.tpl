{{- define "xyne-root.application" -}}
{{- $root := .root }}
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: {{ .name }}
  namespace: {{ $root.Release.Namespace }}
  labels:
    app.kubernetes.io/part-of: xyne-spaces
    app.kubernetes.io/managed-by: {{ $root.Release.Service }}
  annotations:
    argocd.argoproj.io/sync-wave: {{ .wave | default 0 | quote }}
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: {{ $root.Values.argocd.project }}
  source:
    {{- toYaml .source | nindent 4 }}
  destination:
    server: https://kubernetes.default.svc
    namespace: {{ .namespace }}
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
      - RespectIgnoreDifferences=true
      {{- range .syncOptions }}
      - {{ . }}
      {{- end }}
    {{- with .managedNamespaceMetadata }}
    managedNamespaceMetadata:
      {{- toYaml . | nindent 6 }}
    {{- end }}
    retry:
      {{- toYaml $root.Values.argocd.sync.retry | nindent 6 }}
  {{- with .ignoreDifferences }}
  ignoreDifferences:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}

{{- define "xyne-root.awsDefault" -}}
{{- $set := .value }}
{{- if kindIs "invalid" $set }}
{{- ternary "true" "" (eq .root.Values.global.cloud "aws") }}
{{- else }}
{{- ternary "true" "" $set }}
{{- end }}
{{- end }}

{{- define "xyne-root.ingress" -}}
{{- $in := .Values.infra.ingress | default dict }}
{{- $mode := $in.mode | default "gateway" }}
{{- if not (has $mode (list "gateway" "cloud-lb" "external")) }}
{{- fail (printf "infra.ingress.mode must be gateway, cloud-lb or external, got %q" $mode) }}
{{- end }}
{{- $edge := ne $mode "gateway" }}
{{- $serviceType := $in.serviceType | default "" }}
{{- if eq $serviceType "" }}
{{- $serviceType = ternary "NodePort" "LoadBalancer" $edge }}
{{- end }}
{{- if not (has $serviceType (list "LoadBalancer" "NodePort" "ClusterIP")) }}
{{- fail (printf "infra.ingress.serviceType must be LoadBalancer, NodePort or ClusterIP, got %q" $serviceType) }}
{{- end }}
{{- $tls := $in.tls | default "" }}
{{- if eq $tls "" }}
{{- $tls = ternary "internal" "acme" $edge }}
{{- end }}
{{- if not (has $tls (list "acme" "internal" "existing" "none")) }}
{{- fail (printf "infra.ingress.tls must be acme, internal, existing or none, got %q" $tls) }}
{{- end }}
{{- if and (eq $tls "none") (not $edge) }}
{{- fail "infra.ingress.tls none needs a mode that terminates TLS at the edge" }}
{{- end }}
{{- $np := $in.nodePorts | default dict }}
mode: {{ $mode }}
edgeTerminated: {{ $edge }}
serviceType: {{ $serviceType }}
tls: {{ $tls }}
tlsSecret: {{ $in.tlsSecret | default "xyne-gateway-tls" }}
externalTrafficPolicy: {{ $in.externalTrafficPolicy | default "" | quote }}
nodePorts:
  http: {{ $np.http | default 30080 }}
  https: {{ $np.https | default 30443 }}
  status: {{ $np.status | default 30021 }}
{{- end }}

{{- define "xyne-root.deploymentIgnore" -}}
- group: apps
  kind: Deployment
  jsonPointers:
    - /spec/replicas
{{- end }}

{{- define "xyne-root.helmSource" -}}
{{- $root := .root }}
{{- $src := dict "repoURL" (.repoURL | default $root.Values.global.repoURL) "targetRevision" (.targetRevision | default $root.Values.global.chartRevision) }}
{{- if .chart }}
{{- $_ := set $src "chart" .chart }}
{{- else }}
{{- $_ := set $src "path" .path }}
{{- end }}
{{- $helm := dict "releaseName" .releaseName "valuesObject" (.values | default dict) }}
{{- $_ := set $src "helm" $helm }}
{{- toYaml $src }}
{{- end }}

{{- define "xyne-root.merge" -}}
{{- $out := deepCopy .base }}
{{- range .layers }}
{{- $out = mergeOverwrite $out (deepCopy (. | default dict)) }}
{{- end }}
{{- toYaml $out }}
{{- end }}

{{- define "xyne-root.pool" -}}
{{- $pools := .root.Values.infra.nodePools | default dict }}
{{- $pool := index $pools .pool | default dict }}
{{- if not $pool.enabled }}
{{- $pool = $pools.general | default dict }}
{{- end }}
{{- if $pool.enabled }}
nodeSelector: {{ $pool.nodeSelector | default dict | toJson }}
tolerations: {{ $pool.tolerations | default list | toJson }}
{{- else }}
{}
{{- end }}
{{- end }}

{{- define "xyne-root.identity" -}}
{{- $id := index (.root.Values.infra.identities | default dict) .key | default dict }}
{{- $ann := $id.annotations | default dict }}
{{- $labels := $id.labels | default dict }}
serviceAccount:
  annotations: {{ $ann | toJson }}
{{- if $labels }}
commonLabels: {{ $labels | toJson }}
podLabels: {{ $labels | toJson }}
{{- end }}
{{- end }}

{{- define "xyne-root.image" -}}
{{- $g := .root.Values.global }}
{{- $tag := ternary $g.imageTag "" (.xyneImage | default false) }}
{{- if or $g.imageRegistry $tag }}
image:
  {{- with $g.imageRegistry }}
  registry: {{ . }}
  {{- end }}
  {{- with $tag }}
  tag: {{ . | quote }}
  {{- end }}
{{- end }}
{{- with $g.imageRegistry }}
global:
  imageRegistry: {{ . }}
{{- end }}
{{- if not (or $g.imageRegistry $tag) }}
{}
{{- end }}
{{- end }}

{{- define "xyne-root.storageEndpoint" -}}
{{- $s := .Values.infra.storage }}
{{- if $s.endpoint }}
{{- $s.endpoint }}
{{- else if eq $s.mode "incluster" }}
{{- printf "http://xyne-minio.%s.svc:9000" .Values.global.namespace }}
{{- end }}
{{- end }}

{{- define "xyne-root.storageEnv" -}}
{{- $root := .root }}
{{- $s := $root.Values.infra.storage }}
{{- $b := $s.buckets | default dict }}
{{- $main := index $b (.mainBucket | default "main") | default "" }}
STORAGE_PROVIDER: {{ $s.provider | quote }}
{{- if eq $s.provider "s3" }}
AWS_REGION: {{ $s.region | quote }}
{{- with (include "xyne-root.storageEndpoint" $root) }}
S3_ENDPOINT: {{ . | quote }}
{{- end }}
{{- with $main }}
S3_BUCKET_NAME: {{ . | quote }}
{{- end }}
{{- else if eq $s.provider "azure" }}
{{- with $s.account }}
AZURE_STORAGE_ACCOUNT: {{ . | quote }}
{{- end }}
{{- with (include "xyne-root.storageEndpoint" $root) }}
AZURE_STORAGE_ENDPOINT: {{ . | quote }}
{{- end }}
{{- with $main }}
AZURE_STORAGE_CONTAINER: {{ . | quote }}
{{- end }}
{{- else if eq $s.provider "gcs" }}
{{- with $main }}
GCS_BUCKET_NAME: {{ . | quote }}
{{- end }}
{{- end }}
{{- if .allBuckets }}
{{- with $b.docs }}
GCS_DOCS_BUCKET_NAME: {{ . | quote }}
{{- end }}
{{- with $b.canvas }}
GCS_CANVAS_BUCKET_NAME: {{ . | quote }}
{{- end }}
{{- with $b.recordings }}
GCS_SESSION_RECORDING_BUCKET_NAME: {{ . | quote }}
{{- end }}
{{- with $b.workflows }}
GCS_WORKFLOW_STEPS_BUCKET_NAME: {{ . | quote }}
{{- end }}
{{- with $b.transcription }}
TRANSCRIPTION_BUCKET_NAME: {{ . | quote }}
{{- end }}
{{- with $b.bundles }}
GCS_BUNDLE_BUCKET_NAME: {{ . | quote }}
{{- end }}
{{- end }}
{{- end }}

{{- define "xyne-root.storageSecretEnv" -}}
{{- $s := .root.Values.infra.storage }}
{{- if and $s.staticCredentials (eq $s.provider "s3") }}
AWS_ACCESS_KEY_ID:
  name: {{ .secret }}
  key: AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY:
  name: {{ .secret }}
  key: AWS_SECRET_ACCESS_KEY
{{- else }}
{}
{{- end }}
{{- end }}

{{- define "xyne-root.redisHost" -}}
{{- $r := .Values.infra.redis }}
{{- if $r.host }}
{{- $r.host }}
{{- else if eq $r.mode "incluster" }}
{{- printf "xyne-redis.%s.svc" .Values.global.namespace }}
{{- else }}
{{- "redis" }}
{{- end }}
{{- end }}

{{- define "xyne-root.redisEnv" -}}
{{- $r := .root.Values.infra.redis }}
REDIS_HOST: {{ include "xyne-root.redisHost" .root | quote }}
REDIS_PORT: {{ $r.port | default 6379 | toString | quote }}
REDIS_TLS: {{ ternary "true" "false" ($r.tls | default false) | quote }}
{{- end }}

{{- define "xyne-root.publicUrl" -}}
{{- printf "https://%s" .Values.global.domain }}
{{- end }}

{{- define "xyne-root.urls" -}}
{{- $url := include "xyne-root.publicUrl" .root }}
FRONTEND_URL: {{ $url | quote }}
BACKEND_URL: {{ $url | quote }}
CORS_ORIGIN: {{ $url | quote }}
{{- end }}

{{- define "xyne-root.otelEnv" -}}
{{- $m := .root.Values.addons.monitoring }}
{{- if $m.enabled }}
ENABLE_OTEL_METRICS: "true"
OTEL_BASE_URL: {{ printf "http://otel-collector.%s.svc:4318" $m.namespace | quote }}
{{- else }}
ENABLE_OTEL_METRICS: "false"
{{- end }}
{{- end }}

{{- define "xyne-root.otelCollectorUrl" -}}
{{- printf "http://otel-collector.%s.svc:4318" .Values.addons.monitoring.namespace }}
{{- end }}

{{- define "xyne-root.vespaEnv" -}}
{{- if .root.Values.addons.vespa.enabled }}
VESPA_FEED_URL: "http://vespa-feed:8080"
VESPA_QUERY_URL: "http://vespa-search:8080"
VESPA_CONFIG_SERVER_URL: "http://vespa-configserver:19071"
{{- else }}
{}
{{- end }}
{{- end }}

{{- define "xyne-root.hindsightEnv" -}}
{{- $hs := .root.Values.infra.hindsight | default dict }}
{{- $addon := .root.Values.addons.hindsight | default dict }}
{{- $url := $hs.url | default "" }}
{{- if and (eq $url "") $addon.enabled }}
{{- $url = printf "http://%s.%s:%v" $addon.service $addon.namespace $addon.port }}
{{- end }}
{{- with $url }}
HINDSIGHT_URL: {{ . | quote }}
HINDSIGHT_TENANT: {{ $hs.tenant | default "default" | quote }}
MEMORY_PROVIDER: {{ $hs.provider | default "hindsight" | quote }}
{{- end }}
{{- end }}

{{- define "xyne-root.livekitEnv" -}}
{{- $lk := .root.Values.infra.livekit | default dict }}
{{- if and $lk.enabled $lk.url }}
LIVEKIT_URL: {{ $lk.url | quote }}
{{- if .server }}
LIVEKIT_SERVER_URL: {{ $lk.url | quote }}
{{- end }}
{{- else }}
{}
{{- end }}
{{- end }}

{{- define "xyne-root.appBase" -}}
{{- $root := .root }}
{{- $base := dict "istio" (dict "destinationRule" (dict "enabled" true) "virtualService" (dict "enabled" false)) }}
{{- $base = mergeOverwrite $base (include "xyne-root.image" (dict "root" $root "xyneImage" .xyneImage) | fromYaml) }}
{{- $base = mergeOverwrite $base (include "xyne-root.pool" (dict "root" $root "pool" (.pool | default "general")) | fromYaml) }}
{{- with .identity }}
{{- $base = mergeOverwrite $base (include "xyne-root.identity" (dict "root" $root "key" .) | fromYaml) }}
{{- end }}
{{- toYaml $base }}
{{- end }}

{{- define "xyne-root.backendEnv" -}}
{{- $root := .root }}
{{- $env := dict }}
{{- $env = mergeOverwrite $env (include "xyne-root.urls" (dict "root" $root) | fromYaml) }}
{{- $env = mergeOverwrite $env (include "xyne-root.redisEnv" (dict "root" $root) | fromYaml) }}
{{- $env = mergeOverwrite $env (include "xyne-root.storageEnv" (dict "root" $root "allBuckets" true) | fromYaml) }}
{{- $env = mergeOverwrite $env (include "xyne-root.otelEnv" (dict "root" $root) | fromYaml) }}
{{- $env = mergeOverwrite $env (include "xyne-root.vespaEnv" (dict "root" $root) | fromYaml) }}
{{- $env = mergeOverwrite $env (include "xyne-root.livekitEnv" (dict "root" $root "server" true) | fromYaml) }}
{{- if (index $root.Values.apps "xyne-claw").enabled }}
{{- $_ := set $env "XYNE_CLAW_URL" "http://xyne-claw:8081" }}
{{- end }}
{{- if (index $root.Values.apps "xyne-claw-auth").enabled }}
{{- $_ := set $env "XYNE_CLAW_AUTH_URL" "http://xyne-claw-auth:3003" }}
{{- $_ := set $env "XYNE_CLAW_AUTH_INTERNAL_URL" "http://xyne-claw-auth:3003" }}
{{- end }}
{{- if (index $root.Values.apps "xyne-lighton-ocr").enabled }}
{{- $_ := set $env "DOCLING_SERVICE_URL" "http://xyne-lighton-ocr:80" }}
{{- end }}
{{- toYaml $env }}
{{- end }}

{{- define "xyne-root.backendSecretEnv" -}}
{{- $root := .root }}
{{- $sec := dict "REDIS_PASSWORD" (dict "name" "xyne-backend-secrets" "key" "REDIS_PASSWORD" "optional" true) }}
{{- $_ := set $sec "GOOGLE_CLIENT_ID" (dict "name" "xyne-backend-secrets" "key" "GOOGLE_CLIENT_ID" "optional" true) }}
{{- $_ := set $sec "GOOGLE_CLIENT_SECRET" (dict "name" "xyne-backend-secrets" "key" "GOOGLE_CLIENT_SECRET" "optional" true) }}
{{- if .readReplica }}
{{- $_ := set $sec "DATABASE_READ_REPLICA_POOL_URL" (dict "name" "xyne-backend-secrets" "key" "DATABASE_READ_REPLICA_POOL_URL" "optional" true) }}
{{- end }}
{{- if .ysweet }}
{{- $_ := set $sec "Y_SWEET_SERVER_TOKEN" (dict "name" "xyne-backend-secrets" "key" "Y_SWEET_SERVER_TOKEN") }}
{{- end }}
{{- $sec = mergeOverwrite $sec (include "xyne-root.storageSecretEnv" (dict "root" $root "secret" "xyne-backend-secrets") | fromYaml) }}
{{- toYaml $sec }}
{{- end }}

{{- define "xyne-root.appValues.xyne-backend" -}}
{{- $root := .root }}
{{- $v := include "xyne-root.appBase" (dict "root" $root "xyneImage" true "pool" "general" "identity" "backend") | fromYaml }}
{{- $_ := set $v "env" (include "xyne-root.backendEnv" (dict "root" $root) | fromYaml) }}
{{- $_ := set $v "secretEnv" (include "xyne-root.backendSecretEnv" (dict "root" $root "readReplica" true "ysweet" true) | fromYaml) }}
{{- toYaml $v }}
{{- end }}

{{- define "xyne-root.appValues.xyne-worker" -}}
{{- $root := .root }}
{{- $v := include "xyne-root.appBase" (dict "root" $root "xyneImage" true "pool" "general" "identity" "worker") | fromYaml }}
{{- $env := include "xyne-root.backendEnv" (dict "root" $root) | fromYaml }}
{{- $env = mergeOverwrite $env (deepCopy (.worker.env | default dict)) }}
{{- $_ := set $v "fullnameOverride" .worker.name }}
{{- $_ := set $v "env" $env }}
{{- $_ := set $v "secretEnv" (include "xyne-root.backendSecretEnv" (dict "root" $root "readReplica" false) | fromYaml) }}
{{- toYaml $v }}
{{- end }}

{{- define "xyne-root.appValues.xyne-dashboard" -}}
{{- include "xyne-root.appBase" (dict "root" .root "xyneImage" true "pool" "general") }}
{{- end }}

{{- define "xyne-root.appValues.xyne-dashboard-external" -}}
{{- include "xyne-root.appBase" (dict "root" .root "xyneImage" true "pool" "general") }}
{{- end }}

{{- define "xyne-root.appValues.xyne-dashboard-edge" -}}
{{- $root := .root }}
{{- $s := $root.Values.infra.storage }}
{{- $v := include "xyne-root.appBase" (dict "root" $root "xyneImage" true "pool" "general" "identity" "dashboardEdge") | fromYaml }}
{{- $env := dict "STORAGE_BACKEND" $s.provider "STORAGE_ENDPOINT" (include "xyne-root.storageEndpoint" $root) "STORAGE_AUTH" "sdk" }}
{{- with $s.buckets.bundles }}
{{- $_ := set $env "STORAGE_BUCKET" . }}
{{- end }}
{{- if eq $s.provider "azure" }}
{{- with $s.account }}
{{- $_ := set $env "AZURE_STORAGE_ACCOUNT" . }}
{{- end }}
{{- end }}
{{- $env = mergeOverwrite $env (include "xyne-root.otelEnv" (dict "root" $root) | fromYaml) }}
{{- $_ := set $v "env" $env }}
{{- $_ := set $v "secretEnv" (include "xyne-root.storageSecretEnv" (dict "root" $root "secret" "xyne-backend-secrets") | fromYaml) }}
{{- toYaml $v }}
{{- end }}

{{- define "xyne-root.zeroBackupUrl" -}}
{{- ((.Values.infra.zero | default dict).backupUrl) | default "" }}
{{- end }}

{{- define "xyne-root.appValues.xyne-zero" -}}
{{- $root := .root }}
{{- $v := include "xyne-root.appBase" (dict "root" $root "xyneImage" false "pool" "zero" "identity" "zero") | fromYaml }}
{{- $env := dict "ZERO_CHANGE_STREAMER_URI" "http://xyne-zero-replication:80" }}
{{- with include "xyne-root.zeroBackupUrl" $root }}
{{- $_ := set $env "ZERO_LITESTREAM_BACKUP_URL" . }}
{{- end }}
{{- $_ := set $v "env" $env }}
{{- toYaml $v }}
{{- end }}

{{- define "xyne-root.appValues.xyne-zero-replication" -}}
{{- $root := .root }}
{{- $v := include "xyne-root.appBase" (dict "root" $root "xyneImage" false "pool" "zero" "identity" "zero") | fromYaml }}
{{- $v = mergeOverwrite $v (include "xyne-root.zeroReplicationOverrides" $root | fromYaml) }}
{{- with include "xyne-root.zeroBackupUrl" $root }}
{{- $_ := set $v.env "ZERO_LITESTREAM_BACKUP_URL" . }}
{{- end }}
{{- toYaml $v }}
{{- end }}

{{- define "xyne-root.zeroReplicationOverrides" -}}
fullnameOverride: xyne-zero-replication
replicaCount: 1
strategy:
  type: Recreate
containerPorts:
  - name: http
    containerPort: 4849
    protocol: TCP
service:
  ports:
    - name: http
      port: 80
      targetPort: http
    - name: http-zero
      port: 4849
      targetPort: http
env:
  ZERO_NUM_SYNC_WORKERS: "0"
  ZERO_CHANGE_STREAMER_PORT: "4849"
  ZERO_CHANGE_STREAMER_URI: null
autoscaling:
  enabled: false
pdb:
  enabled: false
{{- end }}

{{- define "xyne-root.appValues.xyne-ysweet" -}}
{{- $root := .root }}
{{- $s := $root.Values.infra.storage }}
{{- $app := index $root.Values.apps "xyne-ysweet" }}
{{- $v := include "xyne-root.appBase" (dict "root" $root "xyneImage" false "pool" "general" "identity" "ysweet") | fromYaml }}
{{- $env := dict }}
{{- if eq $s.provider "s3" }}
{{- $_ := set $env "AWS_REGION" $s.region }}
{{- with (include "xyne-root.storageEndpoint" $root) }}
{{- $_ := set $env "AWS_ENDPOINT_URL_S3" . }}
{{- $_ := set $env "AWS_S3_USE_PATH_STYLE" "true" }}
{{- end }}
{{- end }}
{{- if $root.Values.addons.monitoring.enabled }}
{{- $_ := set $env "Y_SWEET_OTEL_ENDPOINT" (printf "%s/v1/metrics" (include "xyne-root.otelCollectorUrl" $root)) }}
{{- end }}
{{- $_ := set $v "env" $env }}
{{- $_ := set $v "secretEnv" (dict "Y_SWEET_AUTH" (dict "name" "xyne-ysweet-secrets" "key" "Y_SWEET_AUTH")) }}
{{- if and (eq $s.provider "s3") $s.staticCredentials }}
{{- $_ := set $v "envFromSecrets" (list "xyne-ysweet-secrets") }}
{{- end }}
{{- if $app.storeUrl }}
{{- $_ := set $v "args" (list "serve" "--host" "0.0.0.0" "--port" "8080" "--checkpoint-freq-seconds" "10" $app.storeUrl) }}
{{- else }}
{{- $_ := set $v "persistence" (dict "enabled" true) }}
{{- end }}
{{- toYaml $v }}
{{- end }}

{{- define "xyne-root.appValues.xyne-claw" -}}
{{- $root := .root }}
{{- $sb := $root.Values.addons.sandbox }}
{{- $v := include "xyne-root.appBase" (dict "root" $root "xyneImage" true "pool" "general" "identity" "claw") | fromYaml }}
{{- $env := dict "SPACES_BACKEND_URL" "http://xyne-backend" "XYNE_CLAW_AUTH_URL" "http://xyne-claw-auth:3003" }}
{{- $env = mergeOverwrite $env (include "xyne-root.redisEnv" (dict "root" $root) | fromYaml) }}
{{- $env = mergeOverwrite $env (include "xyne-root.storageEnv" (dict "root" $root "mainBucket" "claw") | fromYaml) }}
{{- $env = mergeOverwrite $env (include "xyne-root.hindsightEnv" (dict "root" $root) | fromYaml) }}
{{- if $sb.enabled }}
{{- $_ := set $env "KATA_ROUTER_URL" "http://xyne-sandbox-router:8080" }}
{{- $_ := set $env "KATA_NAMESPACE" $root.Values.global.namespace }}
{{- $_ := set $env "KATA_TEMPLATE" $sb.template.name }}
{{- $_ := set $v "serviceAccount" (mergeOverwrite ($v.serviceAccount | default dict) (dict "automount" true)) }}
{{- end }}
{{- $_ := set $v "env" $env }}
{{- toYaml $v }}
{{- end }}

{{- define "xyne-root.appValues.xyne-claw-auth" -}}
{{- $root := .root }}
{{- $v := include "xyne-root.appBase" (dict "root" $root "xyneImage" true "pool" "general" "identity" "clawAuth") | fromYaml }}
{{- $env := dict "AUTH_SERVICE_URL" (include "xyne-root.publicUrl" $root) "AUTH_SERVICE_INTERNAL_URL" "http://xyne-claw-auth:3003" "XYNE_CLAW_URL" "http://xyne-claw:8081" "SPACES_BACKEND_URL" "http://xyne-backend" "XYNE_SPACES_CALLBACK_URL" "http://xyne-backend/api/agent/result" }}
{{- $env = mergeOverwrite $env (include "xyne-root.redisEnv" (dict "root" $root) | fromYaml) }}
{{- $env = mergeOverwrite $env (include "xyne-root.storageEnv" (dict "root" $root "mainBucket" "claw") | fromYaml) }}
{{- $env = mergeOverwrite $env (include "xyne-root.otelEnv" (dict "root" $root) | fromYaml) }}
{{- $_ := set $v "env" $env }}
{{- toYaml $v }}
{{- end }}

{{- define "xyne-root.appValues.xyne-claw-auth-frontend" -}}
{{- include "xyne-root.appBase" (dict "root" .root "xyneImage" true "pool" "general") }}
{{- end }}

{{- define "xyne-root.appValues.xyne-transcription-agent" -}}
{{- $root := .root }}
{{- $v := include "xyne-root.appBase" (dict "root" $root "xyneImage" true "pool" "general" "identity" "transcription") | fromYaml }}
{{- $env := dict "BACKEND_URL" "http://xyne-backend" }}
{{- $env = mergeOverwrite $env (include "xyne-root.redisEnv" (dict "root" $root) | fromYaml) }}
{{- $env = mergeOverwrite $env (include "xyne-root.storageEnv" (dict "root" $root "mainBucket" "transcription") | fromYaml) }}
{{- with $root.Values.infra.storage.buckets.transcription }}
{{- $_ := set $env "TRANSCRIPTION_BUCKET_NAME" . }}
{{- end }}
{{- $env = mergeOverwrite $env (include "xyne-root.livekitEnv" (dict "root" $root) | fromYaml) }}
{{- $_ := set $v "env" $env }}
{{- $_ := set $v "secretEnv" (include "xyne-root.storageSecretEnv" (dict "root" $root "secret" "xyne-transcription-agent-secrets") | fromYaml) }}
{{- toYaml $v }}
{{- end }}

{{- define "xyne-root.appValues.xyne-lighton-ocr" -}}
{{- $root := .root }}
{{- $v := include "xyne-root.appBase" (dict "root" $root "xyneImage" true "pool" "general") | fromYaml }}
{{- $_ := set $v "env" (include "xyne-root.redisEnv" (dict "root" $root) | fromYaml) }}
{{- toYaml $v }}
{{- end }}

{{- define "xyne-root.app" -}}
{{- $root := .root }}
{{- $app := index $root.Values.apps .name | default dict }}
{{- $built := include (printf "xyne-root.appValues.%s" (.builder | default .chart)) (dict "root" $root "worker" .worker) | fromYaml }}
{{- $values := include "xyne-root.merge" (dict "base" $built "layers" (list $app.values .workerValues)) | fromYaml }}
{{- $source := include "xyne-root.helmSource" (dict "root" $root "path" (printf "helm-charts/charts/%s" .chart) "releaseName" .name "values" $values) | fromYaml }}
{{- include "xyne-root.application" (dict "root" $root "name" .name "namespace" $root.Values.global.namespace "wave" (.wave | default 0) "source" $source "ignoreDifferences" (include "xyne-root.deploymentIgnore" . | fromYamlArray)) }}
{{- end }}
