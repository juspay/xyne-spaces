{{- define "xyne-common.migrationScript" -}}
set -eu
prisma="${PRISMA:-./node_modules/.bin/prisma}"
tsx="${TSX:-./node_modules/.bin/tsx}"

sql_ok() {
  printf '%s\n' "$2" | "$prisma" db execute --stdin --schema "$1" >/dev/null 2>&1
}

has_table() {
  sql_ok "$1" "SELECT 1 / (SELECT count(*) FROM information_schema.tables WHERE table_name = '$2')::int;"
}

has_history() {
  has_table "$1" _prisma_migrations
}

is_empty() {
  sql_ok "$1" "SELECT 1 / (1 - LEAST((SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'zero%' AND table_schema NOT LIKE '\_zero%'), 1))::int;"
}

record_history() {
  schema="$1"
  list="$2"
  dir="$(dirname "$schema")/migrations"
  names="$(grep -v '^[[:space:]]*$' "$list" | while read -r name; do [ -f "$dir/$name/migration.sql" ] && printf '%s\n' "$name"; done)"
  [ -n "$names" ] || return 0
  "$prisma" migrate resolve --applied "$(printf '%s\n' "$names" | head -n 1)" --schema "$schema"
  printf '%s\n' "$names" | tail -n +2 | while read -r name; do
    sum="$(sha256sum "$dir/$name/migration.sql" | cut -c1-64)"
    printf "INSERT INTO \"_prisma_migrations\" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES (gen_random_uuid()::text, '%s', '%s', now(), now(), 1);\n" "$sum" "$name"
  done > /tmp/history.sql
  if [ -s /tmp/history.sql ]; then
    "$prisma" db execute --file /tmp/history.sql --schema "$schema"
  fi
  echo "recorded $(printf '%s\n' "$names" | wc -l | tr -d ' ') baseline migrations as applied"
}

migrate() {
  schema="$1"
  baseline="$(dirname "$schema")/baseline"
  shift
  if [ ! -f "$baseline/migrations.txt" ] || has_history "$schema"; then
    echo "$schema: applying pending migrations"
  elif has_table "$schema" _xyne_baseline || is_empty "$schema"; then
    if has_table "$schema" _xyne_baseline; then
      echo "$schema: resuming an interrupted baseline"
    else
      echo "$schema: empty database, applying the baseline"
      "$prisma" db execute --file "$baseline/schema.sql" --schema "$schema"
      printf '%s\n' 'CREATE TABLE "_xyne_baseline" ("appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now());' | "$prisma" db execute --stdin --schema "$schema"
    fi
    if [ -f "$baseline/extras.sql" ]; then
      "$prisma" db execute --file "$baseline/extras.sql" --schema "$schema"
    fi
    for seed in "$@"; do
      echo "seeding with $seed"
      "$tsx" "$seed"
    done
    record_history "$schema" "$baseline/migrations.txt"
    printf '%s\n' 'DROP TABLE "_xyne_baseline";' | "$prisma" db execute --stdin --schema "$schema"
  else
    echo "$schema: the database has tables but no _prisma_migrations history; refusing to guess. Record the history with prisma migrate resolve and re-run." >&2
    exit 1
  fi
  "$prisma" migrate deploy --schema "$schema"
}
{{- range (.Values.migrations | default dict).schemas }}
migrate {{ .path | quote }}{{ range .seeds }} {{ . | quote }}{{ end }}
{{- end }}
{{- end }}

{{- define "xyne-common.migrations" -}}
{{- $m := .Values.migrations | default dict }}
{{- if $m.enabled }}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "xyne-common.fullname" . }}-migrate
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "xyne-common.labels" . | nindent 4 }}
  annotations:
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: "-5"
    helm.sh/hook-delete-policy: before-hook-creation
spec:
  backoffLimit: {{ $m.backoffLimit | default 2 }}
  activeDeadlineSeconds: {{ $m.activeDeadlineSeconds | default 1800 }}
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: "false"
    spec:
      restartPolicy: Never
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      containers:
        - name: migrate
          image: {{ include "xyne-common.image" . }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          workingDir: {{ $m.workingDir }}
          command:
            - /bin/sh
            - -c
            - |
              {{- include "xyne-common.migrationScript" . | nindent 14 }}
          {{- if or .Values.envFromConfigMaps .Values.envFromSecrets }}
          envFrom:
            {{- range .Values.envFromConfigMaps }}
            - configMapRef:
                name: {{ . }}
            {{- end }}
            {{- range .Values.envFromSecrets }}
            {{- if kindIs "string" . }}
            - secretRef:
                name: {{ . }}
            {{- else }}
            - secretRef:
                {{- toYaml . | nindent 16 }}
            {{- end }}
            {{- end }}
          {{- end }}
          {{- $entries := dict }}
          {{- $order := list }}
          {{- range $k, $v := .Values.env }}
          {{- if not (kindIs "invalid" $v) }}
          {{- if not (hasKey $entries $k) }}{{- $order = append $order $k }}{{- end }}
          {{- $_ := set $entries $k (dict "name" $k "value" (tpl (toString $v) $)) }}
          {{- end }}
          {{- end }}
          {{- range (include "xyne-common.env" . | trim | fromYamlArray) }}
          {{- if not (hasKey $entries .name) }}{{- $order = append $order .name }}{{- end }}
          {{- $_ := set $entries .name . }}
          {{- end }}
          {{- range $m.secretEnv }}
          {{- $ref := dict "name" .secret "key" (.key | default .name) }}
          {{- if .optional }}{{- $_ := set $ref "optional" true }}{{- end }}
          {{- if not (hasKey $entries .name) }}{{- $order = append $order .name }}{{- end }}
          {{- $_ := set $entries .name (dict "name" .name "valueFrom" (dict "secretKeyRef" $ref)) }}
          {{- end }}
          {{- range $k, $v := $m.env }}
          {{- if not (hasKey $entries $k) }}{{- $order = append $order $k }}{{- end }}
          {{- $_ := set $entries $k (dict "name" $k "value" (tpl (toString $v) $)) }}
          {{- end }}
          env:
            {{- range $order }}
            - {{- toYaml (index $entries .) | nindent 14 }}
            {{- end }}
          {{- with $m.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
{{- end }}
{{- end }}
