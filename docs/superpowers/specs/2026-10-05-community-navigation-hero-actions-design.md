# Community Navigation, Hero, and Listing Actions Design

## Goal

Make the standalone Community shell feel stationary when navigating between Jekyll pages and Community routes, give the Community hero the same editorial hierarchy as Blog, and move the write action from account controls into the post-list controls.

## Scope

This pass changes only the Community shell and home listing presentation:

- Header and navigation geometry across mobile, tablet, and desktop
- Community home hero copy and typography
- Placement of the write action
- Responsive behavior and regression coverage

Authentication behavior, public-read recovery, post data, filtering, sorting, and mutation authorization remain unchanged.

## Design Direction

Use the existing Jekyll site as the source of truth. The aesthetic is an editorial Jekyll shell with a restrained Community network motif, not a separate SaaS interface.

- Header geometry must match Jekyll rather than merely approximate it.
- Navigation state may change color, but must not change dimensions, weight, or position.
- The hero uses one English display sentence and one Korean explanatory sentence.
- Account controls and content-creation controls have separate responsibilities.

## Header and Navigation

### Structure

Change the Community header to mirror the Jekyll hierarchy:

1. Full-width header container
2. Inner wrap using the same responsive widths as Jekyll
3. Brand and navigation positioned relative to that inner wrap
4. A dedicated navigation-list wrapper for mobile and desktop layout rules

Existing accessible behavior remains:

- `nav` landmark with `주요 메뉴` label
- Button with `주요 메뉴 열기/닫기`
- Escape closes the menu
- Tab focus remains trapped while the mobile menu is open
- Closing restores focus to the toggle
- Body scrolling is locked only while the mobile menu is open

### Geometry

Use the Jekyll breakpoints and dimensions directly:

- Outer wrap: `500 / 680 / 900 / 1100px`
- Header top margin: `20 / 25 / 30px`
- Brand: `25 / 30 / 35px`
- Desktop menu: `15 / 17px`
- Desktop item separation: `20px`
- Desktop right anchor: `20px`
- Mobile menu padding below 768px: `20px`
- Tablet menu padding from 768px to 1023px: `40px 0 0`, centered at a maximum width of 70%

Add a stable scrollbar gutter at the document level where supported. This prevents the centered header and its right-anchored menu from shifting horizontally when navigation changes between short and long pages.

The active Community item changes color only. It must not alter font weight, padding, border width, or inline dimensions.

## Hero

Replace the single `자유게시판` heading with the approved editorial copy:

- H1: `Where ideas connect`
- Supporting paragraph: `질문과 경험이 이어지는 자유로운 공간입니다.`

The hero keeps:

- The original Community network SVG
- Full-viewport background and overlay
- Inner Jekyll wrap for text
- Exactly one H1 on the Community home page
- Blog-equivalent responsive vertical padding, heading scale, paragraph scale, and paragraph spacing

The Korean sentence uses `word-break: keep-all` to avoid awkward character-level wrapping.

## Account and Write Actions

Split account state from content creation:

- `CommunityActions` contains only login state, user identity, and logout.
- The `글쓰기` link is removed from the account row.
- A dedicated listing write link is rendered in the `커뮤니티 글` heading row.

### Desktop

The listing heading remains one row:

- Left: `커뮤니티 글`
- Right: sort tabs followed by the primary `글쓰기` action

### Mobile and Tablet

The listing heading stacks into two rows:

- First row: `커뮤니티 글`
- Second row: sort tabs on the left and `글쓰기` on the right

Controls may wrap at very narrow widths, but must not overflow horizontally. The write link remains visible and has a usable touch target.

The write route continues to enforce authentication. Moving the link does not grant anonymous write access and does not change mutation behavior.

## Component Changes

- `AppHeader.tsx`
  - Introduce the Jekyll-equivalent inner wrap and navigation-list structure.
  - Preserve mobile keyboard and focus behavior.
- `CommunityActions.tsx`
  - Remove the write link and keep authentication controls only.
- `CommunityHomePage.tsx`
  - Replace hero copy.
  - Add the write link to the listing control group.
- `community.css`
  - Encode shared header geometry, stable navigation positioning, hero paragraph typography, and responsive listing controls.
- Existing component and site-integration tests
  - Update structural assertions and add regression contracts for the new layout.

## Testing and Verification

### Automated

- Header tests verify landmarks, menu accessibility, focus trap, Escape, focus restoration, and scroll lock.
- Site integration tests verify Jekyll breakpoints, inner-wrap geometry, mobile menu padding, active-link dimensional stability, and stable scrollbar gutter.
- Home-page tests verify the approved hero copy, one H1, listing-level write link, sorting, filters, and public reads.
- CommunityActions tests verify that account controls no longer contain a write link.
- Full test, typecheck, lint, build, root script tests, and Docker artifact verification must pass.

### Browser

Verify the deployed or assembled site at representative widths:

- Mobile: 390px
- Tablet: 768px
- Desktop: 1440px

Check navigation transitions between Blog, Community, Shop, and About for stationary brand/menu anchors. Check that the hero copy wraps cleanly and that listing controls do not overflow. Verify anonymous users can open the write route but cannot mutate without authentication.

## Non-goals

- Changing Google-only authentication
- Adding GitHub or Kakao login
- Redesigning post cards, filters, or editor pages
- Changing Jekyll page content
- Introducing a new design system or animation
