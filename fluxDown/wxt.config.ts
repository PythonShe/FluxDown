import { defineConfig } from "wxt";

export default defineConfig({
  zip: {
    excludeSources: ["*.zip", "*.html", "stats.html"],
  },
  manifest: ({ browser }) => ({
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    default_locale: "en",
    // Stable key to pin extension ID across dev/prod environments (Chrome/Edge only).
    // Firefox pins its ID via browser_specific_settings.gecko.id instead.
    // Including 'key' in Firefox manifests triggers an "unexpected property" warning.
    // Corresponding Chrome extension ID: cmkcgfjpfcjfadecjdecbdfncmligjde
    ...(browser !== 'firefox' ? {
      key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAthusdAyFznAD55LqD7BzOWG+xYhvE8oVLKaYvEN7mcM/EuPAAIezzPp8HysMgAafUMyOI7IEWRLq4M68CB7/vuh6IDRmO4KteKPegnzvbbn5v7S3Iwvjuhb/tupQt96sWIlIxz27wN+ANeMdZJD3Zf1tA+Zi2eTdBmymClz0xjk4WcJoiPAlwOeCnMR6F62wB0xULi4hBCXccVsvO/ctzA/dtUcvYVF8apJ0DPJfX783ddcP12EVUgSv47WE70rs1a3fAG5bXQFncIDoc2FrPN+t6zvVT87Zpmb+q51w5gGvsC4zeP8DgS6zDkn7VcC2w/nUY+R8olvEfumkZarP9QIDAQAB",
    } : {}),
    permissions: [
      "downloads",
      "cookies",
      "webRequest",
      "declarativeNetRequest",
      "storage",
      "notifications",
      "activeTab",
      "tabs",
      "scripting",
      "nativeMessaging",
    ],
    host_permissions: ["<all_urls>"],
    web_accessible_resources: [
      {
        resources: ["/fetch-interceptor.js"],
        matches: ["<all_urls>"],
      },
    ],
    action: {
      default_icon: {
        16: "/icon/16.png",
        32: "/icon/32.png",
        48: "/icon/48.png",
        128: "/icon/128.png",
      },
    },
    icons: {
      16: "/icon/16.png",
      32: "/icon/32.png",
      48: "/icon/48.png",
      128: "/icon/128.png",
    },
    browser_specific_settings: {
      gecko: {
        id: "fluxdown@fluxdown.app",
        strict_min_version: "140.0",
        // @ts-expect-error AMO requires data_collection_permissions since Nov 2025, WXT types not yet updated
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
  }),
});
