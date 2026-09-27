#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
  cat <<EOF
usage: dns.sh --env <env> [--env-dir <path>] [--dry-run] [--auto-approve]
              [--years <n>] <command>

Prepares the DNS the install needs before setup.sh runs: the domain and a
public zone for it in the same cloud, so 01-infra can write the ingress,
LiveKit and certificate validation records itself.

commands:
  check      is the domain free to register, and what it costs (aws)
  register   register the domain with the cloud's registrar (aws); the
             registrar creates the zone and points the domain at it
  zone       create the public zone if it does not exist, point a domain
             registered in this account at it, and print the dns_zone
             value for 01-infra.tfvars
  status     registration progress, the zone, and whether the public
             delegation matches the zone

  --env <env>        environment name: the directory <env-dir>/<env>/
  --env-dir <path>   directory holding environments (default: $ENV_DIR_BASE)
  --dry-run          print every command instead of running it
  --auto-approve     do not ask before registering or changing name servers
  --years <n>        registration period (default: 1)

The zone is for DNS_DOMAIN in env.conf, or for domain in 01-infra.tfvars when
DNS_DOMAIN is not set. Set DNS_DOMAIN to the registered domain when the
install runs on a subdomain of it: DNS_DOMAIN=example.com with
domain = "spaces.example.com" puts every record for the install in the
example.com zone, and other installs can share it.

register reads the registrant from dns-contact.json in the environment
directory; see docs/dns.md for its fields. It is personal data: keep the
file out of version control.

On gcp and azure, register the domain at any registrar, run zone, and set the
name servers it prints at that registrar. On azure the zone lives in
dns_zone_resource_group from 01-infra.tfvars, which must exist already.
EOF
}

AWS_DOMAINS_REGION="us-east-1"
YEARS=1
COMMAND=""
ENV_ARG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_ARG="${2:-}"; shift 2 ;;
    --env-dir) set_env_dir_base "${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --auto-approve) AUTO_APPROVE=1; shift ;;
    --years) YEARS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    check|register|zone|status) COMMAND="$1"; shift ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

[ -n "$COMMAND" ] || { usage >&2; die "a command is required: check, register, zone or status"; }
case "$YEARS" in
  ''|*[!0-9]*) die "--years takes a whole number" ;;
esac

load_env "$ENV_ARG"

INSTALL_DOMAIN="$(tfvar_value "$INFRA_TFVARS" domain)"
ZONE_DOMAIN="${DNS_DOMAIN:-$INSTALL_DOMAIN}"
ZONE_DOMAIN="${ZONE_DOMAIN%.}"
[ -n "$ZONE_DOMAIN" ] || die "set DNS_DOMAIN in $ENV_CONF or domain in $INFRA_TFVARS"
CONTACT_FILE="$ENV_DIR/dns-contact.json"

if [ -n "$INSTALL_DOMAIN" ]; then
  case "$INSTALL_DOMAIN" in
    "$ZONE_DOMAIN"|*".$ZONE_DOMAIN") ;;
    *) die "domain $INSTALL_DOMAIN in $(basename "$INFRA_TFVARS") is not $ZONE_DOMAIN or a name under it" ;;
  esac
fi

normalize_ns() {
  tr '[:upper:]' '[:lower:]' | sed -E 's/\.$//' | grep -v '^$' | sort -u
}

public_ns() {
  dig +short NS "$ZONE_DOMAIN" 2>/dev/null | normalize_ns || true
}

print_dns_zone_value() {
  printf '\n%s\n' "set in $(basename "$INFRA_TFVARS"):"
  printf '  %s\n' "domain   = \"${INSTALL_DOMAIN:-$ZONE_DOMAIN}\""
  printf '  %s\n' "dns_zone = \"$1\""
  if [ "$CLOUD" = "azure" ]; then
    printf '  %s\n' "dns_zone_resource_group = \"$AZURE_DNS_RG\""
  fi
  printf '\n'
}

aws_zone_id() {
  aws route53 list-hosted-zones-by-name --dns-name "$ZONE_DOMAIN." --max-items 10 --output json |
    jq -r --arg name "$ZONE_DOMAIN." '[.HostedZones[] | select(.Name == $name and (.Config.PrivateZone | not))][0].Id // "" | sub("^/hostedzone/"; "")'
}

aws_zone_ns() {
  aws route53 get-hosted-zone --id "$1" --output json | jq -r '.DelegationSet.NameServers[]' | normalize_ns
}

