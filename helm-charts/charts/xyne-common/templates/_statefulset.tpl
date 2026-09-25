{{- define "xyne-common.statefulset" -}}
{{- $statefulset := .Values.statefulset | default dict }}
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ include "xyne-common.workloadName" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "xyne-common.labels" . | nindent 4 }}
    version: {{ include "xyne-common.version" . | quote }}
  {{- with .Values.deploymentAnnotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  serviceName: {{ $statefulset.serviceName | default (include "xyne-common.fullname" .) }}
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  revisionHistoryLimit: {{ .Values.revisionHistoryLimit | default 3 }}
  podManagementPolicy: {{ $statefulset.podManagementPolicy | default "OrderedReady" }}
  {{- with $statefulset.updateStrategy }}
  updateStrategy:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with $statefulset.persistentVolumeClaimRetentionPolicy }}
  persistentVolumeClaimRetentionPolicy:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "xyne-common.workloadSelectorLabels" . | nindent 6 }}
  template:{{ include "xyne-common.podTemplate" . }}
  {{- if eq (include "xyne-common.usesVolumeClaimTemplate" .) "true" }}
  volumeClaimTemplates:
    - metadata:
        name: data
        {{- with .Values.persistence.annotations }}
        annotations:
          {{- toYaml . | nindent 10 }}
        {{- end }}
      spec:
        accessModes:
          {{- toYaml (.Values.persistence.accessModes | default (list "ReadWriteOnce")) | nindent 10 }}
        {{- with .Values.persistence.storageClass }}
        storageClassName: {{ . | quote }}
        {{- end }}
        resources:
          requests:
            storage: {{ .Values.persistence.size }}
  {{- end }}
{{- end }}
