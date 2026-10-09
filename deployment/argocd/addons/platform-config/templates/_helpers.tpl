{{- define "platform-config.labels" -}}
app.kubernetes.io/name: platform-config
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: xyne-spaces
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "platform-config.hosts" -}}
{{- $hosts := list .Values.domain }}
{{- if .Values.certManager.wildcard }}
{{- $hosts = append $hosts (printf "*.%s" .Values.domain) }}
{{- end }}
{{- $hosts = concat $hosts .Values.gateway.extraHosts | uniq }}
{{- toYaml $hosts }}
{{- end }}
