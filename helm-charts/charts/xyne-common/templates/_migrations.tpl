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
  activeDeadlineSeconds: {{ $m.activeDeadlineSeconds | default 900 }}
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
              set -e
              {{- range $m.schemas }}
              ./node_modules/.bin/prisma migrate deploy --schema {{ . }}
              {{- end }}
          env:
            {{- range $key := ($m.secretKeys | default (list "DATABASE_URL")) }}
            - name: {{ $key }}
              valueFrom:
                secretKeyRef:
                  name: {{ $m.secretName }}
                  key: {{ $key }}
            {{- end }}
          {{- with $m.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
{{- end }}
{{- end }}
