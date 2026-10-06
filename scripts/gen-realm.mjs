// Generates docker/keycloak/realm-pcp.json (roles, institution groups, demo users, clients).
import { writeFileSync } from "node:fs";

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
  ["inst_poc", "Institution Focal Person (POC)"],
  ["pcp_admin", "PCP Super Admin: users and institutions"],
  ["pcp_officer", "PCP Officer: processes applications"],
  ["pcp_inspector", "PCP Inspector: assigned inspections only"],
  ["pcp_secretary", "PCP Secretary: council decisions and certificates"],
];
const pw = [{ type: "password", value: "Demo@1234", temporary: false }];
const user = (username, firstName, lastName, role, inst) => ({
  username, enabled: true, firstName, lastName, email: `${username}@demo.pcp.local`, emailVerified: true,
  credentials: pw, realmRoles: [role], groups: inst ? [`/institutions/${inst}`] : [],
});
const users = [
  user("pcp.admin", "Super", "Admin", "pcp_admin"),
  user("pcp.officer", "Usman", "Farooq", "pcp_officer"),
  user("pcp.inspector", "Kamran", "Javed", "pcp_inspector"),
  user("pcp.inspector2", "Zainab", "Qureshi", "pcp_inspector"),
  user("pcp.secretary", "Nadia", "Hussain", "pcp_secretary"),
  ...INSTITUTIONS.map(([code, s, f, l]) => user(`${s}.poc`, f, l, "inst_poc", code)),
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
      clientAuthenticatorType: "client-secret", secret: "pcp-portal-demo-secret", standardFlowEnabled: true, directAccessGrantsEnabled: false,
      redirectUris: ["http://localhost:8088/*"], webOrigins: ["http://localhost:8088"], rootUrl: "http://localhost:8088", baseUrl: "/",
      attributes: { "post.logout.redirect.uris": "http://localhost:8088/*", "pkce.code.challenge.method": "S256" },
      protocolMappers: tokenMappers,
    },
    {
      // Demo only: lets the sign-in page switch personas with one click (OAuth password grant).
      // pcp-portal keeps directAccessGrantsEnabled=false; remove this client outside the demo.
      clientId: "pcp-demo", name: "PCP Portal demo persona switcher (demo only)", enabled: true, protocol: "openid-connect",
      publicClient: false, clientAuthenticatorType: "client-secret", secret: "pcp-demo-secret",
      standardFlowEnabled: false, directAccessGrantsEnabled: true,
      redirectUris: ["http://localhost:8088/*"], webOrigins: ["http://localhost:8088"],
      attributes: { "post.logout.redirect.uris": "http://localhost:8088/*" },
      protocolMappers: tokenMappers,
    },
    {
      clientId: "pcp-admin-api", name: "PCP Portal admin API (service account)", enabled: true, protocol: "openid-connect",
      publicClient: false, clientAuthenticatorType: "client-secret", secret: "pcp-admin-api-demo-secret",
      serviceAccountsEnabled: true, standardFlowEnabled: false, directAccessGrantsEnabled: false,
    },
  ],
  users,
};
writeFileSync(new URL("../docker/keycloak/realm-pcp.json", import.meta.url), JSON.stringify(realm, null, 2));
console.log(`realm written: ${ROLES.length} roles, ${users.length - 1} users, ${INSTITUTIONS.length} institution groups`);
