{{- define "pg-cluster.labels" -}}
app.kubernetes.io/name: pg-cluster
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: xyne-spaces
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "pg-cluster.pooler" -}}
apiVersion: postgresql.cnpg.io/v1
kind: Pooler
metadata:
  name: {{ .root.Values.name }}-pooler-{{ .type }}
  namespace: {{ .root.Values.namespace }}
  labels:
    {{- include "pg-cluster.labels" .root | nindent 4 }}
spec:
  cluster:
    name: {{ .root.Values.name }}
  instances: {{ .root.Values.pooler.instances }}
  type: {{ .type }}
  pgbouncer:
    poolMode: transaction
    parameters:
      max_client_conn: {{ .root.Values.pooler.maxClientConn | quote }}
      default_pool_size: {{ .root.Values.pooler.defaultPoolSize | quote }}
  template:
    metadata:
      annotations:
        {{- toYaml .root.Values.podAnnotations | nindent 8 }}
    spec:
      {{- with .root.Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .root.Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .root.Values.pooler.resources }}
      containers:
        - name: pgbouncer
          resources:
            {{- toYaml . | nindent 12 }}
      {{- end }}
{{- end }}
