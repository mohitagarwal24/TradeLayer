// "use client";

// import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
// import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// import { useTheme } from "next-themes";
// import { WagmiProvider } from "wagmi";
// import { wagmiConfig } from "~~/services/web3/wagmiConfig";

// const queryClient = new QueryClient();

// export const ScaffoldEthAppWithProviders = ({ children }: { children: React.ReactNode }) => {
//   const { resolvedTheme } = useTheme();
//   const isDarkMode = resolvedTheme === "dark";

//   return (
//     <WagmiProvider config={wagmiConfig}>
//       <QueryClientProvider client={queryClient}>
//         <RainbowKitProvider theme={isDarkMode ? darkTheme() : lightTheme()}>
//           {/* {children}
//         </RainbowKitProvider>
//       </QueryClientProvider>
//     </WagmiProvider>
//   );
// }; */}