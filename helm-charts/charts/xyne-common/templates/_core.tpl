{{- define "xyne-common.service" -}}
{{- if .Values.service.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "xyne-common.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "xyne-common.labels" . | nindent 4 }}
  {{- with .Values.service.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  type: {{ .Values.service.type | default "ClusterIP" }}
  {{- with .Values.service.clusterIP }}
  clusterIP: {{ . }}
  {{- end }}
  {{- with .Values.service.sessionAffinity }}
  sessionAffinity: {{ . }}
  {{- end }}
  ports:
    {{- range .Values.service.ports }}
    - name: {{ .name }}
      port: {{ .port }}
      targetPort: {{ .targetPort | default .port }}
      protocol: {{ .protocol | default "TCP" }}
      {{- if and .nodePort (eq ($.Values.service.type | default "ClusterIP") "NodePort") }}
      nodePort: {{ .nodePort }}
      {{- end }}
    {{- end }}
  selector:
    {{- include "xyne-common.selectorLabels" . | nindent 4 }}
{{- end }}
{{- end }}

{{- define "xyne-common.serviceAccount" -}}
{{- if .Values.serviceAccount.create }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "xyne-common.serviceAccountName" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "xyne-common.labels" . | nindent 4 }}
  {{- with .Values.serviceAccount.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
automountServiceAccountToken: {{ .Values.serviceAccount.automount }}
{{- end }}
{{- end }}

{{- define "xyne-common.configMap" -}}
{{- if include "xyne-common.hasConfigMap" . }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "xyne-common.workloadName" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "xyne-common.labels" . | nindent 4 }}
data:
  {{- range $key, $value := .Values.env }}
  {{- if not (kindIs "invalid" $value) }}
  {{ $key }}: {{ tpl (toString $value) $ | quote }}
  {{- end }}
  {{- end }}
{{- end }}
{{- end }}

{{- define "xyne-common.pvc" -}}
{{- if and .Values.persistence.enabled (not .Values.persistence.existingClaim) (ne (include "xyne-common.workloadKind" .) "StatefulSet") }}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "xyne-common.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "xyne-common.labels" . | nindent 4 }}
  {{- with .Values.persistence.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  accessModes:
    {{- toYaml (.Values.persistence.accessModes | default (list "ReadWriteOnce")) | nindent 4 }}
  {{- with .Values.persistence.storageClass }}
  storageClassName: {{ . | quote }}
  {{- end }}
  resources:
    requests:
      storage: {{ .Values.persistence.size }}
{{- end }}
{{- end }}

{{- define "xyne-common.extraObjects" -}}
{{- range .Values.extraObjects }}
---
{{- if kindIs "string" . }}
{{ tpl . $ }}
{{- else }}
{{ tpl (toYaml .) $ }}
{{- end }}
{{- end }}
{{- end }}
