import { type Plan as AccountPlan, countAccounts } from '../accounts.js';

export const usage = (plan: AccountPlan): string => `${plan.name}: ${countAccounts()}`
