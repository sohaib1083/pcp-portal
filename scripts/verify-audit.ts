import { verifyAuditChain } from "../src/lib/audit";
verifyAuditChain().then((r) => { console.log(JSON.stringify(r)); process.exit(0); });
