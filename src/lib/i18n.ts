// English and Urdu labels for the public screens (guide section 14: "English and Urdu labels on public screens").
// Labels and headings switch language; data (names, numbers, dates, IDs) stays as it is.
// Pure: safe in client components. The chosen language lives in the `pcp_lang` cookie (see i18n-server.ts).

export type Lang = "en" | "ur";
export const LANG_COOKIE = "pcp_lang";
export const parseLang = (v: string | null | undefined): Lang => (v === "ur" ? "ur" : "en");

const D = {
  // ---------- Public header and footer ----------
  "nav.brand": { en: "PCP Digital Portal", ur: "پی سی پی ڈیجیٹل پورٹل" },
  "nav.sub": { en: "Pharmacy Council of Pakistan · demo", ur: "فارمیسی کونسل آف پاکستان · ڈیمو" },
  "nav.verify": { en: "Verify", ur: "تصدیق" },
  "nav.signIn": { en: "Sign in", ur: "سائن اِن" },
  "nav.dashboard": { en: "My dashboard", ur: "میرا ڈیش بورڈ" },
  "nav.register": { en: "Register your institution", ur: "اپنا ادارہ رجسٹر کریں" },
  "nav.help": { en: "Help and complaints", ur: "مدد اور شکایات" },
  "lang.switch": { en: "اردو", ur: "English" },
  "lang.switchLabel": { en: "اردو میں دیکھیں (View in Urdu)", ur: "View in English (انگریزی میں دیکھیں)" },
  "foot.demo": { en: "PCP Digital Portal · working demo with fictional institutions, people and payments", ur: "پی سی پی ڈیجیٹل پورٹل · فرضی اداروں، افراد اور ادائیگیوں کے ساتھ ایک ورکنگ ڈیمو" },
  "foot.official": { en: "Not an official Pharmacy Council of Pakistan website · no SMS or email is sent", ur: "یہ فارمیسی کونسل آف پاکستان کی سرکاری ویب سائٹ نہیں · کوئی ایس ایم ایس یا ای میل نہیں بھیجی جاتی" },
  "foot.privacy": { en: "Privacy notice", ur: "رازداری کا نوٹس" },

  // ---------- Home ----------
  "home.kicker": { en: "The four promised e-services, live on one platform", ur: "چاروں وعدہ شدہ ای سروسز، ایک ہی پلیٹ فارم پر فعال" },
  "home.h1": { en: "One registry for pharmacy education in Pakistan", ur: "پاکستان میں فارمیسی تعلیم کے لیے ایک رجسٹری" },
  "home.lead": {
    en: "Institutions apply for NOCs and accreditation online. PCP scrutinises, inspects and decides in one tracked workflow. Anyone can verify an institution or a certificate.",
    ur: "ادارے این او سی اور ایکریڈیٹیشن کے لیے آن لائن درخواست دیتے ہیں۔ پی سی پی ایک ہی ٹریک شدہ عمل میں جانچ، معائنہ اور فیصلہ کرتی ہے۔ کوئی بھی شخص کسی ادارے یا سرٹیفکیٹ کی تصدیق کر سکتا ہے۔",
  },
  "home.searchPlaceholder": { en: "Verify an institution: name or PCP ID (e.g. PCP-UNI-000101)", ur: "ادارے کی تصدیق کریں: نام یا پی سی پی آئی ڈی، مثلاً PCP-UNI-000101" },
  "home.searchLabel": { en: "Institution name or PCP ID", ur: "ادارے کا نام یا پی سی پی آئی ڈی" },
  "home.verifyButton": { en: "Verify", ur: "تصدیق کریں" },
  "home.try": { en: "Try", ur: "آزمائیں:" },
  "home.or": { en: "or", ur: "یا" },
  "home.registerCta": { en: "Register your institution", ur: "اپنا ادارہ رجسٹر کریں" },
  "home.registerHint": { en: "New college or university? Apply for your PCP Institution ID online.", ur: "نیا کالج یا یونیورسٹی؟ اپنی پی سی پی انسٹی ٹیوشن آئی ڈی کے لیے آن لائن درخواست دیں۔" },
  "home.stat.institutions": { en: "Institutions on the registry", ur: "رجسٹری میں شامل ادارے" },
  "home.stat.programs": { en: "Programs with an approved NOC", ur: "منظور شدہ این او سی والے پروگرام" },
  "home.stat.faculty": { en: "Faculty with a PCP ID", ur: "پی سی پی آئی ڈی والے اساتذہ" },
  "home.stat.certificates": { en: "Certificates issued online", ur: "آن لائن جاری کردہ سرٹیفکیٹ" },
  "home.services.eyebrow": { en: "What institutions get", ur: "اداروں کو کیا ملتا ہے" },
  "home.services.h2": { en: "Every e-service PCP announced, in one place", ur: "پی سی پی کی اعلان کردہ ہر ای سروس، ایک جگہ پر" },
  "home.services.sub": { en: "Enter faculty and students once and reuse them for NOC, accreditation, renewal and verification.", ur: "اساتذہ اور طلبہ کا اندراج ایک بار کریں اور اسے این او سی، ایکریڈیٹیشن، تجدید اور تصدیق کے لیے دوبارہ استعمال کریں۔" },
  "svc.accreditation.t": { en: "Institute accreditation", ur: "ادارے کی ایکریڈیٹیشن" },
  "svc.accreditation.b": { en: "NOC, accreditation and renewal applications with automatic checks, formal deficiencies and tracked deadlines.", ur: "این او سی، ایکریڈیٹیشن اور تجدید کی درخواستیں، خودکار جانچ، باضابطہ کمیوں کی نشاندہی اور مقررہ آخری تاریخوں کے ساتھ۔" },
  "svc.students.t": { en: "Student enrolment verification", ur: "طلبہ کے داخلے کی تصدیق" },
  "svc.students.b": { en: "Every student gets one PCP ID. Enrolment is compared with approved intake every year, and past years lock.", ur: "ہر طالب علم کو ایک پی سی پی آئی ڈی ملتی ہے۔ ہر سال داخلے کا منظور شدہ نشستوں سے موازنہ ہوتا ہے، اور گزشتہ سال مقفل ہو جاتے ہیں۔" },
  "svc.faculty.t": { en: "Faculty verification", ur: "اساتذہ کی تصدیق" },
  "svc.faculty.b": { en: "One record per CNIC, active at one institution at a time. Near-duplicate names are flagged for PCP.", ur: "ہر شناختی کارڈ پر ایک ریکارڈ، جو ایک وقت میں صرف ایک ادارے میں فعال ہو۔ ملتے جلتے ناموں کی نشاندہی پی سی پی کو کی جاتی ہے۔" },
  "svc.payments.t": { en: "Online forms & challans", ur: "آن لائن فارم اور چالان" },
  "svc.payments.b": { en: "PSID challans and Raast QR payments, confirmed by the bank. No paper challans, no manual reconciliation.", ur: "پی ایس آئی ڈی چالان اور راست کیو آر ادائیگیاں، جن کی تصدیق بینک کرتا ہے۔ نہ کاغذی چالان، نہ دستی مطابقت۔" },
  "svc.pharmacist.tag": { en: "Public service", ur: "عوامی سروس" },
  "svc.pharmacist.t": { en: "Pharmacist registration check", ur: "فارماسسٹ رجسٹریشن کی جانچ" },
  "svc.pharmacist.b": {
    en: "Anyone can check that a pharmacist is registered with a provincial pharmacy council. Enter the registration number from their card to see name, category, status and validity. CNIC, phone and address are never shown.",
    ur: "کوئی بھی شخص جانچ سکتا ہے کہ فارماسسٹ کسی صوبائی فارمیسی کونسل میں رجسٹرڈ ہے یا نہیں۔ کارڈ پر درج رجسٹریشن نمبر لکھیں اور نام، کیٹیگری، حیثیت اور مدتِ استناد دیکھیں۔ شناختی کارڈ نمبر، فون اور پتہ کبھی ظاہر نہیں کیے جاتے۔",
  },
  "svc.pharmacist.cta": { en: "Check a pharmacist", ur: "فارماسسٹ کی جانچ کریں" },
  "home.flow.eyebrow": { en: "How a NOC moves", ur: "این او سی کا سفر" },
  "home.flow.h2": { en: "From application to verified certificate", ur: "درخواست سے تصدیق شدہ سرٹیفکیٹ تک" },
  "home.flow.sub": { en: "Every step has an owner and a deadline, and the institution always sees who holds its file.", ur: "ہر مرحلے کا ایک ذمہ دار اور ایک آخری تاریخ ہوتی ہے، اور ادارہ ہمیشہ دیکھ سکتا ہے کہ اس کی فائل کس کے پاس ہے۔" },
  "flow.1.t": { en: "Apply online", ur: "آن لائن درخواست" },
  "flow.1.b": { en: "Institution enters campus, intake, labs and library once", ur: "ادارہ کیمپس، نشستیں، لیبارٹریاں اور لائبریری ایک بار درج کرتا ہے" },
  "flow.2.t": { en: "Automatic checks", ur: "خودکار جانچ" },
  "flow.2.b": { en: "PCP's rules run instantly: faculty, intake, documents", ur: "پی سی پی کے قواعد فوراً لاگو ہوتے ہیں: اساتذہ، نشستیں، دستاویزات" },
  "flow.3.t": { en: "Pay by Raast", ur: "راست سے ادائیگی" },
  "flow.3.b": { en: "PSID challan and QR, confirmed by the bank", ur: "پی ایس آئی ڈی چالان اور کیو آر، بینک سے تصدیق شدہ" },
  "flow.4.t": { en: "Scrutiny", ur: "جانچ پڑتال" },
  "flow.4.b": { en: "Formal deficiencies with deadlines and evidence", ur: "آخری تاریخ اور ثبوت کے ساتھ باضابطہ کمیاں" },
  "flow.5.t": { en: "Inspection", ur: "معائنہ" },
  "flow.5.b": { en: "Checklist on a tablet, conflict of interest blocked", ur: "ٹیبلٹ پر چیک لسٹ، مفادات کے ٹکراؤ کی روک تھام" },
  "flow.6.t": { en: "Council & certificate", ur: "کونسل اور سرٹیفکیٹ" },
  "flow.6.b": { en: "Recorded decision, QR-verifiable NOC", ur: "ریکارڈ شدہ فیصلہ، کیو آر سے قابلِ تصدیق این او سی" },
  "home.trust.eyebrow": { en: "Built for trust", ur: "اعتماد کے لیے تیار" },
  "home.trust.h2": { en: "Records the National Assembly can rely on", ur: "ایسا ریکارڈ جس پر قومی اسمبلی بھروسہ کر سکے" },
  "home.trust.sub": { en: "Duplicate checks, an audit trail and public verification are built in from day one.", ur: "دہرے اندراج کی جانچ، آڈٹ ٹریل اور عوامی تصدیق پہلے دن سے شامل ہیں۔" },
  "home.trust.dashboard": { en: "Go to my dashboard", ur: "میرے ڈیش بورڈ پر جائیں" },
  "home.trust.explore": { en: "Explore the portal", ur: "پورٹل دیکھیں" },
  "trust.cnic.t": { en: "CNIC as the key", ur: "شناختی کارڈ بنیادی کلید" },
  "trust.cnic.b": { en: "NADRA-ready identity checks stop one teacher being counted at two colleges.", ur: "نادرا سے منسلک ہونے کے قابل شناختی جانچ ایک استاد کو دو کالجوں میں شمار ہونے سے روکتی ہے۔" },
  "trust.log.t": { en: "Tamper-evident log", ur: "چھیڑ چھاڑ ظاہر کرنے والا ریکارڈ" },
  "trust.log.b": { en: "Every action is hash-chained. Editing history breaks the chain visibly.", ur: "ہر کارروائی ہیش چین سے جڑی ہے۔ ریکارڈ میں تبدیلی سے یہ زنجیر واضح طور پر ٹوٹ جاتی ہے۔" },
  "trust.qr.t": { en: "QR-verified certificates", ur: "کیو آر سے تصدیق شدہ سرٹیفکیٹ" },
  "trust.qr.b": { en: "Anyone can confirm a NOC is genuine by scanning it, in seconds.", ur: "کوئی بھی شخص اسکین کر کے چند سیکنڈ میں این او سی کے اصلی ہونے کی تصدیق کر سکتا ہے۔" },
  "trust.data.t": { en: "Data stays in Pakistan", ur: "ڈیٹا پاکستان ہی میں رہتا ہے" },
  "trust.data.b": { en: "Single sign-on with Keycloak, MFA for staff, hosted under the Cloud First Policy.", ur: "کی کلوک کے ذریعے سنگل سائن اِن، عملے کے لیے ملٹی فیکٹر تصدیق، اور کلاؤڈ فرسٹ پالیسی کے تحت ہوسٹنگ۔" },
  "visual.blocked": { en: "CNIC active elsewhere: blocked", ur: "شناختی کارڈ کسی اور جگہ فعال: روک دیا گیا" },
  "visual.paid": { en: "Raast payment confirmed", ur: "راست ادائیگی کی تصدیق ہو گئی" },
  "visual.scan": { en: "Scan to verify", ur: "تصدیق کے لیے اسکین کریں" },
  "visual.scanSub": { en: "QR + SHA-256 fingerprint. Anyone can check it, without signing in.", ur: "کیو آر اور SHA-256 فنگر پرنٹ۔ کوئی بھی سائن اِن کیے بغیر جانچ سکتا ہے۔" },

  // ---------- /verify ----------
  "verify.title": { en: "Public verification", ur: "عوامی تصدیق" },
  "verify.sub": {
    en: "Check an institution's approved programs and accreditation, or confirm that a PCP certificate is genuine. Only the fields PCP's draft allows are shown.",
    ur: "کسی ادارے کے منظور شدہ پروگرام اور ایکریڈیٹیشن دیکھیں، یا تصدیق کریں کہ پی سی پی کا سرٹیفکیٹ اصلی ہے۔ صرف وہی معلومات دکھائی جاتی ہیں جن کی پی سی پی کا مسودہ اجازت دیتا ہے۔",
  },
  "verify.tab.institution": { en: "Institution", ur: "ادارہ" },
  "verify.tab.certificate": { en: "Certificate", ur: "سرٹیفکیٹ" },
  "verify.tab.pharmacist": { en: "Pharmacist", ur: "فارماسسٹ" },
  "verify.button": { en: "Verify", ur: "تصدیق کریں" },
  "verify.inst.placeholder": { en: "Institution name or PCP ID, e.g. Riverside or PCP-UNI-000101", ur: "ادارے کا نام یا پی سی پی آئی ڈی، مثلاً Riverside یا PCP-UNI-000101" },
  "verify.inst.empty": { en: "No institution found. It may not be registered with PCP.", ur: "کوئی ادارہ نہیں ملا۔ ممکن ہے یہ پی سی پی میں رجسٹرڈ نہ ہو۔" },
  "verify.inst.status": { en: "Institution status", ur: "ادارے کی حیثیت" },
  "verify.inst.noc": { en: "NOC", ur: "این او سی" },
  "verify.inst.acc": { en: "Accreditation", ur: "ایکریڈیٹیشن" },
  "verify.validUntil": { en: "Valid until", ur: "مؤثر تا" },
  "verify.inst.noPrograms": { en: "No approved programs yet.", ur: "ابھی تک کوئی منظور شدہ پروگرام نہیں۔" },
  "verify.cert.intro": { en: "Scan the QR code on a PCP certificate, or type its number.", ur: "پی سی پی سرٹیفکیٹ پر موجود کیو آر کوڈ اسکین کریں، یا اس کا نمبر درج کریں۔" },
  "verify.cert.placeholder": { en: "e.g. NOC-PHARMD-2005-0011", ur: "مثلاً NOC-PHARMD-2005-0011" },
  "verify.cert.check": { en: "Check", ur: "جانچیں" },

  // Pharmacist check
  "ph.intro": {
    en: "Enter the registration number printed on the pharmacist's card. PCP keeps an index of the provincial pharmacy councils' registers under agreement; the councils issue and renew registrations.",
    ur: "فارماسسٹ کے کارڈ پر درج رجسٹریشن نمبر لکھیں۔ پی سی پی معاہدے کے تحت صوبائی فارمیسی کونسلوں کے رجسٹروں کا اشاریہ رکھتی ہے؛ رجسٹریشن کا اجرا اور تجدید کونسلیں کرتی ہیں۔",
  },
  "ph.placeholder": { en: "Registration number", ur: "رجسٹریشن نمبر" },
  "ph.privacy": {
    en: "Shows name, number, category, status and validity only. CNIC, phone, email, home address and practice place are never shown.",
    ur: "صرف نام، نمبر، کیٹیگری، حیثیت اور مدتِ استناد دکھائی جاتی ہے۔ شناختی کارڈ نمبر، فون، ای میل، گھر کا پتہ اور جائے ملازمت کبھی ظاہر نہیں کیے جاتے۔",
  },
  "ph.formats": { en: "Number formats", ur: "نمبر کی شکل" },
  "ph.head.ACTIVE": { en: "Registered pharmacist: active", ur: "رجسٹرڈ فارماسسٹ: فعال" },
  "ph.head.LAPSED": { en: "Registration period ended", ur: "رجسٹریشن کی مدت ختم" },
  "ph.head.DORMANT": { en: "Registration dormant", ur: "رجسٹریشن غیر فعال (ڈورمنٹ)" },
  "ph.head.SUSPENDED": { en: "Registration suspended", ur: "رجسٹریشن معطل" },
  "ph.head.CANCELLED": { en: "Registration cancelled", ur: "رجسٹریشن منسوخ" },
  "ph.head.NONE": { en: "Not on the register", ur: "رجسٹر میں موجود نہیں" },
  "ph.say.ACTIVE": { en: "This registration is active and valid until {date}. The pharmacist is registered with the {council}.", ur: "یہ رجسٹریشن فعال ہے اور {date} تک مؤثر ہے۔ فارماسسٹ {council} میں رجسٹرڈ ہے۔" },
  "ph.say.ACTIVE_OPEN": { en: "This registration is active. The pharmacist is registered with the {council}.", ur: "یہ رجسٹریشن فعال ہے۔ فارماسسٹ {council} میں رجسٹرڈ ہے۔" },
  "ph.say.LAPSED": { en: "The validity of this registration ended on {date}. The pharmacist may not practise until it is renewed with the {council}.", ur: "اس رجسٹریشن کی مدت {date} کو ختم ہو گئی۔ {council} سے تجدید ہونے تک فارماسسٹ پریکٹس نہیں کر سکتا۔" },
  "ph.say.DORMANT": { en: "This registration is dormant. The pharmacist may not practise until it is renewed with the {council}.", ur: "یہ رجسٹریشن غیر فعال (ڈورمنٹ) ہے۔ {council} سے تجدید ہونے تک فارماسسٹ پریکٹس نہیں کر سکتا۔" },
  "ph.say.SUSPENDED": { en: "This registration is suspended. The pharmacist may not practise while the suspension lasts. The {council} can tell you more.", ur: "یہ رجسٹریشن معطل ہے۔ معطلی کے دوران فارماسسٹ پریکٹس نہیں کر سکتا۔ مزید معلومات {council} سے حاصل کریں۔" },
  "ph.say.CANCELLED": { en: "This registration is cancelled. The person is no longer a registered pharmacist and may not practise. It was issued by the {council}.", ur: "یہ رجسٹریشن منسوخ ہو چکی ہے۔ یہ شخص اب رجسٹرڈ فارماسسٹ نہیں اور پریکٹس نہیں کر سکتا۔ یہ رجسٹریشن {council} نے جاری کی تھی۔" },
  "ph.say.NONE": {
    en: "No pharmacist with this number is on the register. Check the number on the registration card. If it is right, ask the provincial council that issued it, and report a suspected fake to PCP.",
    ur: "اس نمبر والا کوئی فارماسسٹ رجسٹر میں موجود نہیں۔ رجسٹریشن کارڈ پر نمبر دوبارہ دیکھیں۔ اگر نمبر درست ہے تو جاری کرنے والی صوبائی کونسل سے پوچھیں، اور جعلی ہونے کا شبہ ہو تو پی سی پی کو اطلاع دیں۔",
  },
  "ph.say.BADFORMAT": {
    en: "This does not look like a registration number. A number starts with the council's code, for example PPC-A-031457 (Punjab) or SPC-A-2019-00412 (Sindh).",
    ur: "یہ رجسٹریشن نمبر کی درست شکل نہیں۔ نمبر کونسل کے کوڈ سے شروع ہوتا ہے، مثلاً PPC-A-031457 (پنجاب) یا SPC-A-2019-00412 (سندھ)۔",
  },
  "ph.name": { en: "Name", ur: "نام" },
  "ph.regNo": { en: "Registration number", ur: "رجسٹریشن نمبر" },
  "ph.category": { en: "Category", ur: "کیٹیگری" },
  "ph.status": { en: "Status", ur: "حیثیت" },
  "ph.validUntil": { en: "Valid until", ur: "مؤثر تا" },
  "ph.noExpiry": { en: "No end date on the council's file", ur: "کونسل کے ریکارڈ میں اختتامی تاریخ درج نہیں" },
  "ph.checked": { en: "Checked {time} against PCP's index of the provincial registers. The council's own register is the final authority.", ur: "پی سی پی کے صوبائی رجسٹروں کے اشاریے سے {time} پر جانچا گیا۔ حتمی اختیار کونسل کے اپنے رجسٹر کو حاصل ہے۔" },
  "ph.report": { en: "Report a concern to PCP", ur: "پی سی پی کو شکایت درج کرائیں" },
  "ph.cat.A": { en: "Category A · Pharm-D", ur: "کیٹیگری اے · فارم ڈی" },
  "ph.cat.B": { en: "Category B · Pharmacy Technician", ur: "کیٹیگری بی · فارمیسی ٹیکنیشن" },

  // Council names
  "council.Punjab": { en: "Punjab Pharmacy Council", ur: "پنجاب فارمیسی کونسل" },
  "council.Sindh": { en: "Sindh Pharmacy Council", ur: "سندھ فارمیسی کونسل" },
  "council.Khyber Pakhtunkhwa": { en: "Khyber Pakhtunkhwa Pharmacy Council", ur: "خیبر پختونخوا فارمیسی کونسل" },
  "council.Balochistan": { en: "Balochistan Pharmacy Council", ur: "بلوچستان فارمیسی کونسل" },
  "council.Gilgit-Baltistan": { en: "Gilgit-Baltistan Pharmacy Council", ur: "گلگت بلتستان فارمیسی کونسل" },

  // Status pills (public screens)
  "st.ACTIVE": { en: "Active", ur: "فعال" },
  "st.DORMANT": { en: "Dormant", ur: "غیر فعال" },
  "st.SUSPENDED": { en: "Suspended", ur: "معطل" },
  "st.CANCELLED": { en: "Cancelled", ur: "منسوخ" },
  "st.APPROVED": { en: "Approved", ur: "منظور شدہ" },
  "st.PENDING": { en: "Pending", ur: "زیرِ غور" },
  "st.REJECTED": { en: "Rejected", ur: "مسترد" },
  "st.NONE": { en: "None", ur: "کوئی نہیں" },
  "st.VALID": { en: "Valid", ur: "مؤثر" },
  "st.EXPIRED": { en: "Expired", ur: "میعاد ختم" },
  "prog.PHARMD": { en: "PharmD", ur: "فارم ڈی" },
  "prog.TECH": { en: "Pharmacy Technician", ur: "فارمیسی ٹیکنیشن" },

  // ---------- Certificate check ----------
  "cert.title": { en: "Certificate check", ur: "سرٹیفکیٹ کی جانچ" },
  "cert.sub": { en: "The result of scanning a PCP certificate's QR code.", ur: "پی سی پی سرٹیفکیٹ کا کیو آر کوڈ اسکین کرنے کا نتیجہ۔" },
  "cert.valid": { en: "Genuine {what}: valid", ur: "اصلی {what}: مؤثر" },
  "cert.expired": { en: "Genuine {what}: expired", ur: "اصلی {what}: میعاد ختم" },
  "cert.whatNoc": { en: "NOC", ur: "این او سی" },
  "cert.whatAcc": { en: "accreditation certificate", ur: "ایکریڈیٹیشن سرٹیفکیٹ" },
  "cert.kind": { en: "Certificate", ur: "سرٹیفکیٹ" },
  "cert.kindNoc": { en: "No Objection Certificate (NOC)", ur: "عدم اعتراض سرٹیفکیٹ (این او سی)" },
  "cert.kindAcc": { en: "Accreditation", ur: "ایکریڈیٹیشن" },
  "cert.kindRenewal": { en: "Accreditation (renewal)", ur: "ایکریڈیٹیشن (تجدید)" },
  "cert.term": { en: "Accreditation term", ur: "ایکریڈیٹیشن کی مدت" },
  "cert.intakeAcc": { en: "Accredited annual intake", ur: "ایکریڈیٹڈ سالانہ نشستیں" },
  "cert.none": { en: "No such certificate", ur: "ایسا کوئی سرٹیفکیٹ موجود نہیں" },
  "cert.institution": { en: "Institution", ur: "ادارہ" },
  "cert.city": { en: "City", ur: "شہر" },
  "cert.program": { en: "Program", ur: "پروگرام" },
  "cert.intake": { en: "Approved annual intake", ur: "منظور شدہ سالانہ نشستیں" },
  "cert.students": { en: "{n} students", ur: "{n} طلبہ" },
  "cert.issued": { en: "Issued", ur: "تاریخِ اجرا" },
  "cert.validUntil": { en: "Valid until", ur: "مؤثر تا" },
  "cert.fingerprint": { en: "PDF fingerprint (SHA-256)", ur: "پی ڈی ایف فنگر پرنٹ (SHA-256)" },
  "cert.compare": { en: "Compare the fingerprint with the PDF you were given: any edit to the file changes it.", ur: "اپنے پاس موجود پی ڈی ایف سے فنگر پرنٹ کا موازنہ کریں: فائل میں کوئی بھی تبدیلی اسے بدل دیتی ہے۔" },
  "cert.forged": { en: "{no} was not issued by PCP. The document may be forged; report it to PCP.", ur: "{no} پی سی پی نے جاری نہیں کیا۔ یہ دستاویز جعلی ہو سکتی ہے؛ پی سی پی کو اطلاع دیں۔" },
  "cert.searchInstead": { en: "Search institutions instead", ur: "اس کے بجائے ادارے تلاش کریں" },

  // ---------- Privacy notice (guide section 14: approved by the Council before the public search goes live) ----------
  "verify.privacy": { en: "What this search shows, and what it never shows: read the privacy notice", ur: "یہ تلاش کیا دکھاتی ہے اور کیا کبھی نہیں دکھاتی: رازداری کا نوٹس پڑھیں" },
  "privacy.title": { en: "Privacy notice", ur: "رازداری کا نوٹس" },
  "privacy.sub": {
    en: "What the PCP Digital Portal holds about you, what the public can see, who else can see it, how long it is kept, and how to correct it.",
    ur: "پی سی پی ڈیجیٹل پورٹل آپ کے بارے میں کیا معلومات رکھتا ہے، عوام کیا دیکھ سکتے ہیں، اور کون دیکھ سکتا ہے، معلومات کب تک رکھی جاتی ہیں، اور انہیں کیسے درست کرایا جائے۔",
  },
  "privacy.draft": { en: "Draft for Council approval", ur: "کونسل کی منظوری کے لیے مسودہ" },
  "privacy.draftBody": {
    en: "The Pharmacy Council approves this notice before the public search goes live. Until then it is a draft and may change.",
    ur: "پبلک سرچ شروع ہونے سے پہلے فارمیسی کونسل اس نوٹس کی منظوری دے گی۔ تب تک یہ ایک مسودہ ہے اور اس میں تبدیلی ہو سکتی ہے۔",
  },
  "privacy.version": { en: "Draft version 0.1 · prepared {date}", ur: "مسودہ ورژن 0.1 · تیاری {date}" },
  "privacy.onThisPage": { en: "On this page", ur: "اس صفحے پر" },

  "privacy.holds.h": { en: "What the portal holds", ur: "پورٹل میں کون سی معلومات ہیں" },
  "privacy.holds.inst": {
    en: "Institutions: name, PCP ID, campuses, programmes, NOC and accreditation decisions, and the documents they file.",
    ur: "ادارے: نام، پی سی پی آئی ڈی، کیمپس، پروگرام، این او سی اور ایکریڈیٹیشن کے فیصلے، اور ان کی جمع کرائی گئی دستاویزات۔",
  },
  "privacy.holds.faculty": {
    en: "Faculty: name, father's name, CNIC, qualifications, registration number and appointments.",
    ur: "فیکلٹی: نام، والد کا نام، شناختی کارڈ نمبر، تعلیمی قابلیت، رجسٹریشن نمبر اور تقرریاں۔",
  },
  "privacy.holds.students": {
    en: "Students: name, father's name, CNIC or B-Form, mobile, email, programme, session, results and graduation.",
    ur: "طلبہ: نام، والد کا نام، شناختی کارڈ یا ب فارم نمبر، موبائل، ای میل، پروگرام، سیشن، نتائج اور گریجویشن۔",
  },
  "privacy.holds.pharmacists": {
    en: "Pharmacists: PCP's index of the provincial registers: name, father's name, CNIC, university, registration number, status and validity. Contact details and practice place only when held.",
    ur: "فارماسسٹ: صوبائی رجسٹروں کا پی سی پی اشاریہ: نام، والد کا نام، شناختی کارڈ نمبر، یونیورسٹی، رجسٹریشن نمبر، حیثیت اور مدت۔ رابطے کی تفصیلات اور جائے ملازمت صرف اگر دستیاب ہوں۔",
  },
  "privacy.holds.system": {
    en: "Accounts, fee payments, the emails and SMS the portal sends, and an audit log of who viewed, changed, approved or downloaded a record.",
    ur: "صارف اکاؤنٹس، فیس کی ادائیگیاں، پورٹل کی بھیجی گئی ای میلز اور ایس ایم ایس، اور ایک آڈٹ لاگ کہ کس نے کون سا ریکارڈ دیکھا، بدلا، منظور کیا یا ڈاؤن لوڈ کیا۔",
  },
  "privacy.holds.nadra": {
    en: "Where an agreement allows it, a CNIC is checked with NADRA when a faculty member, student or pharmacist is registered. In this demo the NADRA check is simulated.",
    ur: "جہاں معاہدہ اجازت دے، فیکلٹی، طالب علم یا فارماسسٹ کی رجسٹریشن پر شناختی کارڈ نمبر کی نادرا سے تصدیق کی جاتی ہے۔ اس ڈیمو میں نادرا کی یہ تصدیق فرضی ہے۔",
  },

  "privacy.public.h": { en: "What the public search shows", ur: "پبلک سرچ کیا دکھاتی ہے" },
  "privacy.public.shows": { en: "Shows", ur: "دکھاتی ہے" },
  "privacy.public.never": { en: "Never shows", ur: "کبھی نہیں دکھاتی" },
  "privacy.public.inst": {
    en: "Institutions: name, PCP ID, city, province, and each programme's NOC and accreditation status with its validity.",
    ur: "ادارے: نام، پی سی پی آئی ڈی، شہر، صوبہ، اور ہر پروگرام کی این او سی اور ایکریڈیٹیشن کی حیثیت اور اس کی مدت۔",
  },
  "privacy.public.ph": {
    en: "Pharmacists, by exact registration number only: name, registration number, category, status and validity.",
    ur: "فارماسسٹ، صرف درست رجسٹریشن نمبر سے: نام، رجسٹریشن نمبر، کیٹیگری، حیثیت اور مدت۔",
  },
  "privacy.public.cert": {
    en: "Certificates and receipts: whether a document PCP issued is genuine and still valid.",
    ur: "سرٹیفکیٹ اور رسیدیں: کیا پی سی پی کی جاری کردہ دستاویز اصلی ہے اور اب بھی مؤثر ہے۔",
  },
  "privacy.public.neverList": {
    en: "CNIC, phone number, email, home address, practice place, and faculty or student records.",
    ur: "شناختی کارڈ نمبر، فون نمبر، ای میل، گھر کا پتا، جائے ملازمت، اور فیکلٹی یا طلبہ کے ریکارڈ۔",
  },
  "privacy.public.nobrowse": {
    en: "The pharmacist check needs the exact registration number, so the register cannot be browsed or copied.",
    ur: "فارماسسٹ کی جانچ کے لیے درست رجسٹریشن نمبر درکار ہے، اس لیے رجسٹر کو نہ تو کھنگالا جا سکتا ہے اور نہ ہی نقل کیا جا سکتا ہے۔",
  },
  "privacy.public.try": { en: "Try the public search", ur: "پبلک سرچ آزمائیں" },

  "privacy.access.h": { en: "Who can see what", ur: "کون کیا دیکھ سکتا ہے" },
  "privacy.access.inst": { en: "An institution sees only its own records, never another institution's.", ur: "ادارہ صرف اپنا ریکارڈ دیکھتا ہے، کسی دوسرے ادارے کا کبھی نہیں۔" },
  "privacy.access.officer": {
    en: "A PCP officer sees the cases assigned to their desk. The super administrator manages accounts but takes no case decisions.",
    ur: "پی سی پی افسر صرف اپنے ذمے کے کیس دیکھتا ہے۔ سپر ایڈمنسٹریٹر اکاؤنٹس سنبھالتا ہے مگر کیسوں کے فیصلے نہیں کرتا۔",
  },
  "privacy.access.cnic": {
    en: "CNICs are masked on screen, for example 17301-XXXXXXX-1, except for the officers authorised to verify identity.",
    ur: "شناختی کارڈ نمبر اسکرین پر چھپائے جاتے ہیں، مثلاً 17301-XXXXXXX-1، سوائے ان افسران کے جو شناخت کی تصدیق کے مجاز ہیں۔",
  },
  "privacy.access.self": { en: "Students and pharmacists see their own record only.", ur: "طلبہ اور فارماسسٹ صرف اپنا ریکارڈ دیکھتے ہیں۔" },
  "privacy.access.feed": {
    en: "The Ministry and the provincial councils receive a read-only data feed without CNICs or contact details.",
    ur: "وزارت اور صوبائی کونسلوں کو صرف پڑھنے کے لیے ڈیٹا فیڈ ملتی ہے، جس میں شناختی کارڈ نمبر یا رابطے کی تفصیلات شامل نہیں۔",
  },
  "privacy.access.review": {
    en: "Every quarter the super administrator reviews who holds which role and removes access that is no longer needed.",
    ur: "ہر سہ ماہی سپر ایڈمنسٹریٹر جائزہ لیتا ہے کہ کس کے پاس کون سا کردار ہے، اور غیر ضروری رسائی ختم کر دیتا ہے۔",
  },

  "privacy.keep.h": { en: "How long it is kept", ur: "معلومات کب تک رکھی جاتی ہیں" },
  "privacy.keep.records": {
    en: "Academic and regulatory records are kept: decided cases, registers, annual returns, documents, payments and the audit log.",
    ur: "تعلیمی اور ریگولیٹری ریکارڈ محفوظ رکھے جاتے ہیں: فیصلہ شدہ کیس، رجسٹر، سالانہ گوشوارے، دستاویزات، ادائیگیاں اور آڈٹ لاگ۔",
  },
  "privacy.keep.drafts": { en: "A draft application nobody changed for {n} days is cleared.", ur: "جس درخواست کے مسودے میں {n} دن تک کوئی تبدیلی نہ ہو، اسے حذف کر دیا جاتا ہے۔" },
  "privacy.keep.onboarding": { en: "An institution registration never submitted is cleared after {n} days.", ur: "ادارے کی وہ رجسٹریشن جو کبھی جمع نہ کرائی گئی ہو، {n} دن بعد حذف کر دی جاتی ہے۔" },
  "privacy.keep.codes": { en: "One-time codes are deleted {n} day(s) after they expire.", ur: "یک وقتی کوڈ میعاد ختم ہونے کے {n} دن بعد حذف کر دیے جاتے ہیں۔" },
  "privacy.keep.challans": { en: "An unpaid challan is cancelled after {n} days; the record itself is kept.", ur: "غیر ادا شدہ چالان {n} دن بعد منسوخ کر دیا جاتا ہے؛ اس کا ریکارڈ محفوظ رہتا ہے۔" },
  "privacy.keep.rule": {
    en: "These periods come from PCP's retention rule ({rule}) and are applied every night.",
    ur: "یہ مدتیں پی سی پی کے ریٹینشن رول ({rule}) سے لی گئی ہیں اور ہر رات ان پر عمل ہوتا ہے۔",
  },
  "privacy.keep.version": { en: "version {v}", ur: "ورژن {v}" },
  "privacy.keep.default": { en: "default values", ur: "طے شدہ اقدار" },

  "privacy.security.h": { en: "How it is protected", ur: "معلومات کا تحفظ کیسے ہوتا ہے" },
  "privacy.security.transit": {
    en: "Encrypted in transit (HTTPS) and at rest (the database and the document store).",
    ur: "منتقلی کے دوران (HTTPS) اور محفوظ حالت میں (ڈیٹا بیس اور دستاویزات کا ذخیرہ) خفیہ کاری۔",
  },
  "privacy.security.backup": { en: "Daily backups, a tested restore, and a disaster recovery site.", ur: "روزانہ بیک اپ، آزمودہ بحالی، اور ڈیزاسٹر ریکوری سائٹ۔" },
  "privacy.security.otp": {
    en: "Sign-in with a password, and a one-time code for every decision and payment. Sessions on shared office computers end when idle.",
    ur: "پاس ورڈ سے سائن اِن، اور ہر فیصلے اور ادائیگی کے لیے یک وقتی کوڈ۔ دفتر کے مشترکہ کمپیوٹر پر غیر فعال رہنے پر سیشن ختم ہو جاتا ہے۔",
  },
  "privacy.security.audit": {
    en: "Every view, change, approval and download is written to a tamper-evident audit log.",
    ur: "ہر دیکھنے، تبدیلی، منظوری اور ڈاؤن لوڈ کا اندراج ایک ناقابلِ تحریف آڈٹ لاگ میں ہوتا ہے۔",
  },

  "privacy.correct.h": { en: "How to correct your data", ur: "اپنی معلومات کیسے درست کرائیں" },
  "privacy.correct.inst": {
    en: "Institutions correct faculty details with a change request, and locked student figures with a correction request, both inside the portal.",
    ur: "ادارے فیکلٹی کی تفصیلات تبدیلی کی درخواست سے، اور مقفل طلبہ کے اعداد و شمار درستی کی درخواست سے درست کراتے ہیں، دونوں پورٹل کے اندر۔",
  },
  "privacy.correct.person": {
    en: "Students and faculty: ask your institution, or tell PCP's help desk that a record is wrong.",
    ur: "طلبہ اور فیکلٹی: اپنے ادارے سے کہیں، یا پی سی پی کے ہیلپ ڈیسک کو بتائیں کہ ریکارڈ غلط ہے۔",
  },
  "privacy.correct.pharmacist": {
    en: "Pharmacists update their practice details from their own portal. Registration details are corrected by the provincial council that issued them.",
    ur: "فارماسسٹ اپنے پورٹل سے جائے ملازمت کی تفصیلات اپ ڈیٹ کرتے ہیں۔ رجسٹریشن کی تفصیلات وہی صوبائی کونسل درست کرتی ہے جس نے انہیں جاری کیا۔",
  },
  "privacy.correct.cta": { en: "Report a wrong record", ur: "غلط ریکارڈ کی اطلاع دیں" },

  "privacy.contact.h": { en: "Contact", ur: "رابطہ" },
  "privacy.contact.body": {
    en: "Questions about this notice or your data go to PCP's data protection contact (demo address privacy@demo.pcp.local) or to the help desk. You get a reference number and an answer within 5 working days.",
    ur: "اس نوٹس یا اپنی معلومات کے بارے میں سوالات پی سی پی کے ڈیٹا پروٹیکشن رابطے (ڈیمو پتا privacy@demo.pcp.local) یا ہیلپ ڈیسک کو بھیجیں۔ آپ کو ایک حوالہ نمبر ملے گا اور ۵ کاروباری دنوں میں جواب۔",
  },
  "privacy.contact.help": { en: "Open the help desk", ur: "ہیلپ ڈیسک کھولیں" },
} as const satisfies Record<string, { en: string; ur: string }>;

export type I18nKey = keyof typeof D;
type Vars = Record<string, string | number>;

function fill(s: string, vars?: Vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** t("nav.verify") → the label in the chosen language; {name} placeholders are filled from vars. */
export function translator(lang: Lang) {
  return (key: I18nKey, vars?: Vars) => fill(D[key][lang], vars);
}
export type T = ReturnType<typeof translator>;

/** Like t(), but placeholders may be React nodes (e.g. a bold certificate number). */
export function richText<N>(lang: Lang, key: I18nKey, nodes: Record<string, N>): (string | N)[] {
  return D[key][lang].split(/(\{\w+\})/g).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in nodes ? nodes[m[1]] : part;
  });
}

/** A translated label when the dictionary has one, else the fallback (for status values and the like). */
export function tryTranslate(lang: Lang, key: string, fallback: string) {
  const e = (D as Record<string, { en: string; ur: string } | undefined>)[key];
  return e ? e[lang] : fallback;
}
