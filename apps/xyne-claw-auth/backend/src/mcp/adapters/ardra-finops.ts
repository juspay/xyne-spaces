import type { HttpMcpAdapter } from "../types.js";

export const ardraFinopsAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "ardra-finops",
  healthCheck: { name: "fetchPolicies", params: {} },
  writeTools: ["createManualReimbursement"],
  credentialFields: [
    {
      name: "url",
      label: "Expense MCP URL",
      type: "text",
      placeholder: "https://expense-mcp.example.com",
    },
    {
      name: "juzpayBizId",
      label: "JuzPay Biz ID",
      type: "password",
      placeholder: "Your JuzPay Biz ID",
    },
  ],
  buildHttpUrl(credentials) {
    const baseUrl = (credentials["url"] as string).replace(/\/+$/, "");
    const juzpayBizId = credentials["juzpayBizId"] as string;
    const authToken = Buffer.from(juzpayBizId).toString("base64");
    return {
      url: `${baseUrl}/mcp`,
      headers: {
        "Authorization": `Basic ${authToken}`,
        "ngrok-skip-browser-warning": "true",
      },
    };
  },
};