aws_registered_here() {
  aws route53domains get-domain-detail --region "$AWS_DOMAINS_REGION" --domain-name "$ZONE_DOMAIN" >/dev/null 2>&1
}

aws_registrar_ns() {
  aws route53domains get-domain-detail --region "$AWS_DOMAINS_REGION" --domain-name "$ZONE_DOMAIN" --output json |
    jq -r '.Nameservers[].Name' | normalize_ns
}

aws_last_operation() {
  aws route53domains list-operations --region "$AWS_DOMAINS_REGION" --sort-by SubmittedDate --sort-order DESC --output json |
    jq -c --arg d "$ZONE_DOMAIN" '[.Operations[] | select(.DomainName == $d)][0] // empty'
}

aws_check() {
  local availability price
  availability="$(capture AVAILABLE aws route53domains check-domain-availability --region "$AWS_DOMAINS_REGION" --domain-name "$ZONE_DOMAIN" --query Availability --output text)"
  price="$(capture '{"Prices":[{"RegistrationPrice":{"Price":"<n>","Currency":"USD"},"RenewalPrice":{"Price":"<n>","Currency":"USD"}}]}' aws route53domains list-prices --region "$AWS_DOMAINS_REGION" --tld "${ZONE_DOMAIN##*.}" --output json |
    jq -r '.Prices[0] | "\(.RegistrationPrice.Price) \(.RegistrationPrice.Currency) to register, \(.RenewalPrice.Price) \(.RenewalPrice.Currency) a year to renew"')"
  printf '\n%-14s %s\n' "domain" "$ZONE_DOMAIN"
  printf '%-14s %s\n' "availability" "$availability"
  printf '%-14s %s\n\n' "price" "$price"
  case "$availability" in
    AVAILABLE) ;;
    *) return 1 ;;
  esac
}

