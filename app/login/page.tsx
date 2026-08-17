import LoginForm from './LoginForm';

const REDIRECT_REASON_MESSAGES: Record<string, string> = {
  no_session: 'Please sign in to continue.',
  no_access: "That account isn't set up for this ERP yet. Contact your administrator.",
  inactive: 'Your invite is still pending — finish setup from your invite email first.',
  forbidden: 'That page is restricted to the Owner / Admin role.',
};

// Resolving the redirect reason server-side (instead of reading window.location.search on the
// client in an effect) avoids a hydration mismatch — the server-rendered HTML and the client's
// first render then always agree, since the value arrives as a normal prop, not a browser API.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const initialError = (error && REDIRECT_REASON_MESSAGES[error]) || '';
  return <LoginForm initialError={initialError} />;
}
