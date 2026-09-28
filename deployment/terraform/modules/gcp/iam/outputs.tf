output "service_account_emails" {
  value = { for key, sa in google_service_account.this : key => sa.email }
}

output "identities" {
  value = {
    for key, sa in google_service_account.this : key => {
      annotations = {
        "iam.gke.io/gcp-service-account" = sa.email
      }
      labels = {}
    }
  }
}