aws_contact_json() {
  jq -c '{
    FirstName: .first_name,
    LastName: .last_name,
    ContactType: (if (.organization // "") == "" then "PERSON" else "COMPANY" end),
    OrganizationName: (.organization // null),
    AddressLine1: .address_line_1,
    AddressLine2: (.address_line_2 // null),
    City: .city,
    State: (.state // null),
    CountryCode: .country,
    ZipCode: .postal_code,
    PhoneNumber: .phone,
    Email: .email
  } | with_entries(select(.value != null and .value != ""))' "$CONTACT_FILE"
}

validate_contact() {
  local missing
  [ -f "$CONTACT_FILE" ] || die "missing $CONTACT_FILE; see docs/dns.md for its fields"
  missing="$(jq -r '[("first_name","last_name","email","phone","address_line_1","city","postal_code","country") as $k | select((.[$k] // "") == "") | $k] | join(", ")' "$CONTACT_FILE")"
  [ -z "$missing" ] || die "$CONTACT_FILE is missing: $missing"
  jq -e '.phone | test("^\\+[0-9]{1,3}\\.[0-9]{4,}$")' "$CONTACT_FILE" >/dev/null || die "phone in $CONTACT_FILE must look like +91.9876543210"
  jq -e '.country | test("^[A-Z]{2}$")' "$CONTACT_FILE" >/dev/null || die "country in $CONTACT_FILE must be a two-letter code such as IN"
}

aws_domains_allowed() {
  local out
  if out="$(aws route53domains list-operations --region "$AWS_DOMAINS_REGION" --max-items 1 2>&1)"; then
    return 0
  fi
  if printf '%s' "$out" | grep -qE 'AccessDenied|not authorized'; then
    die "this identity may not use Route 53 Domains (route53domains:* is denied, often by an organisation guardrail). Ask the account administrators to register $ZONE_DOMAIN, or register it at any registrar, then run: dns.sh --env $ENV_NAME zone"
  fi
  die "route53domains list-operations failed: $out"
}

aws_register() {
  local contact privacy op
  [ "$DRY_RUN" = "1" ] || aws_domains_allowed
  if [ "$DRY_RUN" != "1" ] && aws_registered_here; then
    log "$ZONE_DOMAIN is already registered in this account"
    return 0
  fi
  op="$( [ "$DRY_RUN" = "1" ] || aws_last_operation)"
  if [ -n "$op" ] && printf '%s' "$op" | jq -e '.Type == "REGISTER_DOMAIN" and (.Status == "SUBMITTED" or .Status == "IN_PROGRESS")' >/dev/null; then
    log "registration of $ZONE_DOMAIN is already in progress: $(printf '%s' "$op" | jq -r .OperationId)"
    return 0
  fi
  aws_check || die "$ZONE_DOMAIN cannot be registered"
  validate_contact
  contact="$(aws_contact_json)"
  privacy="$(jq -r 'if .privacy == false then "--no-privacy-protect" else "--privacy-protect" end' "$CONTACT_FILE")"
  confirm_typed "$ZONE_DOMAIN" "Register $ZONE_DOMAIN for $YEARS year(s) with auto-renew, billed to this AWS account? This cannot be refunded." ||
    die "aborted before registering $ZONE_DOMAIN"
  run aws route53domains register-domain --region "$AWS_DOMAINS_REGION" \
    --domain-name "$ZONE_DOMAIN" \
    --duration-in-years "$YEARS" \
    --auto-renew \
    --admin-contact "$contact" \
    --registrant-contact "$contact" \
    --tech-contact "$contact" \
    "$privacy-admin-contact" \
    "$privacy-registrant-contact" \
    "$privacy-tech-contact"
  printf '\n%s\n%s\n%s\n\n' \
    "Registration is asynchronous and usually finishes within an hour; some TLDs take longer." \
    "The registrant email may receive a verification link: click it within 15 days or the domain is suspended." \
    "Follow it with: dns.sh --env $ENV_NAME status, then dns.sh --env $ENV_NAME zone"
}

aws_zone() {
  local id zone_ns registrar_ns
  id="$( [ "$DRY_RUN" = "1" ] || aws_zone_id)"
  if [ -n "$id" ]; then
    log "hosted zone for $ZONE_DOMAIN exists: $id"
  else
    id="$(capture '/hostedzone/<zone-id>' aws route53 create-hosted-zone --name "$ZONE_DOMAIN" --caller-reference "xyne-$ZONE_DOMAIN-$(date +%s)" --hosted-zone-config "Comment=xyne $ENV_NAME,PrivateZone=false" --query HostedZone.Id --output text)"
    id="${id#/hostedzone/}"
    log "created hosted zone $id for $ZONE_DOMAIN"
  fi
  [ "$DRY_RUN" = "1" ] && { print_dns_zone_value "$id"; return 0; }

  zone_ns="$(aws_zone_ns "$id")"
  printf '\n%s\n' "name servers of zone $id:"
  printf '%s\n' "$zone_ns" | sed 's/^/  /'

  if aws_registered_here; then
    registrar_ns="$(aws_registrar_ns)"
    if [ "$registrar_ns" = "$zone_ns" ]; then
      log "$ZONE_DOMAIN at the registrar already points at this zone"
    else
      printf '\n%s\n' "$ZONE_DOMAIN at the registrar points at:"
      printf '%s\n' "$registrar_ns" | sed 's/^/  /'
      confirm "Point $ZONE_DOMAIN at zone $id?" || die "aborted before changing the name servers of $ZONE_DOMAIN"
      run aws route53domains update-domain-nameservers --region "$AWS_DOMAINS_REGION" --domain-name "$ZONE_DOMAIN" \
        --nameservers $(printf '%s\n' "$zone_ns" | sed 's/^/Name=/')
    fi
  else
    printf '\n%s\n' "$ZONE_DOMAIN is not registered in this account: set the name servers above at its registrar,"
    printf '%s\n' "or, for a subdomain, as NS records for $ZONE_DOMAIN in the parent zone."
  fi
  print_dns_zone_value "$id"
}

aws_status() {
  local op id
  op="$(aws_last_operation)"
  if [ -n "$op" ]; then
    printf '\n%-22s %s\n' "last operation" "$(printf '%s' "$op" | jq -r '"\(.Type) \(.Status) (\(.OperationId))"')"
  fi
  if aws_registered_here; then
    printf '%-22s %s\n' "registered here" "yes, expires $(aws route53domains get-domain-detail --region "$AWS_DOMAINS_REGION" --domain-name "$ZONE_DOMAIN" --query ExpirationDate --output text)"
  else
    printf '%-22s %s\n' "registered here" "no"
  fi
  id="$(aws_zone_id)"
  if [ -z "$id" ]; then
    printf '%-22s %s\n\n' "hosted zone" "none; run: dns.sh --env $ENV_NAME zone"
    return 0
  fi
  printf '%-22s %s\n' "hosted zone" "$id"
  report_delegation "$(aws_zone_ns "$id")"
}

gcp_zone_name() {
  printf '%s' "$ZONE_DOMAIN" | tr '.' '-'
}

gcp_zone_ns() {
  gcloud dns managed-zones describe "$(gcp_zone_name)" --project "$PROJECT" --format='value(nameServers)' | tr ';,' '\n\n' | normalize_ns
}

gcp_zone() {
  local name
  name="$(gcp_zone_name)"
  if probe gcloud dns managed-zones describe "$name" --project "$PROJECT"; then
    log "managed zone $name exists"
  else
    run gcloud services enable dns.googleapis.com --project "$PROJECT"
    run gcloud dns managed-zones create "$name" --project "$PROJECT" --dns-name "$ZONE_DOMAIN." --visibility public --dnssec-state off --description "xyne $ENV_NAME"
  fi
  if [ "$DRY_RUN" != "1" ]; then
    printf '\n%s\n' "name servers of zone $name; set them at the registrar of $ZONE_DOMAIN:"
    gcp_zone_ns | sed 's/^/  /'
  fi
  print_dns_zone_value "$name"
}

gcp_status() {
  local name
  name="$(gcp_zone_name)"
  if ! gcloud dns managed-zones describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    printf '\n%-22s %s\n\n' "managed zone" "none; run: dns.sh --env $ENV_NAME zone"
    return 0
  fi
  printf '\n%-22s %s\n' "managed zone" "$name"
  report_delegation "$(gcp_zone_ns)"
}

azure_zone_ns() {
  az network dns zone show --resource-group "$AZURE_DNS_RG" --name "$ZONE_DOMAIN" --query nameServers --output tsv | normalize_ns
}

azure_zone() {
  if probe az network dns zone show --resource-group "$AZURE_DNS_RG" --name "$ZONE_DOMAIN"; then
    log "dns zone $ZONE_DOMAIN exists in $AZURE_DNS_RG"
  else
    run az network dns zone create --resource-group "$AZURE_DNS_RG" --name "$ZONE_DOMAIN"
  fi
  if [ "$DRY_RUN" != "1" ]; then
    printf '\n%s\n' "name servers of zone $ZONE_DOMAIN; set them at the registrar of $ZONE_DOMAIN:"
    azure_zone_ns | sed 's/^/  /'
  fi
  print_dns_zone_value "$ZONE_DOMAIN"
}

azure_status() {
  if ! az network dns zone show --resource-group "$AZURE_DNS_RG" --name "$ZONE_DOMAIN" >/dev/null 2>&1; then
    printf '\n%-22s %s\n\n' "dns zone" "none in $AZURE_DNS_RG; run: dns.sh --env $ENV_NAME zone"
    return 0
  fi
  printf '\n%-22s %s\n' "dns zone" "$ZONE_DOMAIN in $AZURE_DNS_RG"
  report_delegation "$(azure_zone_ns)"
}

report_delegation() {
  local zone_ns="$1" live
  live="$(public_ns)"
  if [ -z "$live" ]; then
    printf '%-22s %s\n\n' "public delegation" "none yet; registration or the NS change has not reached the registry"
  elif [ "$live" = "$zone_ns" ]; then
    printf '%-22s %s\n\n' "public delegation" "matches the zone; ready for setup.sh"
  else
    printf '%-22s %s\n' "public delegation" "does NOT match the zone"
    printf '  %s\n' "public name servers:"
    printf '%s\n' "$live" | sed 's/^/    /'
    printf '  %s\n' "zone name servers:"
    printf '%s\n' "$zone_ns" | sed 's/^/    /'
    printf '  %s\n\n' "fix with: dns.sh --env $ENV_NAME zone"
    return 1
  fi
}

unsupported() {
  die "$1 is not available on $CLOUD: register $ZONE_DOMAIN at any registrar, then run: dns.sh --env $ENV_NAME zone"
}

if [ "$CLOUD" = "azure" ]; then
  AZURE_DNS_RG="$(tfvar_value "$INFRA_TFVARS" dns_zone_resource_group)"
  [ -n "$AZURE_DNS_RG" ] || die "set dns_zone_resource_group in $INFRA_TFVARS: the zone must exist before 01-infra creates the install's resource group"
  run az account set --subscription "$SUBSCRIPTION_ID"
fi

log "dns: env=$ENV_NAME cloud=$CLOUD zone=$ZONE_DOMAIN install=${INSTALL_DOMAIN:-<unset>}"

case "$CLOUD:$COMMAND" in
  aws:check) aws_check ;;
  aws:register) aws_register ;;
  aws:zone) aws_zone ;;
  aws:status) aws_status ;;
  gcp:zone) gcp_zone ;;
  gcp:status) gcp_status ;;
  azure:zone) azure_zone ;;
  azure:status) azure_status ;;
  *:check|*:register) unsupported "$COMMAND" ;;
esac
