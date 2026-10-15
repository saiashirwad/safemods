import type { Plan as AccountPlan } from '../accounts/model.js';
import { countAccounts } from '../accounts/service.js';

export const usage = (plan: AccountPlan): string => `${plan.name}: ${countAccounts()}`
