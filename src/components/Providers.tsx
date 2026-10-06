"use client";
import { App, ConfigProvider } from "antd";

const FONT = "var(--font-inter), system-ui, -apple-system, 'Segoe UI', sans-serif";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#0b6e4f",
          colorLink: "#0b6e4f",
          colorSuccess: "#12a150",
          colorWarning: "#d48806",
          colorError: "#cf1322",
          colorInfo: "#2a78d6",
          colorText: "#0f1f1a",
          colorTextSecondary: "#5b6b64",
          colorTextTertiary: "#8a9892",
          colorBorder: "#d6ddd9",
          colorBorderSecondary: "#e8ecea",
          colorBgLayout: "#f4f6f5",
          borderRadius: 8,
          borderRadiusLG: 14,
          borderRadiusSM: 6,
          fontFamily: FONT,
          fontSize: 14,
          controlHeight: 36,
          controlHeightLG: 44,
          boxShadowTertiary: "0 1px 2px rgba(16,40,30,0.05)",
        },
        components: {
          Layout: { headerBg: "#ffffff", siderBg: "#0a3d2e", bodyBg: "#f4f6f5" },
          Menu: {
            darkItemBg: "transparent",
            darkSubMenuItemBg: "transparent",
            darkItemSelectedBg: "rgba(255,255,255,0.12)",
            darkItemColor: "rgba(255,255,255,0.72)",
            darkItemHoverColor: "#ffffff",
            darkItemHoverBg: "rgba(255,255,255,0.06)",
            darkItemSelectedColor: "#ffffff",
            darkGroupTitleColor: "rgba(255,255,255,0.42)",
            itemHeight: 38,
            iconSize: 16,
          },
          Card: { headerFontSize: 15, headerFontSizeSM: 14, paddingLG: 20 },
          Table: { headerBg: "#f8faf9", headerColor: "#5b6b64", rowHoverBg: "#f4f9f6", borderColor: "#eef2f0", headerSplitColor: "transparent", cellPaddingBlockSM: 10 },
          Button: { primaryShadow: "none", defaultShadow: "none", dangerShadow: "none", fontWeight: 500 },
          Tag: { defaultBg: "#f3f5f4" },
          Segmented: { itemSelectedBg: "#ffffff", trackBg: "#e9eeeb" },
          Tabs: { titleFontSize: 14 },
          Drawer: { paddingLG: 24 },
          Alert: { borderRadiusLG: 12 },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
