import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Shiphook",
  description: "Ship on hook — receive a webhook, pull latest, run your deploy script.",
  base: "/shiphook/",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/" },
      { text: "Configuration", link: "/config" },
      { text: "GitHub", link: "https://github.com/cap-jmk-real/shiphook" },
    ],
    sidebar: [
      { text: "Introduction", link: "/" },
      { text: "Quick start", link: "/quick-start" },
      { text: "Configuration", link: "/config" },
      { text: "Webhook setup", link: "/webhooks" },
    ],
  },
});
