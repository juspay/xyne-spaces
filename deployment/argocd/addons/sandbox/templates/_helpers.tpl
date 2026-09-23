{{- define "sandbox.labels" -}}
app.kubernetes.io/name: sandbox
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: xyne-spaces
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "sandbox.proxyUrl" -}}
{{- printf "http://%s:%v" .Values.egressProxy.name .Values.egressProxy.port }}
{{- end }}
