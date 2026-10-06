// Font definitions shared by components (next/font hosts each font once).
import { Noto_Nastaliq_Urdu } from "next/font/google";

/** Urdu in Nastaliq for the public screens. Not preloaded: only Urdu pages download it. */
export const urduFont = Noto_Nastaliq_Urdu({ subsets: ["arabic"], variable: "--font-urdu", display: "swap", preload: false });
