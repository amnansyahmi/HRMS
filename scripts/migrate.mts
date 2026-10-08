import { connection } from "../src/lib/db";
const conn = await connection();
console.log("HRMS schema is ready.");
if ("end" in conn) await conn.end();
else await conn.close();
