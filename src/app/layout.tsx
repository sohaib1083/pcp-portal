import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import Providers from "@/components/Providers";
import DemoGuide from "@/components/DemoGuide";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "PCP Digital Portal", template: "%s · PCP Digital Portal" },
  description: "Pharmacy Council of Pakistan digitalization demo: institutions, faculty, students, NOC workflow, inspections and verification.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AntdRegistry>
          <Providers>
            {children}
            {process.env.DEMO_MODE === "1" ? <DemoGuide /> : null}
          </Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
