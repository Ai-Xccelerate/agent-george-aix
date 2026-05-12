import { CronExpressionParser } from "cron-parser";

/** Next fire time for a 5-field cron expression, evaluated in the given tz. */
export function computeNextRun(cronExpr: string, tz: string): Date {
  return CronExpressionParser.parse(cronExpr, { tz }).next().toDate();
}
