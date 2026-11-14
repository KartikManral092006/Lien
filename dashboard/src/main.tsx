import "@rainbow-me/rainbowkit/styles.css";
import "./styles.css";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import * as Tooltip from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { WagmiProvider } from "wagmi";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SmoothScroll } from "./components/SmoothScroll";
import { wagmiConfig } from "./lib/wallet";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } },
});

const walletTheme = darkTheme({ accentColor: "#EEF2F8", accentColorForeground: "#070A13", borderRadius: "none", fontStack: "system", overlayBlur: "small" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={walletTheme} modalSize="compact" appInfo={{ appName: "Lien" }}>
            <MotionConfig reducedMotion="user">
              <Tooltip.Provider>
                <SmoothScroll>
                  <App />
                </SmoothScroll>
              </Tooltip.Provider>
            </MotionConfig>
            <Toaster position="bottom-right" theme="dark" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-sans)" } }} />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  </StrictMode>,
);
