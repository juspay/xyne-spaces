output "identity_ids" {
  value = { for key, identity in azurerm_user_assigned_identity.this : key => identity.id }
}

output "client_ids" {
  value = { for key, identity in azurerm_user_assigned_identity.this : key => identity.client_id }
}

output "principal_ids" {
  value = { for key, identity in azurerm_user_assigned_identity.this : key => identity.principal_id }
}

output "identities" {
  value = {
    for key, identity in azurerm_user_assigned_identity.this : key => {
      annotations = {
        "azure.workload.identity/client-id" = identity.client_id
      }
      labels = {
        "azure.workload.identity/use" = "true"
      }
    }
  }
}
