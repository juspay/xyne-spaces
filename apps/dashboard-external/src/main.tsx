import ReactDOM from "react-dom/client";
import "./global.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { HttpClientProvider } from "@xyne/shared/hooks";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { queryClient } from "./services/clients/queryClient";
import { publicHttpClient } from "./services/clients/publicHttpClient";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <HttpClientProvider client={publicHttpClient}>
      <TooltipProvider delayDuration={0}>
        <App />
      </TooltipProvider>
    </HttpClientProvider>
  </QueryClientProvider>,
);
