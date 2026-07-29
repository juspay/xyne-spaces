import type { StdioMcpAdapter } from "../types.js";

export const shopifyAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "shopify",
  healthCheck: { name: "get-products", params: { limit: 1 } },
  writeTools: [
    "create-product", "update-product", "delete-product",
    "manage-product-variants", "delete-product-variants", "manage-product-options",
    "create-order", "update-order", "cancel-order",
    "create-customer", "update-customer",
    "create-discount", "update-discount",
  ],
  credentialFields: [
    { name: "accessToken", label: "Admin API Access Token", type: "password", placeholder: "shpat_xxxxxxxxxxxxxxxxxxxx" },
    { name: "domain", label: "Myshopify Domain", type: "text", placeholder: "your-store.myshopify.com" },
  ],
  buildCommand(credentials) {
    const accessToken = credentials["accessToken"] as string;
    const domain = credentials["domain"] as string;

    return {
      cmd: "npx",
      args: [
        "-y", "shopify-mcp@1.0.8",
        `--accessToken=${accessToken}`,
        `--domain=${domain}`,
      ],
      env: {},
    };
  },
};
