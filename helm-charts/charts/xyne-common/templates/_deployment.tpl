{{- define "xyne-common.env" -}}
{{- range $name, $ref := .Values.secretEnv }}
{{- if $ref }}
- name: {{ $name }}
  valueFrom:
    secretKeyRef:
      name: {{ $ref.name }}
      key: {{ $ref.key | default $name }}
      {{- if $ref.optional }}
      optional: true
      {{- end }}
{{- end }}
{{- end }}
{{- with .Values.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{- define "xyne-common.envFrom" -}}
{{- if include "xyne-common.hasConfigMap" . }}
- configMapRef:
    name: {{ include "xyne-common.workloadName" . }}
{{- end }}
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
    {{- toYaml . | nindent 4 }}
{{- end }}
{{- end }}
{{- end }}

{{- define "xyne-common.shadowedVolumes" -}}
{{- $names := list }}
{{- if .Values.persistence.enabled }}
{{- range .Values.volumeMounts }}
{{- if eq (.mountPath | trimSuffix "/") ($.Values.persistence.mountPath | trimSuffix "/") }}
{{- $names = append $names .name }}
{{- end }}
{{- end }}
{{- end }}
{{- $names | toJson }}
{{- end }}

{{- define "xyne-common.deployment" -}}
apiVersion: apps/v1
kind: Deployment
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
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  revisionHistoryLimit: {{ .Values.revisionHistoryLimit | default 3 }}
  {{- with .Values.strategy }}
  strategy:
    type: {{ .type | default "RollingUpdate" }}
    {{- if and .rollingUpdate (eq (.type | default "RollingUpdate") "RollingUpdate") }}
    rollingUpdate:
      {{- toYaml .rollingUpdate | nindent 6 }}
    {{- end }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "xyne-common.workloadSelectorLabels" . | nindent 6 }}
  template:{{ include "xyne-common.podTemplate" . }}
{{- end }}

{{- define "xyne-common.podTemplate" -}}
{{- $shadowed := include "xyne-common.shadowedVolumes" . | fromJsonArray }}
{{- $vct := eq (include "xyne-common.usesVolumeClaimTemplate" .) "true" }}
    metadata:
      labels:
        {{- include "xyne-common.podLabels" . | nindent 8 }}
      annotations:
        {{- if include "xyne-common.hasConfigMap" . }}
        checksum/config: {{ .Values.env | toJson | sha256sum }}
        {{- end }}
        {{- with .Values.podAnnotations }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
    spec:
      {{- with (include "xyne-common.imagePullSecrets" . | trim) }}
      {{- . | nindent 6 }}
      {{- end }}
      serviceAccountName: {{ include "xyne-common.serviceAccountName" . }}
      automountServiceAccountToken: {{ .Values.serviceAccount.automount }}
      {{- with .Values.podSecurityContext }}
      securityContext:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.runtimeClassName }}
      runtimeClassName: {{ . }}
      {{- end }}
      {{- with .Values.priorityClassName }}
      priorityClassName: {{ . }}
      {{- end }}
      terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds | default 30 }}
      {{- with .Values.hostAliases }}
      hostAliases:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.dnsPolicy }}
      dnsPolicy: {{ . }}
      {{- end }}
      {{- with .Values.dnsConfig }}
      dnsConfig:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.initContainers }}
      initContainers:
        {{- tpl (toYaml .) $ | nindent 8 }}
      {{- end }}
      containers:
        - name: {{ include "xyne-common.name" . }}
          image: {{ include "xyne-common.image" . | quote }}
          imagePullPolicy: {{ .Values.image.pullPolicy | default "IfNotPresent" }}
          {{- with .Values.command }}
          command:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.args }}
          args:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.securityContext }}
          securityContext:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.containerPorts }}
          ports:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with (include "xyne-common.envFrom" . | trim) }}
          envFrom:
            {{- . | nindent 12 }}
          {{- end }}
          {{- with (include "xyne-common.env" . | trim) }}
          env:
            {{- . | nindent 12 }}
          {{- end }}
          {{- with .Values.startupProbe }}
          startupProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.livenessProbe }}
          livenessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.readinessProbe }}
          readinessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.lifecycle }}
          lifecycle:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- if or .Values.volumeMounts .Values.persistence.enabled }}
          volumeMounts:
            {{- if .Values.persistence.enabled }}
            - name: data
              mountPath: {{ .Values.persistence.mountPath }}
              {{- with .Values.persistence.subPath }}
              subPath: {{ . }}
              {{- end }}
            {{- end }}
            {{- range .Values.volumeMounts }}
            {{- if not (has .name $shadowed) }}
            - {{- toYaml . | nindent 14 }}
            {{- end }}
            {{- end }}
          {{- end }}
        {{- with .Values.sidecars }}
        {{- tpl (toYaml .) $ | nindent 8 }}
        {{- end }}
      {{- if or .Values.volumes (and .Values.persistence.enabled (not $vct)) }}
      volumes:
        {{- if and .Values.persistence.enabled (not $vct) }}
        - name: data
          persistentVolumeClaim:
            claimName: {{ .Values.persistence.existingClaim | default (include "xyne-common.fullname" .) }}
        {{- end }}
        {{- range .Values.volumes }}
        {{- if not (has .name $shadowed) }}
        - {{- tpl (toYaml .) $ | nindent 10 }}
        {{- end }}
        {{- end }}
      {{- end }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with (include "xyne-common.affinity" . | trim) }}
      affinity:
        {{- . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.topologySpreadConstraints }}
      topologySpreadConstraints:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end }}
