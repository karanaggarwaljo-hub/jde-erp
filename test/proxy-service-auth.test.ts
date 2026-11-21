import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicPath, isServiceAuthenticatedPath } from '../proxy';

test('machine-authenticated integration and reconciliation routes bypass only the browser-session gate', () => {
  assert.equal(isServiceAuthenticatedPath('/api/integration/v1/identity'), true);
  assert.equal(isServiceAuthenticatedPath('/api/internal/adaptive-platform/company-events'), true);
  assert.equal(isServiceAuthenticatedPath('/api/internal/anything-else'), false);
  assert.equal(isServiceAuthenticatedPath('/api/local/companies'), false);
});

test('the blog is public, but the screen that writes it is not', () => {
  assert.equal(isPublicPath('/blog'), true);
  assert.equal(isPublicPath('/blog/rock-breaker-chisel-types'), true);
  assert.equal(isPublicPath('/api/public/blog'), true);
  // The admin screen shares the first letters, and must stay behind the login.
  assert.equal(isPublicPath('/blog-admin'), false);
  assert.equal(isPublicPath('/blogs'), false);
  assert.equal(isPublicPath('/api/ai-blog-draft'), false);
  assert.equal(isPublicPath('/api/ai-blog-photo-generate'), false);
  // The website counts its visits here without a login; reading them back needs one.
  assert.equal(isPublicPath('/api/public/site-hit'), true);
  assert.equal(isPublicPath('/api/site-visits'), false);
  assert.equal(isPublicPath('/api/local/blog_posts'), false);
});
