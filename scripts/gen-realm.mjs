// Generates docker/keycloak/realm-pcp.json (roles, institution groups, demo users, clients).
import { writeFileSync } from "node:fs";
import { pocPassword } from "./poc-password.mjs";

const INSTITUTIONS = [
  ["PCP-UNI-000101", "ruh", "Ayesha", "Khan"],
  ["PCP-UNI-000102", "nhc", "Tariq", "Mehmood"],
  ["PCP-UNI-000103", "rbu", "Saima", "Rauf"],
  ["PCP-UNI-000104", "ccp", "Farhan", "Siddiqui"],
  ["PCP-UNI-000105", "bvu", "Naseebullah", "Kakar"],
  ["PCP-UNI-000106", "gmi", "Sher Ali", "Baig"],
  ["PCP-UNI-000107", "fru", "Rabia", "Noor"],
  ["PCP-UNI-000108", "scu", "Ali Raza", "Memon"],
];
const ROLES = [
  ["inst_poc", "Head of institution"],
  ["inst_principal", "Principal or Dean"],
  ["inst_dept_admin", "Department administrator"],
  ["inst_data_entry", "Data-entry officer"],
  ["inst_exam", "Examination officer"],
  ["inst_finance", "Finance officer"],
  ["inst_applicant", "Institution applicant (onboarding only)"],
  ["pcp_registration", "PCP Registration officer"],
  ["pcp_coordinator", "PCP Inspection coordinator"],
  ["pcp_accounts", "PCP Accounts officer"],
  ["pcp_verification", "PCP Verification officer"],
  ["student", "Student (own record)"],
  ["pharmacist", "Registered pharmacist (own record)"],
  ["pcp_admin", "PCP Super Admin: users and institutions"],
  ["pcp_officer", "PCP Officer: processes applications"],
  ["pcp_inspector", "PCP Inspector: assigned inspections only"],
  ["pcp_secretary", "PCP Secretary: council decisions and certificates"],
  ["pcp_technical", "PCP Technical officer: technical review, PG proformas"],
  ["pcp_legal", "PCP Legal officer: court cases and litigation"],
  ["provincial_council", "Provincial council officer: one province"],
  ["faculty", "Faculty member (own academic profile)"],
];
// Production: PUBLIC_ORIGIN=https://host, client secrets from env, REALM_OUT=path (see deploy/).
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN?.replace(/\/+$/, "");
const PROD = !!PUBLIC_ORIGIN;
const ORIGIN = PUBLIC_ORIGIN ?? "http://localhost:8088";
const SECRET = {
  portal: process.env.PORTAL_CLIENT_SECRET ?? "pcp-portal-demo-secret",
  adminApi: process.env.ADMIN_API_CLIENT_SECRET ?? "pcp-admin-api-demo-secret",
  demo: process.env.DEMO_CLIENT_SECRET ?? "pcp-demo-secret",
};
// Extra local ports for development servers (parallel work on separate databases); not in production.
const DEV_PORTS = PROD ? [] : [3201, 3202, 3203, 3204, 3205, 3206, 3207, 3208, 3209];
// Demo@1234 for every account, or, for a hosted POC, a separate password per account derived from POC_PASSWORD_SEED.
const SEED = process.env.POC_PASSWORD_SEED;
const pw = (username) => [{ type: "password", value: SEED ? pocPassword(SEED, username) : "Demo@1234", temporary: false }];
const user = (username, firstName, lastName, role, inst) => ({
  username, enabled: true, firstName, lastName, email: `${username}@demo.pcp.local`, emailVerified: true,
  credentials: pw(username), realmRoles: [role], groups: inst ? [`/institutions/${inst}`] : [],
});
const users = [
  user("pcp.admin", "Super", "Admin", "pcp_admin"),
  user("pcp.officer", "Usman", "Farooq", "pcp_officer"),
  user("pcp.inspector", "Kamran", "Javed", "pcp_inspector"),
  user("pcp.inspector2", "Zainab", "Qureshi", "pcp_inspector"),
  // More panel members, one per province, for the automated team suggestion (RFP 4.1.1)
  user("pcp.inspector3", "Farah Naz", "Baloch", "pcp_inspector"),
  user("pcp.inspector4", "Imtiaz Ali", "Memon", "pcp_inspector"),
  user("pcp.inspector5", "Sadaf", "Iqbal", "pcp_inspector"),
  user("pcp.inspector6", "Shabbir Hussain", "Turi", "pcp_inspector"),
  user("pcp.inspector7", "Gul Rukh", "Afridi", "pcp_inspector"),
  user("pcp.inspector8", "Asma", "Rizvi", "pcp_inspector"),
  user("pcp.secretary", "Nadia", "Hussain", "pcp_secretary"),
  ...INSTITUTIONS.map(([code, s, f, l]) => user(`${s}.poc`, f, l, "inst_poc", code)),
  // Riverside's other jobs (guide section 2: people inside the account have jobs, not a shared password)
  user("ruh.dean", "Imran", "Shah", "inst_principal", "PCP-UNI-000101"),
  user("ruh.admin", "Saba", "Qureshi", "inst_dept_admin", "PCP-UNI-000101"),
  user("ruh.entry", "Junaid", "Akhtar", "inst_data_entry", "PCP-UNI-000101"),
  user("ruh.exam", "Nida", "Farooq", "inst_exam", "PCP-UNI-000101"),
  user("ruh.finance", "Waqas", "Butt", "inst_finance", "PCP-UNI-000101"),
  // PCP officers with a single duty each
  user("pcp.registration", "Hina", "Malik", "pcp_registration"),
  user("pcp.coordinator", "Bilal", "Ahmed", "pcp_coordinator"),
  user("pcp.accounts", "Sadia", "Raza", "pcp_accounts"),
  user("pcp.verification", "Kashif", "Iqbal", "pcp_verification"),
  user("pcp.technical", "Faisal", "Rehman", "pcp_technical"),
  user("pcp.legal", "Amna", "Chaudhry", "pcp_legal"),
  // Provincial councils (RFP 4.1.2): each sees one province
  user("punjab.council", "Tahir", "Mahmood", "provincial_council"),
  user("sindh.council", "Shazia", "Abbasi", "provincial_council"),
  // A teacher with their own login, linked to their PCP-FAC record (RFP 4.1.2)
  user("fac.noor", "Noor Rabia", "Ahmed", "faculty"),
  // External users
  user("student.ruh", "Areeba", "Noor", "student"),
  user("student.rbu", "Hamza", "Iqbal", "student"),
  user("pharm.ali", "Ali", "Raza", "pharmacist"),
  user("pharm.sana", "Sana", "Memon", "pharmacist"),
  // An institution part-way through self-registration (nothing else opens until PCP approves)
  user("ivc.applicant", "Rehana", "Baloch", "inst_applicant"),
  {
    username: "service-account-pcp-admin-api", enabled: true, serviceAccountClientId: "pcp-admin-api",
    clientRoles: { "realm-management": ["manage-users", "view-users", "query-users", "query-groups", "view-realm"] },
  },
];
// Realm roles -> "roles" claim, institution group -> "groups" claim (shared by pcp-portal and pcp-demo).
const tokenMappers = [
  { name: "realm roles", protocol: "openid-connect", protocolMapper: "oidc-usermodel-realm-role-mapper", consentRequired: false,
    config: { multivalued: "true", "claim.name": "roles", "jsonType.label": "String", "id.token.claim": "true", "access.token.claim": "true", "userinfo.token.claim": "true" } },
  { name: "institution groups", protocol: "openid-connect", protocolMapper: "oidc-group-membership-mapper", consentRequired: false,
    config: { "full.path": "false", "claim.name": "groups", "id.token.claim": "true", "access.token.claim": "true", "userinfo.token.claim": "true" } },
];
const realm = {
  realm: "pcp", enabled: true, sslRequired: "none", displayName: "Pharmacy Council of Pakistan (Demo)",
  displayNameHtml: "<b>PCP</b> Digital Portal (Demo)", loginTheme: "pcp", loginWithEmailAllowed: true, duplicateEmailsAllowed: false,
  bruteForceProtected: true, passwordPolicy: "length(8)",
  roles: { realm: ROLES.map(([name, description]) => ({ name, description })) },
  groups: [{ name: "institutions", path: "/institutions", subGroups: INSTITUTIONS.map(([n]) => ({ name: n, path: `/institutions/${n}` })) }],
  clients: [
    {
      clientId: "pcp-portal", name: "PCP Portal", enabled: true, protocol: "openid-connect", publicClient: false,
      clientAuthenticatorType: "client-secret", secret: SECRET.portal, standardFlowEnabled: true, directAccessGrantsEnabled: false,
      redirectUris: [`${ORIGIN}/*`, ...DEV_PORTS.map((p) => `http://localhost:${p}/*`)], webOrigins: [ORIGIN], rootUrl: ORIGIN, baseUrl: "/",
      attributes: { "post.logout.redirect.uris": `${ORIGIN}/*`, "pkce.code.challenge.method": "S256" },
      protocolMappers: tokenMappers,
    },
    {
      // Demo only: lets the sign-in page switch personas with one click (OAuth password grant).
      // pcp-portal keeps directAccessGrantsEnabled=false; remove this client outside the demo.
      clientId: "pcp-demo", name: "PCP Portal demo persona switcher (demo only)", enabled: true, protocol: "openid-connect",
      publicClient: false, clientAuthenticatorType: "client-secret", secret: SECRET.demo,
      standardFlowEnabled: false, directAccessGrantsEnabled: true,
      redirectUris: [`${ORIGIN}/*`], webOrigins: [ORIGIN],
      attributes: { "post.logout.redirect.uris": `${ORIGIN}/*` },
      protocolMappers: tokenMappers,
    },
    {
      clientId: "pcp-admin-api", name: "PCP Portal admin API (service account)", enabled: true, protocol: "openid-connect",
      publicClient: false, clientAuthenticatorType: "client-secret", secret: SECRET.adminApi,
      serviceAccountsEnabled: true, standardFlowEnabled: false, directAccessGrantsEnabled: false,
    },
  ],
  users,
};
writeFileSync(process.env.REALM_OUT ?? new URL("../docker/keycloak/realm-pcp.json", import.meta.url), JSON.stringify(realm, null, 2));
console.log(`realm written: ${ROLES.length} roles, ${users.length - 1} users, ${INSTITUTIONS.length} institution groups`);
