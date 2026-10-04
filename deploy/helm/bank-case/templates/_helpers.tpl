{{- define "bank-case.name" -}}{{ .Chart.Name }}{{- end -}}
{{- define "bank-case.fullname" -}}{{ printf "%s-%s" .Release.Name .Chart.Name | trunc 50 | trimSuffix "-" }}{{- end -}}
{{- define "bank-case.labels" -}}
app.kubernetes.io/name: {{ include "bank-case.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}
{{- define "bank-case.selector" -}}
app.kubernetes.io/name: {{ include "bank-case.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}
{{- define "bank-case.image" -}}
{{- $r := .root.Values.image.registry -}}
{{- if $r }}{{ printf "%s/%s:%s" $r .image.repository .image.tag }}{{ else }}{{ printf "%s:%s" .image.repository .image.tag }}{{ end -}}
{{- end -}}
{{- define "bank-case.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  runAsUser: {{ .user }}
  runAsGroup: {{ .user }}
  fsGroup: {{ .user }}
  seccompProfile: { type: RuntimeDefault }
{{- end -}}
{{- define "bank-case.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: ["ALL"] }
{{- end -}}
{{- define "bank-case.apiEnv" -}}
- { name: PORT, value: "3000" }
- { name: NODE_ENV, value: production }
- { name: OIDC_ISSUER, value: {{ required "oidc.issuer is required" .Values.oidc.issuer | quote }} }
- { name: OIDC_AUDIENCE, value: {{ .Values.oidc.audience | quote }} }
- { name: OIDC_JWKS_URI, value: {{ required "oidc.jwksUri is required" .Values.oidc.jwksUri | quote }} }
- { name: BUSINESS_TIMEZONE, value: {{ .Values.config.businessTimezone | quote }} }
- { name: TRUST_PROXY, value: {{ .Values.config.trustProxy | quote }} }
- { name: RATE_LIMIT_PER_MINUTE, value: {{ .Values.config.rateLimitPerMinute | quote }} }
- { name: CORS_ORIGIN, value: {{ .Values.config.corsOrigin | quote }} }
- { name: OUTBOX_DISPATCHER_ENABLED, value: {{ .Values.config.outbox.dispatcherEnabled | quote }} }
- { name: OUTBOX_PUBLISHER, value: {{ .Values.config.outbox.publisher | quote }} }
- { name: KAFKA_BROKERS, value: {{ .Values.config.outbox.kafkaBrokers | quote }} }
- { name: KAFKA_TOPIC_PREFIX, value: {{ .Values.config.outbox.kafkaTopicPrefix | quote }} }
- { name: WORKFLOW_SCHEDULER_ENABLED, value: {{ .Values.config.workflowSchedulerEnabled | quote }} }
- { name: RETENTION_ENFORCEMENT_ENABLED, value: {{ .Values.config.retentionEnforcementEnabled | quote }} }
- { name: OBJECT_STORAGE_ENDPOINT, value: {{ .Values.config.objectStorage.endpoint | quote }} }
- { name: OBJECT_STORAGE_BUCKET, value: {{ .Values.config.objectStorage.bucket | quote }} }
- { name: OBJECT_STORAGE_PUBLIC_ENDPOINT, value: {{ .Values.config.objectStorage.publicEndpoint | quote }} }
- { name: CLAMAV_HOST, value: {{ .Values.config.clamav.host | quote }} }
- { name: CLAMAV_PORT, value: {{ .Values.config.clamav.port | quote }} }
- { name: SMTP_HOST, value: {{ .Values.config.email.smtpHost | quote }} }
- { name: SMTP_PORT, value: {{ .Values.config.email.smtpPort | quote }} }
- { name: SMTP_SECURE, value: {{ .Values.config.email.smtpSecure | quote }} }
- { name: MAIL_FROM, value: {{ .Values.config.email.mailFrom | quote }} }
- { name: IMAP_HOST, value: {{ .Values.config.email.imapHost | quote }} }
- { name: IMAP_PORT, value: {{ .Values.config.email.imapPort | quote }} }
- { name: IMAP_SECURE, value: {{ .Values.config.email.imapSecure | quote }} }
- { name: EMAIL_AUTO_ACK, value: {{ .Values.config.email.autoAcknowledge | quote }} }
- { name: EMAIL_MAX_TICKETS_PER_SENDER_HOUR, value: {{ .Values.config.email.maxTicketsPerSenderPerHour | quote }} }
- { name: CRM_CONTACT_URL, value: {{ .Values.config.contacts.crmContactUrl | quote }} }
- { name: SMS_GATEWAY_URL, value: {{ .Values.config.contacts.smsGatewayUrl | quote }} }
- { name: PORTAL_OIDC_ISSUER, value: {{ .Values.oidcPortal.issuer | quote }} }
- { name: PORTAL_OIDC_AUDIENCE, value: {{ .Values.oidcPortal.audience | quote }} }
- { name: PORTAL_OIDC_JWKS_URI, value: {{ .Values.oidcPortal.jwksUri | quote }} }
- { name: PORTAL_MAX_REQUESTS_PER_HOUR, value: {{ .Values.config.portal.maxRequestsPerHour | quote }} }
- { name: PORTAL_MAX_MESSAGES_PER_HOUR, value: {{ .Values.config.portal.maxMessagesPerHour | quote }} }
- { name: AUTH_ALLOWED_CLIENTS, value: {{ .Values.config.auth.allowedClients | quote }} }
- { name: AUTH_INTROSPECTION_URL, value: {{ .Values.config.auth.introspectionUrl | quote }} }
- { name: AUTH_INTROSPECTION_CACHE_SECONDS, value: {{ .Values.config.auth.introspectionCacheSeconds | quote }} }
- { name: ENTITLEMENT_URL, value: {{ .Values.config.auth.entitlementUrl | quote }} }
- { name: STEP_UP_MAX_AGE_SECONDS, value: {{ .Values.config.auth.stepUpMaxAgeSeconds | quote }} }
- { name: STEP_UP_ACR_VALUES, value: {{ .Values.config.auth.stepUpAcrValues | quote }} }
- { name: AUDIT_REQUIRE_RESTRICTED_DB_ROLE, value: {{ .Values.config.audit.requireRestrictedDbRole | quote }} }
- { name: AUDIT_STREAM_ENABLED, value: {{ .Values.config.audit.streamEnabled | quote }} }
- { name: AUDIT_STREAM_INCLUDE_METADATA, value: {{ .Values.config.audit.streamIncludeMetadata | quote }} }
- { name: AUDIT_ANCHOR_PUBLIC_KEY, value: {{ .Values.config.audit.anchorPublicKey | quote }} }
- { name: OBJECT_STORAGE_REGION, value: {{ .Values.config.objectStorage.region | quote }} }
- { name: OBJECT_STORAGE_FORCE_PATH_STYLE, value: {{ .Values.config.objectStorage.forcePathStyle | quote }} }
- { name: OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION, value: {{ .Values.config.objectStorage.serverSideEncryption | quote }} }
- name: DATABASE_URL
  valueFrom: { secretKeyRef: { name: {{ .Values.existingSecret }}, key: DATABASE_URL } }
- name: REDIS_URL
  valueFrom: { secretKeyRef: { name: {{ .Values.existingSecret }}, key: REDIS_URL, optional: true } }
- name: METRICS_TOKEN
  valueFrom: { secretKeyRef: { name: {{ .Values.existingSecret }}, key: METRICS_TOKEN, optional: true } }
{{- range $key := list "AUTH_INTROSPECTION_CLIENT_ID" "AUTH_INTROSPECTION_CLIENT_SECRET" "ENTITLEMENT_TOKEN" "AUDIT_ANCHOR_SIGNING_PRIVATE_KEY" "SMTP_USER" "SMTP_PASSWORD" "IMAP_USER" "IMAP_PASSWORD" "EMAIL_REFERENCE_SECRET" "CRM_CONTACT_TOKEN" "SMS_GATEWAY_TOKEN" }}
- name: {{ $key }}
  valueFrom: { secretKeyRef: { name: {{ $.Values.existingSecret }}, key: {{ $key }}, optional: true } }
{{- end }}
- name: OBJECT_STORAGE_ACCESS_KEY_ID
  valueFrom: { secretKeyRef: { name: {{ .Values.existingSecret }}, key: OBJECT_STORAGE_ACCESS_KEY_ID, optional: true } }
- name: OBJECT_STORAGE_SECRET_ACCESS_KEY
  valueFrom: { secretKeyRef: { name: {{ .Values.existingSecret }}, key: OBJECT_STORAGE_SECRET_ACCESS_KEY, optional: true } }
{{- end -}}
