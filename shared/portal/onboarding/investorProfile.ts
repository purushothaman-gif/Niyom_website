/**
 * Investor profile rules and option lists, for the website and the mobile app.
 *
 * The single source lives under supabase/functions/_shared because the
 * public-onboard-save-profile edge function has to bundle it; this re-export
 * is what lets the app reach it through `@shared/…` like everything else, so
 * the form on a phone is checked by exactly the rules the server applies.
 */
export * from '../../../supabase/functions/_shared/profile/investorProfile.ts';
export { COUNTRIES, countryName, isCountryCode, type Country } from '../../../supabase/functions/_shared/profile/countries.ts';
export { ageOn } from '../../../supabase/functions/_shared/profile/profileRules.ts';
