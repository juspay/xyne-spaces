{{- define "xyne-common.all" -}}
{{- range $template := list
    "xyne-common.serviceAccount"
    "xyne-common.configMap"
    "xyne-common.pvc"
    "xyne-common.service"
    "xyne-common.workload"
    "xyne-common.hpa"
    "xyne-common.pdb"
    "xyne-common.ingress"
    "xyne-common.destinationRule"
    "xyne-common.virtualService"
    "xyne-common.networkPolicy"
    "xyne-common.serviceMonitor"
    "xyne-common.migrations"
}}
{{- with (include $template $ | trim) }}
---
{{ . }}
{{- end }}
{{- end }}
{{- include "xyne-common.extraObjects" . }}
{{- end }}

{{- define "xyne-common.workload" -}}
{{- if eq (include "xyne-common.workloadKind" .) "StatefulSet" }}
{{- include "xyne-common.statefulset" . }}
{{- else }}
{{- include "xyne-common.deployment" . }}
{{- end }}
{{- end }}
