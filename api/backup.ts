import { getRedis } from "./_lib/redis.js";
import { withApiHandler } from "./_lib/http.js";
import { neon } from "@neondatabase/serverless";
import { backupIfDue, lastBackupAt, readSnapshot } from "./_lib/backup.js";

export default withApiHandler("GET,POST", async (req, res) => {
  if (req.method === "GET" && req.query.download) {
    const snapshot = await readSnapshot(getRedis(), true);
    const day = snapshot.takenAt.slice(0, 10);
    res.setHeader("Content-Disposition", `attachment; filename="salary-backup-${day}.json"`);
    return res.status(200).json(snapshot);
  }

  const url = process.env.SALARY_BACKUP_DATABASE_URL;
  if (!url) return res.status(200).json({ configured: false, lastAt: null });
  const sql = neon(url);

  const secret = process.env.CRON_SECRET;
  const fromCron = Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
  if (req.method === "GET" && !fromCron) {
    return res.status(200).json({ configured: true, lastAt: await lastBackupAt(sql) });
  }

  const result = await backupIfDue(sql, getRedis(), fromCron ? "nightly" : "app");
  return res.status(200).json({ configured: true, ...result });
});
