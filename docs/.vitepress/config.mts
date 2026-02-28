import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Shiphook",
  description:
    "Shiphook: webhook-triggered deploy runner. Receive a POST, run git pull, run your deploy script. Self-hosted, no SaaS. For indie devs and micro-SaaS.",
  base: "/shiphook/",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/" },
      { text: "Quick start", link: "/quick-start" },
      { text: "Configuration", link: "/config" },
      { text: "Webhooks", link: "/webhooks" },
      { text: "GitHub", link: "https://github.com/cap-jmk-real/shiphook" },
    ],
    sidebar: [
      { text: "Introduction", link: "/" },
      { text: "Quick start", link: "/quick-start" },
      { text: "Configuration", link: "/config" },
      { text: "Webhook setup", link: "/webhooks" },
      { text: "Publishing to npm", link: "/publishing" },
    ],
  },
  head: [
    [
      "meta",
      {
        name: "keywords",
        content:
          "shiphook, webhook, deploy, deployment, git pull, self-hosted, indie, micro-saas, automation, node",
      },
    ],
  ],
});
