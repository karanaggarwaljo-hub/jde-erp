import { redirect } from 'next/navigation';

/**
 * Analytics is now the AI Advice tab on Reports. The owner chose to fold it in, since most of the
 * screen repeated Reports and What to Order. This address stays so an old bookmark still lands
 * somewhere useful.
 */
export default function AnalyticsPage() {
  redirect('/reports?tab=advice');
}
