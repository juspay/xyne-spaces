locals {
  count               = var.enabled ? 1 : 0
  public_ip_count     = var.enabled && var.public_ip_enabled ? 1 : 0
  azure_bastion_count = var.enabled && var.azure_bastion_enabled ? 1 : 0
}

resource "azurerm_public_ip" "vm" {
  count = local.public_ip_count

  name                = "${var.name}-bastion"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = var.zone != "" ? [var.zone] : null

  tags = var.tags
}

resource "azurerm_network_interface" "this" {
  count = local.count

  name                = "${var.name}-bastion"
  location            = var.location
  resource_group_name = var.resource_group_name

  ip_configuration {
    name                          = "primary"
    subnet_id                     = var.subnet_id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = var.public_ip_enabled ? azurerm_public_ip.vm[0].id : null
  }

  tags = var.tags
}

resource "azurerm_linux_virtual_machine" "this" {
  count = local.count

  name                            = "${var.name}-bastion"
  location                        = var.location
  resource_group_name             = var.resource_group_name
  size                            = var.vm_size
  zone                            = var.zone != "" ? var.zone : null
  admin_username                  = var.admin_username
  disable_password_authentication = true
  network_interface_ids           = [azurerm_network_interface.this[0].id]
  custom_data                     = base64encode(file("${path.module}/templates/cloud-init.yaml"))

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.ssh_public_key
  }

  identity {
    type = "SystemAssigned"
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = var.disk_size_gb
  }

  source_image_reference {
    publisher = var.vm_image.publisher
    offer     = var.vm_image.offer
    sku       = var.vm_image.sku
    version   = var.vm_image.version
  }

  boot_diagnostics {}

  tags = var.tags

  lifecycle {
    ignore_changes = [source_image_reference[0].version, custom_data]

    precondition {
      condition     = var.ssh_public_key != ""
      error_message = "ssh_public_key is required when bastion_enabled is true; Azure Linux virtual machines need an SSH public key at creation even though sign-in goes through the AADSSHLoginForLinux extension."
    }

    precondition {
      condition     = !var.azure_bastion_enabled || var.azure_bastion_subnet_id != ""
      error_message = "azure_bastion_subnet_id is required when azure_bastion_enabled is true."
    }
  }
}

resource "azurerm_virtual_machine_extension" "aad_ssh" {
  count = local.count

  name                       = "AADSSHLoginForLinux"
  virtual_machine_id         = azurerm_linux_virtual_machine.this[0].id
  publisher                  = "Microsoft.Azure.ActiveDirectory"
  type                       = "AADSSHLoginForLinux"
  type_handler_version       = "1.0"
  auto_upgrade_minor_version = true

  tags = var.tags
}

resource "azurerm_public_ip" "azure_bastion" {
  count = local.azure_bastion_count

  name                = "${var.name}-azure-bastion"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = var.tags
}

resource "azurerm_bastion_host" "this" {
  count = local.azure_bastion_count

  name                = "${var.name}-azure-bastion"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = var.azure_bastion_sku
  tunneling_enabled   = var.azure_bastion_sku != "Basic" ? true : null

  ip_configuration {
    name                 = "primary"
    subnet_id            = var.azure_bastion_subnet_id
    public_ip_address_id = azurerm_public_ip.azure_bastion[0].id
  }

  tags = var.tags
}
