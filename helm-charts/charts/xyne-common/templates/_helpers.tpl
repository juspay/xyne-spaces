{{- define "xyne-common.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "xyne-common.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- include "xyne-common.name" . }}
{{- end }}
{{- end }}

{{- define "xyne-common.version" -}}
{{- $version := .Values.version | default .Values.image.tag | default .Chart.AppVersion | toString }}
{{- regexReplaceAll "[^a-zA-Z0-9_.-]" $version "-" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "xyne-common.subsetName" -}}
{{- regexReplaceAll "[^a-z0-9-]" (include "xyne-common.version" . | lower) "-" | trunc 63 | trimSuffix "-" | trimPrefix "-" }}
{{- end }}

{{- define "xyne-common.workloadName" -}}
{{- if .Values.versionedName }}
{{- printf "%s-%s" (include "xyne-common.fullname" .) (include "xyne-common.version" . | replace "." "-" | lower) | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- include "xyne-common.fullname" . }}
{{- end }}
{{- end }}

{{- define "xyne-common.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "xyne-common.labels" -}}
helm.sh/chart: {{ include "xyne-common.chart" . }}
{{ include "xyne-common.selectorLabels" . }}
app.kubernetes.io/version: {{ include "xyne-common.version" . | quote }}
app.kubernetes.io/part-of: xyne-spaces
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{- define "xyne-common.selectorLabels" -}}
app.kubernetes.io/name: {{ include "xyne-common.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app: {{ include "xyne-common.fullname" . }}
{{- end }}

{{- define "xyne-common.workloadSelectorLabels" -}}
{{ include "xyne-common.selectorLabels" . }}
{{- if .Values.versionedName }}
version: {{ include "xyne-common.version" . | quote }}
{{- end }}
{{- end }}

{{- define "xyne-common.podLabels" -}}
{{ include "xyne-common.selectorLabels" . }}
version: {{ include "xyne-common.version" . | quote }}
{{- with .Values.podLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{- define "xyne-common.image" -}}
{{- $global := .Values.global | default dict }}
{{- $registry := $global.imageRegistry | default .Values.image.registry }}
{{- $repository := .Values.image.repository }}
{{- $ref := "" }}
{{- if .Values.image.digest }}
{{- $ref = printf "@%s" .Values.image.digest }}
{{- else }}
{{- $ref = printf ":%s" (.Values.image.tag | default .Chart.AppVersion | toString) }}
{{- end }}
{{- if $registry }}
{{- printf "%s/%s%s" $registry $repository $ref }}
{{- else }}
{{- printf "%s%s" $repository $ref }}
{{- end }}
{{- end }}

{{- define "xyne-common.imagePullSecrets" -}}
{{- $global := .Values.global | default dict }}
{{- $secrets := concat ($global.imagePullSecrets | default list) (.Values.imagePullSecrets | default list) }}
{{- with $secrets }}
imagePullSecrets:
  {{- range . }}
  {{- if kindIs "string" . }}
  - name: {{ . }}
  {{- else }}
  - {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- end }}
{{- end }}
{{- end }}

{{- define "xyne-common.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "xyne-common.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "xyne-common.workloadKind" -}}
{{- if eq (.Values.workloadKind | default "Deployment") "StatefulSet" }}StatefulSet{{ else }}Deployment{{ end }}
{{- end }}

{{- define "xyne-common.usesVolumeClaimTemplate" -}}
{{- if and (eq (include "xyne-common.workloadKind" .) "StatefulSet") .Values.persistence.enabled (not .Values.persistence.existingClaim) }}true{{- end }}
{{- end }}

{{- define "xyne-common.hasConfigMap" -}}
{{- if .Values.env }}true{{- end }}
{{- end }}

{{- define "xyne-common.affinity" -}}
{{- if .Values.affinity }}
{{- toYaml .Values.affinity }}
{{- else if eq (.Values.podAntiAffinityPreset | default "") "soft" }}
podAntiAffinity:
  preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        topologyKey: kubernetes.io/hostname
        labelSelector:
          matchLabels:
            {{- include "xyne-common.selectorLabels" . | nindent 12 }}
{{- else if eq (.Values.podAntiAffinityPreset | default "") "hard" }}
podAntiAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    - topologyKey: kubernetes.io/hostname
      labelSelector:
        matchLabels:
          {{- include "xyne-common.selectorLabels" . | nindent 10 }}
{{- end }}
{{- end }}
