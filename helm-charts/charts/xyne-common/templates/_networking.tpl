{{- define "xyne-common.ingress" -}}
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "xyne-common.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "xyne-common.labels" . | nindent 4 }}
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- with .Values.ingress.className }}
  ingressClassName: {{ . }}
  {{- end }}
  {{- with .Values.ingress.tls }}
  tls:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  rules:
    {{- range .Values.ingress.hosts }}
    - host: {{ .host | quote }}
      http:
        paths:
          {{- range .paths }}
          - path: {{ .path }}
            pathType: {{ .pathType | default "Prefix" }}
            backend:
              service:
                name: {{ include "xyne-common.fullname" $ }}
                port:
                  {{- if .servicePortName }}
                  name: {{ .servicePortName }}
                  {{- else }}
                  number: {{ .servicePort | default (index $.Values.service.ports 0).port }}
                  {{- end }}
          {{- end }}
    {{- end }}
{{- end }}
{{- end }}

{{- define "xyne-common.destinationRule" -}}
{{- if .Values.istio.destinationRule.enabled }}
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: {{ include "xyne-common.fullname" . }}-destinations
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "xyne-common.labels" . | nindent 4 }}
spec:
  host: {{ include "xyne-common.fullname" . }}
  {{- with .Values.istio.destinationRule.exportTo }}
  exportTo:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.istio.destinationRule.trafficPolicy }}
  trafficPolicy:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  subsets:
    {{- if .Values.istio.destinationRule.subsets }}
    {{- toYaml .Values.istio.destinationRule.subsets | nindent 4 }}
    {{- else }}
    - name: {{ include "xyne-common.version" . | quote }}
      labels:
        version: {{ include "xyne-common.version" . | quote }}
    {{- end }}
{{- end }}
{{- end }}

{{- define "xyne-common.virtualService" -}}
{{- if .Values.istio.virtualService.enabled }}
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: {{ include "xyne-common.fullname" . }}-internal-vs
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "xyne-common.labels" . | nindent 4 }}
spec:
  hosts:
    {{- if .Values.istio.virtualService.hosts }}
    {{- toYaml .Values.istio.virtualService.hosts | nindent 4 }}
    {{- else }}
    - {{ printf "%s.%s.svc.cluster.local" (include "xyne-common.fullname" .) .Release.Namespace }}
    {{- end }}
  {{- with .Values.istio.virtualService.gateways }}
  gateways:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  http:
    {{- if .Values.istio.virtualService.http }}
    {{- tpl (toYaml .Values.istio.virtualService.http) . | nindent 4 }}
    {{- else }}
    - route:
        - destination:
            host: {{ include "xyne-common.fullname" . }}
            {{- if .Values.istio.destinationRule.enabled }}
            subset: {{ include "xyne-common.version" . | quote }}
            {{- end }}
          weight: 100
      {{- with .Values.istio.virtualService.timeout }}
      timeout: {{ . }}
      {{- end }}
      {{- with .Values.istio.virtualService.retries }}
      retries:
        {{- toYaml . | nindent 8 }}
      {{- end }}
    {{- end }}
{{- end }}
{{- end }}

{{- define "xyne-common.networkPolicy" -}}
{{- if .Values.networkPolicy.enabled }}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "xyne-common.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "xyne-common.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      {{- include "xyne-common.selectorLabels" . | nindent 6 }}
  policyTypes:
    {{- toYaml (.Values.networkPolicy.policyTypes | default (list "Ingress")) | nindent 4 }}
  {{- with .Values.networkPolicy.ingress }}
  ingress:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.networkPolicy.egress }}
  egress:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}
{{- end }}

{{- define "xyne-common.serviceMonitor" -}}
{{- if .Values.serviceMonitor.enabled }}
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "xyne-common.fullname" . }}
  namespace: {{ .Values.serviceMonitor.namespace | default .Release.Namespace }}
  labels:
    {{- include "xyne-common.labels" . | nindent 4 }}
    {{- with .Values.serviceMonitor.labels }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  namespaceSelector:
    matchNames:
      - {{ .Release.Namespace }}
  selector:
    matchLabels:
      {{- include "xyne-common.selectorLabels" . | nindent 6 }}
  endpoints:
    - port: {{ .Values.serviceMonitor.port }}
      path: {{ .Values.serviceMonitor.path | default "/metrics" }}
      interval: {{ .Values.serviceMonitor.interval | default "30s" }}
      {{- with .Values.serviceMonitor.scrapeTimeout }}
      scrapeTimeout: {{ . }}
      {{- end }}
{{- end }}
{{- end }}
