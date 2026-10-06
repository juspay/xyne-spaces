{{- define "vespa-app.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{- define "vespa-app.host" -}}
{{- printf "%s-%d.%s.%s.svc.%s" .name .index .service .root.Release.Namespace .root.Values.clusterDomain }}
{{- end }}

{{- define "vespa-app.configserver" -}}
{{- include "vespa-app.host" (dict "root" . "name" .Values.configserver.name "index" 0 "service" .Values.configserver.service) }}
{{- end }}

{{- define "vespa-app.hostsXml" -}}
<?xml version="1.0" encoding="utf-8" ?>
<hosts>
  <host name="{{ include "vespa-app.configserver" . }}">
    <alias>admin0</alias>
  </host>
{{- range $role, $spec := .Values.roles }}
{{- range $i := until (int $spec.replicas) }}
  <host name="{{ include "vespa-app.host" (dict "root" $ "name" $spec.name "index" $i "service" $spec.service) }}">
    <alias>{{ $role }}{{ $i }}</alias>
  </host>
{{- end }}
{{- end }}
</hosts>
{{- end }}

{{- define "vespa-app.embedders" -}}
<component id="hf-embedder" type="openai-embedder">
  <model>{{ .Values.embedder.model }}</model>
  <dimensions>{{ .Values.embedder.dimensions }}</dimensions>
  <endpoint>{{ .Values.embedder.endpoint }}</endpoint>
</component>
<component id="embed-file" type="openai-embedder">
  <model>{{ .Values.embedder.model }}</model>
  <dimensions>{{ .Values.embedder.dimensions }}</dimensions>
  <endpoint>{{ .Values.embedder.fileEndpoint }}</endpoint>
</component>
{{- end }}

{{- define "vespa-app.containerNodes" -}}
<nodes>
  <jvm allocated-memory="50%"/>
{{- range $i := until (int .replicas) }}
  <node hostalias="{{ $.role }}{{ $i }}"/>
{{- end }}
</nodes>
{{- end }}

{{- define "vespa-app.servicesXml" -}}
<?xml version="1.0" encoding="utf-8" ?>
<services version="1.0">
  <admin version="2.0">
    <adminserver hostalias="admin0"/>
    <cluster-controllers>
      <cluster-controller hostalias="admin0"/>
    </cluster-controllers>
  </admin>

  <container id="feed" version="1.0">
    {{- include "vespa-app.embedders" . | nindent 4 }}
    <config name="container.handler.threadpool">
      <corePoolSize>8</corePoolSize>
      <maxthreads>8</maxthreads>
    </config>
    <document-api/>
    <document-processing/>
    <http>
      <server port="8080" id="default"/>
    </http>
    {{- include "vespa-app.containerNodes" (dict "role" "feed" "replicas" .Values.roles.feed.replicas) | nindent 4 }}
  </container>

  <container id="query" version="1.0">
    {{- include "vespa-app.embedders" . | nindent 4 }}
    <search>
      <threadpool>
        <threads>2</threads>
        <queue>25</queue>
      </threadpool>
    </search>
    <document-api/>
    <config name="container.handler.threadpool">
      <corePoolSize>8</corePoolSize>
      <maxthreads>8</maxthreads>
    </config>
    <http>
      <server port="8080" id="default"/>
    </http>
    {{- include "vespa-app.containerNodes" (dict "role" "query" "replicas" .Values.roles.query.replicas) | nindent 4 }}
  </container>

  <content id="my_content" version="1.0">
    <tuning>
      <resource-limits>
        <disk>0.90</disk>
        <memory>0.85</memory>
      </resource-limits>
    </tuning>
    <engine>
      <proton>
        <tuning>
          <searchnode>
            <requestthreads>
              <search>32</search>
              <persearch>1</persearch>
              <summary>8</summary>
            </requestthreads>
            <feeding>
              <concurrency>0.25</concurrency>
              <niceness>0.5</niceness>
            </feeding>
            <flushstrategy>
              <native>
                <total>
                  <maxmemorygain>8589934592</maxmemorygain>
                  <diskbloatfactor>0.2</diskbloatfactor>
                </total>
              </native>
            </flushstrategy>
          </searchnode>
        </tuning>
      </proton>
    </engine>
    <redundancy reply-after="1">{{ .Values.redundancy }}</redundancy>
    <documents>
{{- range $path, $_ := .Files.Glob "common/schemas/*.sd" }}
{{- $type := base $path | trimSuffix ".sd" }}
      <document type="{{ $type }}" mode="index"{{ if has $type $.Values.globalDocuments }} global="true"{{ end }}/>
{{- end }}
      <document-processing cluster="feed"/>
    </documents>
    <nodes>
{{- range $i := until (int .Values.roles.content.replicas) }}
      <node distribution-key="{{ $i }}" hostalias="content{{ $i }}"/>
{{- end }}
    </nodes>
  </content>
</services>
{{- end }}
