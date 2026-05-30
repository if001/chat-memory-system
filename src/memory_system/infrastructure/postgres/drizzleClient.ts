import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export const createDrizzleClient = (pool: Pool): NodePgDatabase => drizzle(pool);
