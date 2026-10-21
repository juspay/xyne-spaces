{{- define "workflows.labels" -}}
app.kubernetes.io/name: workflows
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: xyne-spaces
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "workflows.ref" -}}
{{- printf "{{%s}}" . }}
{{- end }}

{{- define "workflows.image" -}}
{{- $registry := .root.Values.imageRegistry | default "ghcr.io" }}
{{- printf "%s/%s:%s" $registry .target.repository (include "workflows.ref" "inputs.parameters.version") }}
{{- end }}
