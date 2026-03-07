import { defineConfig } from "vitepress";

export default defineConfig({
  title: "TAT Protocol",
  description:
    "Open infrastructure for token issuance, wallets, and access verification over Nostr.",
  cleanUrls: true,

  themeConfig: {
    siteTitle: "TAT Protocol",

    nav: [
      { text: "Learn", link: "/learn/what-is-tat" },
      { text: "Guides", link: "/guides/quickstart" },
      { text: "SDK Reference", link: "/sdk/packages" },
      { text: "Protocol Spec", link: "/spec/token-format" },
      {
        text: "GitHub",
        link: "https://github.com/nicbus/tat-protocol",
      },
    ],

    sidebar: {
      "/learn/": [
        {
          text: "Learn",
          items: [
            { text: "What is TAT Protocol?", link: "/learn/what-is-tat" },
            { text: "Core Concepts", link: "/learn/concepts" },
            { text: "Architecture", link: "/learn/architecture" },
            { text: "Glossary", link: "/learn/glossary" },
          ],
        },
      ],

      "/guides/": [
        {
          text: "Guides",
          items: [
            { text: "Quickstart", link: "/guides/quickstart" },
            { text: "Mint & Transfer Tokens", link: "/guides/mint-and-transfer" },
            { text: "Event Ticketing (TATs)", link: "/guides/event-ticketing" },
            { text: "Access Control with Gate", link: "/guides/access-control" },
            { text: "Commerce with Booth", link: "/guides/commerce" },
            { text: "Browser Integration", link: "/guides/browser" },
            { text: "Adoption & Rollout", link: "/guides/adoption" },
          ],
        },
      ],

      "/sdk/": [
        {
          text: "SDK Reference",
          items: [
            { text: "Package Overview", link: "/sdk/packages" },
            { text: "TDK (Unified SDK)", link: "/sdk/tdk" },
          ],
        },
        {
          text: "Issuer Plane",
          items: [
            { text: "Forge", link: "/sdk/forge" },
            { text: "Token", link: "/sdk/token" },
          ],
        },
        {
          text: "Holder Plane",
          items: [
            { text: "Pocket", link: "/sdk/pocket" },
            { text: "Storage", link: "/sdk/storage" },
          ],
        },
        {
          text: "Transport Plane",
          items: [
            { text: "NWPC", link: "/sdk/nwpc" },
            { text: "Signers", link: "/sdk/signers" },
          ],
        },
        {
          text: "Service Plane",
          items: [
            { text: "Gate", link: "/sdk/gate" },
            { text: "Booth", link: "/sdk/booth" },
          ],
        },
        {
          text: "Supporting",
          items: [
            { text: "HD Keys", link: "/sdk/hdkeys" },
            { text: "Types", link: "/sdk/types" },
            { text: "Utils", link: "/sdk/utils" },
            { text: "Config", link: "/sdk/config" },
          ],
        },
      ],

      "/spec/": [
        {
          text: "Protocol Specification",
          items: [
            { text: "Token Format", link: "/spec/token-format" },
            { text: "NWPC Protocol", link: "/spec/nwpc" },
            { text: "Cryptographic Primitives", link: "/spec/crypto" },
            { text: "Message Flows", link: "/spec/message-flows" },
            { text: "Error Codes", link: "/spec/error-codes" },
            { text: "Extensions", link: "/spec/extensions" },
            { text: "Security Model", link: "/spec/security" },
          ],
        },
      ],

      "/deployment/": [
        {
          text: "Deployment",
          items: [
            { text: "Security Best Practices", link: "/deployment/security" },
            { text: "Key Management", link: "/deployment/key-management" },
          ],
        },
      ],
    },

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/nicbus/tat-protocol",
      },
    ],

    search: {
      provider: "local",
    },

    footer: {
      message: "Released under the MIT License.",
    },
  },
});
