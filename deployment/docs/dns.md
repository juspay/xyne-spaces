# DNS

The install answers on `domain` and `*.domain`, and with LiveKit on `livekit.domain` and
`turn.domain`. `01-infra` writes those records itself when `dns_zone` names a public zone in the
same cloud. The zone has to exist before `01-infra` runs, and the domain has to be delegated to
it before certificates can be issued. `scripts/dns.sh` does both.

- [The zone and the install domain](#the-zone-and-the-install-domain)
- [Registering a new domain (AWS)](#registering-a-new-domain-aws)
- [A domain you already own](#a-domain-you-already-own)
- [Checking delegation](#checking-delegation)
- [The contact file](#the-contact-file)
- [DNS outside the cloud](#dns-outside-the-cloud)

## The zone and the install domain

The zone is for `DNS_DOMAIN` in `env.conf`. Without it, the zone is for `domain` in
`01-infra.tfvars`. `domain` must be the zone name or a name under it; `dns.sh` and the stacks
both refuse anything else.

Running the install on a subdomain lets one registered domain carry several installs:

```
env.conf            DNS_DOMAIN=example.com
01-infra.tfvars     domain   = "spaces.example.com"
                    dns_zone = "<the example.com zone>"
```

records written:  `spaces.example.com`, `*.spaces.example.com`

Another environment sets `domain = "staging.example.com"` against the same zone.

What `dns_zone` holds differs by cloud, and `dns.sh zone` prints the exact value:

| Cloud | `dns_zone` | Also set |
|---|---|---|
| aws | the Route 53 hosted zone id, `Z…` | |
| gcp | the Cloud DNS managed zone *name*, `example-com` | |
| azure | the zone name, `example.com` | `dns_zone_resource_group`, a resource group that exists before `01-infra` |

## Registering a new domain (AWS)

Route 53 registers the domain, bills the AWS account, and creates a hosted zone the domain
already points at.

```bash
deployment/scripts/dns.sh --env prod check
```

```
domain         example.com
availability   AVAILABLE
price          14.0 USD to register, 14.0 USD a year to renew
```

Write [the contact file](#the-contact-file), then:

```bash
deployment/scripts/dns.sh --env prod register
```

It asks you to type the domain before buying, and the purchase is not refundable. `register` is
safe to run again: it stops when the domain is already registered in the account, or when a
registration for it is in progress.

Registration is asynchronous. It usually finishes within the hour, and some TLDs take longer. The
registrant email receives a verification link for most TLDs; the domain is suspended if it is not
clicked within 15 days.

```bash
deployment/scripts/dns.sh --env prod status
deployment/scripts/dns.sh --env prod zone
```

`zone` finds the hosted zone Route 53 created, checks the registration points at it, and prints
the `dns_zone` line for `01-infra.tfvars`. If the zone was deleted and created again, the name
servers change; `zone` notices and offers to point the domain at the new zone.

`register` needs `route53domains:*` on the deploying identity, and the API lives only in
`us-east-1`; the script uses that region whatever `region` says.

Domains are never registered by Terraform: a registration cannot be deleted, and `destroy.sh`
must be able to remove everything it built.

## A domain you already own

On any cloud:

```bash
deployment/scripts/dns.sh --env prod zone
```

This creates the public zone when it is missing and prints its name servers. Set them at the
registrar of `DNS_DOMAIN`. For a subdomain whose parent zone lives elsewhere, add them as `NS`
records for the subdomain in the parent zone instead. `check` and `register` exist only on AWS; on
GCP and Azure, register the domain at any registrar and continue here.

## Checking delegation

```bash
deployment/scripts/dns.sh --env prod status
```

```
registered here        yes, expires 2027-09-26T14:45:19+00:00
hosted zone            Z0123456789ABC
public delegation      matches the zone; ready for setup.sh
```

`status` exits non-zero when the public name servers differ from the zone's. Run it before
`setup.sh`: with a stale delegation, the records are written into a zone nobody queries, and
cert-manager never gets a certificate. The doctor runs the same comparison.

## The contact file

`register` reads `dns-contact.json` from the environment directory. It is personal data: keep it
out of version control, as with the rest of the environment directory.

```json
{
  "first_name": "Asha",
  "last_name": "Rao",
  "organization": "Example Pvt Ltd",
  "email": "dns@eabc.com",
  "phone": "+xx.xxxxx",
  "address_line_1": "xxxx",
  "address_line_2": "",
  "city": "Bengaluru",
  "state": "KA",
  "postal_code": "xxxx",
  "country": "IN",
  "privacy": true
}
```

| Field | Required | Meaning |
|---|---|---|
| `first_name`, `last_name`, `email`, `address_line_1`, `city`, `postal_code` | yes | registrant, admin and technical contact |
| `phone` | yes | `+<country code>.<number>` |
| `country` | yes | two-letter code |
| `organization` | no | when set, the contact is registered as a company |
| `address_line_2` | no | |
| `state` | no, but some TLDs require it | the registry's code, not the name: `.in` accepts only the two-letter state code, `KA` for Karnataka, and rejects `Karnataka` |
| `privacy` | no (`true`) | hide the contact from WHOIS; set `false` for TLDs that reject privacy protection |

## DNS outside the cloud

Leave `dns_zone = ""`. `setup.sh` prints the records to create by hand, and on AWS LiveKit needs a
certificate you supply (`livekit_certificate_arn`). See
[ingress.md](ingress.md#addresses-and-dns-come-first).
