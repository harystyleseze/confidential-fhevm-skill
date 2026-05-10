import type { NextConfig } from "next";

/**
 * Canonical Next.js config for FHEVM dApps using @zama-fhe/react-sdk v3 +
 * wagmi + RainbowKit. This is the same shape the official `fhevm-react-template`
 * uses, plus the four mitigations every greenfield install needs:
 *
 *   1. `serverExternalPackages` for `@react-native-async-storage/async-storage`
 *      — MetaMask SDK references it on the server bundle path even though it's
 *      browser-only. Marking it external keeps the server build clean.
 *
 *   2. `webpack.resolve.alias["@react-native-async-storage/async-storage"] = false`
 *      — same module on the client bundle. `false` tells webpack "resolve to
 *      empty" instead of erroring with "Module not found".
 *
 *   3. `webpack.externals.push("pino-pretty", "lokijs", "encoding")` — common
 *      web3-stack optional Node-only deps that aren't on the browser path.
 *
 *   4. `webpack.ignoreWarnings` for ox/_esm/tempo and @metamask/sdk — these
 *      libraries do dynamic requires that webpack flags as
 *      "Critical dependency: the request of a dependency is an expression".
 *      Suppressing only those specific warnings prevents Next dev from
 *      promoting them into compile failures (which silently unmount the
 *      WagmiProvider and surface as `WagmiProviderNotFoundError`).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  serverExternalPackages: ["@react-native-async-storage/async-storage"],
  webpack: config => {
    config.externals.push("pino-pretty", "lokijs", "encoding");

    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@react-native-async-storage/async-storage": false,
    };

    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /ox\/_esm\/tempo/ },
      { module: /@metamask\/sdk/ },
    ];

    return config;
  },
};

const isIpfs = process.env.NEXT_PUBLIC_IPFS_BUILD === "true";
if (isIpfs) {
  nextConfig.output = "export";
  nextConfig.trailingSlash = true;
  nextConfig.images = { unoptimized: true };
}

module.exports = nextConfig;
