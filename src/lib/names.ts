// Normalises Pakistani names so spelling variants match (Muhammad/Mohammad, Umer/Umar ...).
const TITLES = /\b(dr|prof|professor|mr|mrs|ms|miss|engr|syed|sayed|hafiz|haji)\.?\b/g;

const VARIANTS: Record<string, string> = {
  mohammad: "muhammad",
  mohammed: "muhammad",
  muhammed: "muhammad",
  muhamad: "muhammad",
  mohd: "muhammad",
  muhd: "muhammad",
  md: "muhammad",
  ahmad: "ahmed",
  umer: "umar",
  omer: "umar",
  omar: "umar",
  yousaf: "yousuf",
  yusuf: "yousuf",
  yousef: "yousuf",
  usman: "usman",
  osman: "usman",
  hussain: "hussain",
  husain: "hussain",
  hussein: "hussain",
  hassan: "hassan",
  hasan: "hassan",
  ayesha: "ayesha",
  aisha: "ayesha",
  fatima: "fatima",
  fatimah: "fatima",
  zainab: "zainab",
  zaynab: "zainab",
  iqbal: "iqbal",
  ikbal: "iqbal",
  ali: "ali",
  aly: "ali",
  khurram: "khurram",
  qureshi: "qureshi",
  qurashi: "qureshi",
  kureshi: "qureshi",
};

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(TITLES, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => VARIANTS[w] ?? w)
    .join(" ")
    .trim();
}

export function normalizeCnic(cnic: string): string | null {
  const digits = cnic.replace(/\D/g, "");
  if (digits.length !== 13) return null;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

export function maskCnic(cnic: string): string {
  return `${cnic.slice(0, 5)}-XXXXXXX-${cnic.slice(-1)}`;
}
