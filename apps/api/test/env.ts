import * as path from "path";

process.env.DATABASE_URL ||= "postgresql://picenter:picenter@127.0.0.1:5432/picenter";
process.env.REDIS_URL ||= "redis://127.0.0.1:6379";
process.env.STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || "local";
process.env.STORAGE_LOCAL_ROOT = path.join(__dirname, "..", "data", "test-storage");
process.env.API_PUBLIC_URL = process.env.API_PUBLIC_URL || "http://127.0.0.1:3001";
process.env.JOBS_INLINE = "false";
process.env.RUN_WORKER = "false";
process.env.SESSION_SECRET = "test-session-secret";
